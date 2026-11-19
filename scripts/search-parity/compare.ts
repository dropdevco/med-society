/**
 * Differences between two answers, described so a person can act on them:
 * which field, and for ordered lists the first position where they part.
 */
import type { Answer, RegionAnswer } from './types';

export interface Difference {
    field: string;
    detail: string;
}

/** First index where two ordered lists differ, or -1 when they are equal. */
export function firstDivergence(a: readonly string[], b: readonly string[]): number {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return -1;
}

function list(field: string, a: readonly string[], b: readonly string[], out: Difference[]) {
    const at = firstDivergence(a, b);
    if (at === -1) return;
    out.push({
        field,
        detail: `lengths ${a.length} vs ${b.length}; first difference at #${at}: ${a[at] ?? '(end)'} vs ${b[at] ?? '(end)'}`,
    });
}

/** Stable JSON: object keys sorted, so key order never reads as a difference. */
export function stable(v: unknown): string {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
    }
    return JSON.stringify(v ?? null);
}

function same(field: string, a: unknown, b: unknown, out: Difference[]) {
    const sa = stable(a);
    const sb = stable(b);
    if (sa === sb) return;
    const clip = (s: string) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);
    out.push({ field, detail: `${clip(sa)} vs ${clip(sb)}` });
}

export function compareAnswers(expected: Answer, actual: Answer): Difference[] {
    const out: Difference[] = [];
    same('total', expected.total, actual.total, out);
    list('ids', expected.ids, actual.ids, out);
    same('sortApplied', expected.sortApplied, actual.sortApplied, out);
    same('centre', expected.centre, actual.centre, out);
    same('frame', expected.frame, actual.frame, out);
    list('pins', expected.pins, actual.pins, out);
    same('facets.specialty', expected.facets.specialty, actual.facets.specialty, out);
    same('facets.insurance', expected.facets.insurance, actual.facets.insurance, out);
    same('facets.language', expected.facets.language, actual.facets.language, out);
    same('facets.verified', expected.facets.verified, actual.facets.verified, out);
    same('facets.withPricing', expected.facets.withPricing, actual.facets.withPricing, out);
    return out;
}

export function compareRegions(expected: RegionAnswer, actual: RegionAnswer): Difference[] {
    const out: Difference[] = [];
    same('rows', expected.rows, actual.rows, out);
    same('prior', expected.prior, actual.prior, out);
    same('bounds', expected.bounds, actual.bounds, out);
    same('postalCentres', expected.postalCentres, actual.postalCentres, out);
    for (const key of Object.keys(expected.vocabulary) as (keyof RegionAnswer['vocabulary'])[]) {
        same(`vocabulary.${key}`, expected.vocabulary[key], actual.vocabulary[key], out);
    }
    same('providerNames', expected.providerNames, actual.providerNames, out);
    for (const s of expected.suggestions) {
        const other = actual.suggestions.find((x) => x.q === s.q);
        list(`suggestions "${s.q}"`, s.items, other?.items ?? [], out);
    }
    for (const row of expected.home) {
        const other = actual.home.find((x) => x.id === row.id);
        list(`home.${row.id}`, row.ids, other?.ids ?? [], out);
    }
    same('home rows', expected.home.map((r) => r.id), actual.home.map((r) => r.id), out);
    return out;
}
