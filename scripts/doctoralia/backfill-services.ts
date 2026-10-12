/**
 * Backfill `providers.services` and `providers.priceFromMxn` from the scrape.
 *
 *   npx tsx scripts/doctoralia/backfill-services.ts            # dry run
 *   npx tsx scripts/doctoralia/backfill-services.ts --commit
 *
 * Run scripts/doctoralia/schema-006-services.sql first.
 *
 * Services are our own Doctoralia data, so they can live in the database
 * permanently — the same reasoning as backfill-extras.ts. They are read from
 * out/profiles.jsonl rather than from the `doctoralia_services` staging table
 * because that table is RLS-locked to the service role and this is the only
 * writer either way.
 *
 * A doctor can list the same service at several addresses. They are merged by
 * slug (falling back to a folded name) keeping the cheapest quoted price, since
 * the marketplace shows one row per provider, not one per consulting room.
 *
 * Only ever updates the two new columns — never inserts or deletes a row.
 */
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';
import { PROFILES_FILE } from './config';
import { parsePrice } from './load';
import type { DoctoraliaProfile } from './types';

const commit = process.argv.includes('--commit');

function loadEnv() {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      out[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

function readJsonl<T>(file: string, key: (row: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)) {
    try {
      const row = JSON.parse(line) as T;
      out.set(key(row), row);
    } catch {
      // half-written line from an interrupted run
    }
  }
  return out;
}

/** Shape written to `providers.services`; mirrors ProviderService in src/types. */
export interface ServiceRow {
  name: string;
  slug: string | null;
  priceText: string | null;
  priceMxn: number | null;
  isFrom: boolean;
}

/** Accent- and case-insensitive key, so "Limpieza Dental" folds onto "limpieza dental". */
const foldKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    // Strip the combining-diacritic block. The class holds U+0300–U+036F as
    // literal marks, which render as an empty-looking range in most editors —
    // it is correct, just unphotogenic.
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Flatten every address's service list into one deduplicated set.
 *
 * Cheapest wins on a collision, and a real price always beats no price: a
 * provider listing "Consulta" at $500 in one clinic and unpriced in another
 * publishes a price, and hiding it would be the wrong answer for the patient.
 */
export function servicesOf(profile: DoctoraliaProfile): ServiceRow[] {
  const merged = new Map<string, ServiceRow>();

  for (const address of profile.addresses ?? []) {
    for (const s of address.services ?? []) {
      const name = (s.name ?? '').trim();
      if (!name) continue;

      const { mxn, isFrom } = parsePrice(s.price);
      // A handful of tourist-facing surgeons quote dollars ("Precio en dolares").
      // Keep the figure visible, labelled, but never as pesos: it must not feed
      // the "From $X" badge or a price sort.
      const isUsd = s.currency === 'USD';
      const key = s.slug || foldKey(name);
      const next: ServiceRow = {
        name,
        slug: s.slug ?? null,
        priceText: s.price ? (isUsd ? `${s.price} USD` : s.price) : null,
        priceMxn: isUsd ? null : mxn,
        isFrom: s.isPriceFrom ?? isFrom,
      };

      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, next);
        continue;
      }
      if (prev.priceMxn == null && next.priceMxn != null) merged.set(key, next);
      else if (prev.priceMxn != null && next.priceMxn != null && next.priceMxn < prev.priceMxn) {
        merged.set(key, next);
      }
    }
  }

  // Priced services first, cheapest to dearest — the card and the drawer both
  // show a truncated list, and a price is the most useful thing in it.
  return [...merged.values()].sort((a, b) => {
    if ((a.priceMxn == null) !== (b.priceMxn == null)) return a.priceMxn == null ? 1 : -1;
    if (a.priceMxn != null && b.priceMxn != null && a.priceMxn !== b.priceMxn) {
      return a.priceMxn - b.priceMxn;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Below this, a published figure is a placeholder rather than a price.
 *
 * Two kinds of junk sit at the bottom of this data. `parsePrice` maps
 * "Servicio gratuito" to 0, which on Doctoralia nearly always means the
 * *consultation* is free — one profile lists "Carillas de porcelana · Servicio
 * gratuito", and porcelain veneers are not free. Above that sit nominal
 * entries: "Blanqueamiento dental · Desde $3", and one audiologist whose entire
 * menu is "$1".
 *
 * The directory's own distribution picks the number. Twenty providers publish a
 * cheapest price under $50 and exactly one more falls between $50 and $100,
 * against a $300 first decile — so $50 sits in a real gap, and no plausible
 * consultation fee is anywhere near it.
 */
const MIN_CREDIBLE_PRICE_MXN = 50;

/**
 * Cheapest credible price, or null when the provider publishes none.
 *
 * Placeholder rows still live in `services`: the drawer prints "$1" or
 * "Servicio gratuito" verbatim beside the service that carries it, which is
 * accurate reporting of what the provider published. What they must not do is
 * feed the "From $X" badge or head up a lowest-price sort, where they would
 * read as this clinic being the cheapest in Juárez.
 */
export function priceFromOf(services: ServiceRow[]): number | null {
  const credible = services
    .map((s) => s.priceMxn)
    .filter((p): p is number => p != null && p >= MIN_CREDIBLE_PRICE_MXN);
  return credible.length ? Math.min(...credible) : null;
}

interface Row {
  id: string;
  name: string;
  doctoraliaId: string | null;
  priceFromMxn: number | null;
  services: unknown;
}

async function run() {
  const profiles = readJsonl<DoctoraliaProfile>(PROFILES_FILE, (p) => p.doctoraliaId);
  if (!profiles.size) {
    throw new Error(`no profiles found at ${PROFILES_FILE} — run the scrape first`);
  }

  const providers: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('providers')
      .select('id,name,"doctoraliaId","priceFromMxn",services')
      .not('doctoraliaId', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(`could not read providers: ${error.message}`);
    providers.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const computed = providers.map((row) => {
    const profile = row.doctoraliaId ? profiles.get(row.doctoraliaId) : undefined;
    const services = profile ? servicesOf(profile) : [];
    return { row, services, priceFrom: priceFromOf(services) };
  });

  const withServices = computed.filter((c) => c.services.length);
  const withPrice = computed.filter((c) => c.priceFrom != null);
  const noProfile = computed.filter((c) => !profiles.has(c.row.doctoraliaId ?? ''));
  const serviceRows = withServices.reduce((n, c) => n + c.services.length, 0);
  const pct = (n: number) => ((n / Math.max(1, providers.length)) * 100).toFixed(1);

  console.log(`\n💲 Services & prices backfill${commit ? '' : ' (dry run)'}\n`);
  console.log(`  Doctoralia-sourced providers   ${providers.length}`);
  console.log(`  no profile in profiles.jsonl   ${noProfile.length}`);
  console.log(`  with at least one service      ${withServices.length} (${pct(withServices.length)}%)`);
  console.log(`  with at least one price        ${withPrice.length} (${pct(withPrice.length)}%)`);
  console.log(`  total service rows             ${serviceRows}`);

  const prices = withPrice.map((c) => c.priceFrom!).sort((a, b) => a - b);
  if (prices.length) {
    const at = (q: number) => prices[Math.min(prices.length - 1, Math.floor(prices.length * q))];
    console.log(`  cheapest-service spread        p10=$${at(0.1)}  median=$${at(0.5)}  p90=$${at(0.9)}`);
  }

  const samples = withPrice.slice(0, 5).map((c) => {
    const top = c.services.slice(0, 2).map((s) => `${s.name} ${s.priceText ?? '—'}`).join(', ');
    return `    ${c.row.name} · from $${c.priceFrom} · ${top}`;
  });
  if (samples.length) console.log(`\n  sample:\n${samples.join('\n')}`);

  if (!commit) {
    console.log('\n  Dry run — nothing written. Re-run with --commit.\n');
    return;
  }

  // Only write rows that actually change, so a re-run is close to free.
  //
  // Compared field by field rather than by JSON.stringify: Postgres stores
  // jsonb with its own key ordering (shortest key first), so a stringified
  // round-trip never equals what we sent and every row would look dirty.
  // Postgres hands numeric back as a string in some driver paths, so compare
  // as numbers — and treat two nulls as equal, which Number(null) would not.
  const samePrice = (x: unknown, y: unknown) =>
    x == null || y == null ? x == null && y == null : Number(x) === Number(y);

  const same = (a: ServiceRow[], b: unknown) => {
    const prev = Array.isArray(b) ? (b as ServiceRow[]) : [];
    if (prev.length !== a.length) return false;
    return a.every((s, i) => {
      const p = prev[i] ?? ({} as ServiceRow);
      return s.name === p.name
        && s.slug === (p.slug ?? null)
        && s.priceText === (p.priceText ?? null)
        && samePrice(s.priceMxn, p.priceMxn)
        && s.isFrom === Boolean(p.isFrom);
    });
  };

  const toWrite = computed.filter((c) => {
    if (!c.services.length) return false;
    return !same(c.services, c.row.services) || !samePrice(c.row.priceFromMxn, c.priceFrom);
  });
  console.log(`\n  rows needing an update: ${toWrite.length}`);

  let updated = 0;
  for (const { row, services, priceFrom } of toWrite) {
    const { error } = await supabase
      .from('providers')
      .update({ services, priceFromMxn: priceFrom })
      .eq('id', row.id);
    if (error) {
      console.error(`  ✖ ${row.name}: ${error.message}`);
      continue;
    }
    updated++;
    if (updated % 100 === 0) process.stdout.write(`\r  updated ${updated}/${toWrite.length}`);
  }

  console.log(`\n  ✅ updated ${updated}`);
}

// Only run when invoked directly, so servicesOf() stays importable for tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error('\n✖ fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
