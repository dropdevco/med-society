import { useEffect, useState } from 'react';
import type { Specialty } from '../types/provider';
import type { RegionId } from '../utils/region';

export interface AiQuote {
    reviewId: string;
    body: string;
    sourceLang: 'es' | 'en' | null;
    /** `body` is our translation of a review written in `sourceLang`. */
    translated: boolean;
    rating: number | null;
    outcome: string | null;
}

export interface AiSearchResult {
    isConcern: boolean;
    emergency: boolean;
    /** Kinds of doctor worth seeing, best first. Absent on answers cached before the list existed. */
    specialties?: Specialty[];
    specialty: Specialty | null;
    guidance: string;
    doctors: { providerId: string; quotes: AiQuote[] }[];
}

/** The specialties an answer points to, whichever shape it arrived in. */
export function specialtiesOf(result: AiSearchResult | null | undefined): Specialty[] {
    if (!result) return [];
    return result.specialties ?? (result.specialty ? [result.specialty] : []);
}

/** Session cache, keyed by region too (one region's answer is never shown in another). Re-running the same search (back button, a chip toggled and untoggled) is free. */
const cache = new Map<string, AiSearchResult>();

/**
 * Symptom search over patient reviews (api/ai-search.ts).
 *
 * Pass `null` to stay idle. The request takes a few seconds (two model calls),
 * so a superseded query is aborted rather than left to land late and overwrite
 * the answer to the newer one. Only reviews of doctors in `region` are searched
 * (migration 0022), so switching region re-runs the search.
 */
export function useAiSearch(query: string | null, lang: 'en' | 'es', region: RegionId) {
    const key = query ? `${region}:${lang}:${query.trim().toLowerCase()}` : '';
    // Only the outcome of a finished request lives in state; "loading" and
    // "cached" are read off the key during render, so the effect never has to
    // set state synchronously.
    const [settled, setSettled] = useState<{ key: string; result: AiSearchResult | null } | null>(null);

    useEffect(() => {
        if (!query || cache.has(key)) return;
        const ctrl = new AbortController();
        fetch('/api/ai-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, lang, region }),
            signal: ctrl.signal,
        })
            .then((r) => r.json())
            .then((json) => {
                // Any failure (not configured, rate limited, upstream down) just
                // means no AI panel; the ordinary results are unaffected.
                const result: AiSearchResult | null = json?.ok ? json : null;
                if (result) cache.set(key, result);
                setSettled({ key, result });
            })
            .catch((err) => {
                if (err?.name !== 'AbortError') setSettled({ key, result: null });
            });
        return () => ctrl.abort();
    }, [key, query, lang, region]);

    if (!query) return { result: null, loading: false };
    const cached = cache.get(key);
    if (cached) return { result: cached, loading: false };
    // Never show the answer to a previous query while the new one loads.
    if (settled?.key === key) return { result: settled.result, loading: false };
    return { result: null, loading: true };
}
