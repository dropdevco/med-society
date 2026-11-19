import type { CompareCandidate, MatchCompare } from '../../lib/adminApi';

/** One line of the side-by-side: what the source says, what we hold, and whether they agree. */
export interface CompareRow {
    label: string;
    record: string;
    candidate: string;
    /** 'differs' is highlighted for the reviewer; 'unknown' when either side is silent. */
    state: 'same' | 'differs' | 'unknown';
}

const list = (xs: readonly (string | null | undefined)[] | null | undefined) =>
    [...new Set((xs ?? []).filter((x): x is string => !!x && x.trim() !== ''))];
const show = (xs: string[]) => (xs.length ? xs.join(', ') : '—');
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(dra?|dr)\.?\s+/, '').trim();

/**
 * The record beside one candidate, field by field. Only facts both sides can
 * hold are compared; specialties come in two vocabularies (the source's
 * Spanish label, our specialty keys), so they are shown, never judged.
 */
export function compareRows(c: MatchCompare, cand: CompareCandidate): CompareRow[] {
    const rec = c.record;
    const rows: CompareRow[] = [];

    const sim = cand.similarity;
    rows.push({
        label: 'Name',
        record: rec?.name ?? '—',
        candidate: `${cand.display_name}${sim != null ? ` (${Math.round(sim * 100)}% alike)` : ''}`,
        state: !rec?.name ? 'unknown' : fold(rec.name) === fold(cand.display_name) || (sim ?? 0) >= 0.95 ? 'same' : 'differs',
    });

    const recCed = list(rec?.cedulas);
    const candCed = list(cand.cedulas.map((k) => k.cedula));
    rows.push({
        label: 'Cédula',
        record: show(recCed),
        candidate: show(cand.cedulas.map((k) => (k.title ? `${k.cedula} (${k.title})` : k.cedula))),
        state: !recCed.length || !candCed.length ? 'unknown' : recCed.some((x) => candCed.includes(x)) ? 'same' : 'differs',
    });

    const candRegions = list(cand.listings.map((l) => l.region));
    rows.push({
        label: 'Region',
        record: rec?.region ?? '—',
        candidate: show(candRegions),
        state: !rec?.region || !candRegions.length ? 'unknown' : candRegions.includes(rec.region) ? 'same' : 'differs',
    });

    rows.push({
        label: 'Specialty',
        record: show(list(rec?.specialties)),
        candidate: show(list(cand.listings.flatMap((l) => l.specialty ?? []))),
        state: 'unknown',
    });

    const facts = Object.entries(rec?.facts ?? {}).filter(([, v]) => !!v).map(([k, v]) => `${k}: ${v}`);
    rows.push({
        label: 'Source says',
        record: show([rec?.label ?? null, ...facts].filter((x): x is string => !!x)),
        candidate: show(cand.badges.map((b) => (b.label ? `${b.organization} · ${b.label}` : b.organization))),
        state: 'unknown',
    });

    rows.push({
        label: 'Listings',
        record: rec?.url ? 'source page' : '—',
        candidate: cand.listings.length ? `${cand.listings.length}: ${show(cand.listings.slice(0, 3).map((l) => `${l.name}${l.city ? ` (${l.city})` : ''}`))}` : 'none',
        state: 'unknown',
    });

    return rows;
}

/** Which candidate to show first: the linked doctor, then the AI's pick, then the closest name. */
export function defaultCandidate(c: MatchCompare): CompareCandidate | null {
    return c.candidates.find((x) => x.linked)
        ?? c.candidates.find((x) => c.ai && c.ai.verdict !== 'reject' && x.doctor_id === c.ai.candidate)
        ?? [...c.candidates].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0]
        ?? null;
}
