/**
 * Pure helpers for scripts/reviews/enrich.ts: no env, no network, so
 * scripts/reviews/region-selftest.ts can import them.
 */
import { REGION_IDS, isRegionId, type RegionId } from '../../src/utils/region.ts';

/** `--region=<id>` or `--region <id>`. Undefined when absent; throws on an unknown id. */
export function parseRegionArg(argv: string[]): RegionId | undefined {
  let raw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--region=')) raw = argv[i].slice('--region='.length);
    else if (argv[i] === '--region') raw = argv[i + 1];
  }
  if (raw === undefined) return undefined;
  if (!isRegionId(raw)) throw new Error(`unknown region "${raw}" (expected one of: ${REGION_IDS.join(', ')})`);
  return raw;
}

/** Whether a review belongs to the region filter. No filter = everything, including unlinked reviews. */
export function inRegion(providerRegion: string | null | undefined, region: RegionId | undefined): boolean {
  return !region || providerRegion === region;
}

export interface SeedSource {
  review_id: string;
  doctoralia_id: string;
  provider_id: string | null;
  body: string;
}

export interface ExistingRow {
  review_id: string;
  provider_id: string | null;
}

/**
 * What `seed` should do, given every review and every existing review_embeddings row.
 *
 *   inserts:  reviews with a body and no row yet (in the region, when one is given)
 *   relinks:  existing rows whose doctoralia_doctors.provider_id has changed since
 *             they were seeded. Only provider_id is rewritten; embeddings, tags and
 *             translations are untouched. With a region, a relink counts when
 *             either the old or the new provider is in it, so a doctor moving out
 *             of (or being unlinked from) the region is still corrected.
 */
export function planSeed(
  reviews: SeedSource[],
  existing: Map<string, string | null>,
  regionOfProvider: (id: string | null) => string | null,
  region: RegionId | undefined,
): { inserts: SeedSource[]; relinks: { review_id: string; doctoralia_id: string; from: string | null; to: string | null }[] } {
  const inserts: SeedSource[] = [];
  const relinks: { review_id: string; doctoralia_id: string; from: string | null; to: string | null }[] = [];
  for (const r of reviews) {
    if (!r.body.trim()) continue;
    if (!existing.has(r.review_id)) {
      if (inRegion(regionOfProvider(r.provider_id), region)) inserts.push(r);
      continue;
    }
    const from = existing.get(r.review_id) ?? null;
    const to = r.provider_id ?? null;
    if (from === to) continue;
    if (region && regionOfProvider(from) !== region && regionOfProvider(to) !== region) continue;
    relinks.push({ review_id: r.review_id, doctoralia_id: r.doctoralia_id, from, to });
  }
  return { inserts, relinks };
}

// ── Cost estimate ────────────────────────────────────────────────────────────
//
// ASSUMPTIONS — verify before trusting the dollar figure:
//   * Prices are list prices per 1M tokens (OpenRouter passes provider list
//     prices through; as of 2026-10):
//       openai/text-embedding-3-small   $0.02 in
//       anthropic/claude-haiku-4.5      $1 in / $5 out     (tag)
//       anthropic/claude-sonnet-5.5     $2 in / $10 out    (translate)
//   * ~3.5 characters per token for these reviews (mostly Spanish, short).
//   * tag: system prompt ~350 tokens per batch of 25; ~12 tokens of wrapper
//     per review; output ~70 tokens per review (8-10 bilingual tags + outcome).
//   * translate: system prompt ~220 tokens per batch of 15; input is the body
//     plus ~12 tokens of wrapper; output is the translation, ~1.1x the body's
//     tokens, plus ~25 tokens of JSON per review.
//   * +20% margin for retried / failed batches (the scripts retry with backoff).
export const PRICES = {
  embed: { model: 'openai/text-embedding-3-small', inPerM: 0.02, outPerM: 0 },
  tag: { model: 'anthropic/claude-haiku-4.5', inPerM: 1, outPerM: 5 },
  translate: { model: 'anthropic/claude-sonnet-5.5', inPerM: 2, outPerM: 10 },
} as const;
export const CHARS_PER_TOKEN = 3.5;
export const MARGIN = 1.2;
const BODY_CAP = 2000; // tag/translate send body.slice(0, 2000); embed sends the whole body

export interface PhaseEstimate {
  phase: 'embed' | 'tag' | 'translate';
  model: string;
  reviews: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

const tok = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

export function estimatePhase(phase: PhaseEstimate['phase'], bodyLengths: number[]): PhaseEstimate {
  const n = bodyLengths.length;
  let inputTokens = 0;
  let outputTokens = 0;
  if (phase === 'embed') {
    for (const len of bodyLengths) inputTokens += tok(len);
  } else if (phase === 'tag') {
    inputTokens = Math.ceil(n / 25) * 350;
    for (const len of bodyLengths) inputTokens += tok(Math.min(len, BODY_CAP)) + 12;
    outputTokens = n * 70;
  } else {
    inputTokens = Math.ceil(n / 15) * 220;
    for (const len of bodyLengths) {
      const t = tok(Math.min(len, BODY_CAP));
      inputTokens += t + 12;
      outputTokens += Math.ceil(t * 1.1) + 25;
    }
  }
  const p = PRICES[phase];
  const usd = ((inputTokens * p.inPerM + outputTokens * p.outPerM) / 1e6) * MARGIN;
  return { phase, model: p.model, reviews: n, inputTokens, outputTokens, usd };
}
