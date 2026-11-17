import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { REGION_IDS, type RegionId } from '../utils/region';

export interface OtherRegionMatches {
    region: RegionId;
    total: number;
    /** A few of the names, so the visitor can tell it's the one they meant. */
    names: { id: string; name: string }[];
}

/**
 * Search is scoped to one region, so a name typed while browsing the other
 * city ("poliplaza" while on Tijuana) finds nothing and says so, although the
 * listing exists. When the region has no match, this asks the other region,
 * by name only, so the empty state can offer to switch.
 *
 * One small read on `provider_list` (public columns only), every word of
 * three or more letters in the name, debounced; nothing when `enabled` is false.
 */
export function useOtherRegionMatches(query: string, region: RegionId, enabled: boolean): OtherRegionMatches | null {
    const [result, setResult] = useState<{ key: string; value: OtherRegionMatches | null } | null>(null);
    const words = query.trim().split(/\s+/).map((w) => w.replace(/[%_,()]/g, '')).filter((w) => w.length >= 3).slice(0, 4);
    const other = REGION_IDS.find((r) => r !== region) ?? null;
    const key = enabled && other && words.length > 0 ? `${other}|${words.join(' ').toLowerCase()}` : '';

    useEffect(() => {
        if (!key || !supabase || !other) return;
        let live = true;
        const id = window.setTimeout(() => {
            let q = supabase!.from('provider_list').select('id, name', { count: 'exact' }).eq('region', other);
            for (const w of words) q = q.ilike('name', `%${w}%`);
            void q.order('reviewCount', { ascending: false }).limit(3).then(({ data, count, error }) => {
                if (!live) return;
                const total = error ? 0 : (count ?? data?.length ?? 0);
                setResult({ key, value: total > 0 ? { region: other, total, names: (data ?? []) as { id: string; name: string }[] } : null });
            });
        }, 400);
        return () => { live = false; window.clearTimeout(id); };
        // `words` is derived from `key`.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, other]);

    return key && result?.key === key ? result.value : null;
}
