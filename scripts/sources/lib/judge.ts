/**
 * Green or red, per docs/adr/0004. A red run is recorded but never replaces
 * the last good one, so a site being down can't take a badge away.
 */
import type { SourceEntry } from './types';

export interface TargetOutcome {
    key: string;
    url: string;
    ok: boolean;
    count: number;
    error?: string;
}

export interface Verdict {
    status: 'green' | 'red';
    reasons: string[];
}

/** A target whose count falls by more than this against the last good run turns the run red. */
export const MAX_DROP = 0.3;

export function judgeRun(
    targets: TargetOutcome[],
    entries: SourceEntry[],
    lastGoodCounts: Record<string, number> | null,
): Verdict {
    const reasons: string[] = [];
    for (const t of targets) {
        if (!t.ok) {
            reasons.push(`${t.key}: ${t.error ?? 'failed'}`);
            continue;
        }
        if (t.count === 0) {
            reasons.push(`${t.key}: no entries parsed (layout change?)`);
            continue;
        }
        const before = lastGoodCounts?.[t.key];
        if (before && t.count < before * (1 - MAX_DROP)) {
            reasons.push(`${t.key}: ${t.count} entries, down from ${before} (more than ${MAX_DROP * 100}%)`);
        }
    }
    if (targets.length === 0) reasons.push('no targets');
    const nameless = entries.filter((e) => !e.name).length;
    if (entries.length && nameless / entries.length > 0.5) reasons.push(`${nameless} of ${entries.length} entries have no name`);
    return { status: reasons.length ? 'red' : 'green', reasons };
}

/**
 * One entry per externalId. A doctor listed twice (or on two targets) keeps
 * the first card's name and the union of sites, specialties and cédulas.
 */
export function mergeEntries(entries: SourceEntry[]): SourceEntry[] {
    const byId = new Map<string, SourceEntry>();
    for (const e of entries) {
        const seen = byId.get(e.externalId);
        if (!seen) {
            byId.set(e.externalId, { ...e, sites: [...e.sites], specialties: [...e.specialties], cedulas: [...e.cedulas] });
            continue;
        }
        for (const s of e.sites) {
            if (!seen.sites.some((x) => x.name === s.name && x.office === s.office)) seen.sites.push(s);
        }
        for (const s of e.specialties) if (!seen.specialties.includes(s)) seen.specialties.push(s);
        for (const c of e.cedulas) if (!seen.cedulas.includes(c)) seen.cedulas.push(c);
    }
    return [...byId.values()];
}
