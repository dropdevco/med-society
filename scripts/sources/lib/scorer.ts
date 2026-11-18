/**
 * The AI match scorer's pure half (docs/adr/0012): what the model is shown,
 * what it is asked, and how its answer is checked. No network, no database,
 * so the self-test can cover it. The model sees public directory fields only:
 * names, titles, specialties, regions, hospital labels, how many listings and
 * badges a candidate already has, and whether a cédula was printed. Never a
 * phone, e-mail, address of a person, or the cédula numbers themselves.
 */
import type { FacilityCandidate, NameCandidate } from './match';

/** Through OpenRouter (api/ai-search.ts does the same). Chosen on a judged 50-doctor sample, ADR 0014; override with --model or SCORER_MODEL. */
export const SCORER_MODEL = 'google/gemini-3.8-flash';
export const MAX_CANDIDATES = 5;

export type Kind = 'doctor' | 'facility';
export type Verdict = 'approve' | 'reject' | 'needs_human';

/** One queued item as the review queue holds it. */
export interface QueueItem {
    kind: Kind;
    source_slug: string;
    source_name: string;
    external_id: string;
    /** The candidate the matcher proposed (doctors.id or providers.id). */
    proposed: string | null;
    tier: number | null;
    name: string;
    label: string | null;
    specialties: string[];
    region: string | null;
    cedulaPrinted: boolean;
    candidates: Array<NameCandidate | FacilityCandidate>;
}

/** What we already know about a candidate doctor, beyond its name. */
export interface CandidateFacts {
    organizations: string[];
}

export interface Evidence {
    kind: Kind;
    record: { source: string; name: string; label: string | null; specialties: string[]; region: string | null; cedula_printed: boolean };
    candidates: Array<{ ref: string; name: string; name_similarity: number; regions: string[]; specialties: string[]; listings: number; organizations: string[] }>;
    same_name_count: number;
}

const isDoctor = (c: NameCandidate | FacilityCandidate): c is NameCandidate => 'doctor_id' in c;
export const candidateId = (c: NameCandidate | FacilityCandidate) => (isDoctor(c) ? c.doctor_id : c.provider_id);

/** Candidates in the order the matcher ranked them, the proposed one first, refs C1..Cn. */
export function orderedCandidates(item: QueueItem): Array<NameCandidate | FacilityCandidate> {
    const seen = new Set<string>();
    const ranked = [...item.candidates].sort((a, b) => b.similarity - a.similarity);
    const proposed = ranked.filter((c) => candidateId(c) === item.proposed);
    return [...proposed, ...ranked].filter((c) => !seen.has(candidateId(c)) && !!seen.add(candidateId(c))).slice(0, MAX_CANDIDATES);
}

export function buildEvidence(item: QueueItem, facts: Map<string, CandidateFacts>): Evidence {
    const list = orderedCandidates(item);
    return {
        kind: item.kind,
        record: {
            source: item.source_name,
            name: item.name,
            label: item.label,
            specialties: item.specialties,
            region: item.region,
            cedula_printed: item.cedulaPrinted,
        },
        candidates: list.map((c, i) => ({
            ref: `C${i + 1}`,
            name: isDoctor(c) ? c.display_name : c.name,
            name_similarity: Math.round(c.similarity * 100) / 100,
            regions: isDoctor(c) ? c.regions : c.region ? [c.region] : [],
            specialties: isDoctor(c) ? c.specialties : [],
            listings: isDoctor(c) ? c.listings.length : 1,
            organizations: facts.get(candidateId(c))?.organizations ?? [],
        })),
        same_name_count: list.filter((c) => c.similarity >= 0.99).length,
    };
}

export const SYSTEM_PROMPT = `You check whether a record from an organization's public directory (a hospital, a medical board, a cluster, a regulator) is the same doctor or clinic as one of the candidates already in a medical directory for the El Paso-Ciudad Juárez and San Diego-Tijuana regions.

How to weigh the evidence:
- A name alone never proves identity. Common Mexican names repeat; two people can share all four name parts.
- Mexican names usually have two surnames. A directory may drop the second surname, abbreviate a given name, or add "Dr."/"Dra.". These differences are weak evidence against a match, not proof.
- Agreement in specialty and region, and an organization the candidate is already tied to, raise confidence. A different specialty or region lowers it.
- If several candidates fit about equally (same_name_count above 1 is a warning), do not pick one: answer needs_human.
- A clinic record matches a clinic listing by name and region; a chain's branches in different cities are different clinics.

Answer with:
- candidate: the ref (C1, C2, ...) of the candidate you judge most likely the same, or null if none is.
- score: 0 to 100, how likely the record and that candidate are the same person or clinic. 90+ only when name, specialty and region all agree and nothing points elsewhere.
- verdict: approve (same, confident), reject (not the same, or no candidate fits), or needs_human (unsure).
- reason: one or two plain sentences a reviewer can check, naming the facts you relied on.`;

export function userMessage(e: Evidence): string {
    return `<evidence>\n${JSON.stringify(e, null, 1)}\n</evidence>`;
}

/** JSON schema for the answer, sent as the request's structured output format. */
export const ANSWER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['candidate', 'score', 'verdict', 'reason'],
    properties: {
        candidate: { type: ['string', 'null'] },
        score: { type: 'integer', minimum: 0, maximum: 100 },
        verdict: { type: 'string', enum: ['approve', 'reject', 'needs_human'] },
        reason: { type: 'string' },
    },
} as const;

export interface Answer {
    candidateId: string | null;
    score: number;
    verdict: Verdict;
    reason: string;
}

/**
 * Check the model's answer before anything is stored: the format is requested
 * from the API, but a reply is still data, so every field is validated here.
 * An approve with no candidate, or naming a ref we did not send, is refused.
 */
export function parseAnswer(text: string, e: Evidence, item: QueueItem): Answer {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('no JSON object in the answer');
    const raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const score = raw.score;
    if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > 100) throw new Error(`score out of range: ${String(score)}`);
    const verdict = raw.verdict;
    if (verdict !== 'approve' && verdict !== 'reject' && verdict !== 'needs_human') throw new Error(`unknown verdict: ${String(verdict)}`);
    const reason = typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 600) : '';
    if (!reason) throw new Error('no reason given');
    const ref = raw.candidate;
    if (ref !== null && typeof ref !== 'string') throw new Error('candidate must be a ref or null');
    const index = typeof ref === 'string' ? e.candidates.findIndex((c) => c.ref === ref) : -1;
    if (typeof ref === 'string' && index < 0) throw new Error(`candidate ${ref} was not offered`);
    if (verdict === 'approve' && index < 0) throw new Error('approve without a candidate');
    const chosen = index >= 0 ? candidateId(orderedCandidates(item)[index]) : null;
    return { candidateId: chosen, score, verdict, reason };
}

/**
 * The auto-link rule, used only when SCORER_AUTO_LINK_AT is set (off by default,
 * ADR 0012): a doctor, an approve at or above the bar, and no cédula involved.
 */
export function mayAutoLink(item: QueueItem, a: Answer, threshold: number | null): boolean {
    return threshold !== null && item.kind === 'doctor' && item.tier !== 1
        && a.verdict === 'approve' && a.candidateId !== null && a.score >= threshold;
}

export function autoLinkThreshold(raw: string | undefined): number | null {
    if (raw === undefined || raw.trim() === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 50 || n > 100) throw new Error(`SCORER_AUTO_LINK_AT must be a whole number from 50 to 100, got "${raw}"`);
    return n;
}
