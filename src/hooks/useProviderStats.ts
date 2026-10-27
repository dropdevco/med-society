import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Rec = Record<string, number>;

export interface StatsTotals {
    impressions: number;
    avg_position: number | null;
    clicks: number;
    views: number;
    visitors: number;
    contacts: number;
    inquiries: number;
}

/**
 * What `my_provider_stats()` returns (supabase/migrations/0031_provider_stats.sql).
 * Which fields are present depends on the plan — the database leaves the rest out
 * rather than the page hiding them — so everything beyond `ready` is optional.
 */
export interface ProviderStats {
    tier: 'basic' | 'promoted' | 'featured';
    /** False until the listing has enough real traffic to be worth showing. */
    ready: boolean;
    min_views?: number;
    collecting_since?: string | null;
    /** Basic and up. */
    views_30d?: number;
    /** Promoted and up. */
    totals?: StatsTotals;
    prev?: StatsTotals;
    /** The previous 30 days are fully covered by what we have, so a comparison is fair. */
    prev_complete?: boolean;
    contacts_by_method?: Rec;
    sources?: Rec;
    plan_lift?: { since: string; before_per_day: number; after_per_day: number } | null;
    /** Featured. */
    daily?: { day: string; views: number; contacts: number; impressions: number }[];
    countries?: Rec;
    devices?: Rec;
    langs?: Rec;
    sections?: Rec;
    /** Views by hour of day on the clinic's clock, 24 entries. */
    by_hour?: number[];
    /** Views by weekday, Sunday first, 7 entries. */
    by_dow?: number[];
    benchmark?: { percentile: number; peers: number; specialty: string } | null;
    demand?: {
        searches: number;
        no_results: number;
        filters: Rec;
        terms: { term: string; searches: number }[];
    } | null;
}

/**
 * The signed-in owner's analytics for one listing.
 *
 * The result remembers which listing it belongs to, so switching clinics shows
 * "loading" rather than the previous clinic's numbers for a moment.
 */
export function useProviderStats(providerId: string | null) {
    const [state, setState] = useState<{ id: string | null; stats: ProviderStats | null; error: boolean }>({
        id: null, stats: null, error: false,
    });

    useEffect(() => {
        if (!supabase || !providerId) return;
        let cancelled = false;
        void supabase.rpc('my_provider_stats', { p_provider: providerId }).then(({ data, error }) => {
            if (cancelled) return;
            setState({ id: providerId, stats: error || !data ? null : (data as ProviderStats), error: Boolean(error || !data) });
        });
        return () => { cancelled = true; };
    }, [providerId]);

    const settled = state.id === providerId;
    return {
        stats: settled ? state.stats : null,
        loading: Boolean(supabase && providerId) && !settled,
        error: settled && state.error,
    };
}
