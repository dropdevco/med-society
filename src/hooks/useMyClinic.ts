import { useCallback, useEffect, useState } from 'react';
import type { Provider } from '../types/provider';
import { supabase } from '../lib/supabase';
import { fetchMyProviderRows } from '../lib/providerRead';
import { normalizeProvider } from '../utils/normalizeProvider';

export interface ClaimRow {
    id: string;
    provider_id: string;
    status: 'pending' | 'approved' | 'rejected';
    created_at: string;
}

/**
 * Everything the dashboard needs to know about who this user is to us: the
 * listings they own, and the claims still waiting on a person.
 *
 * Both come back from RLS-scoped selects — `provider_owners` and
 * `provider_claims` only ever return the caller's own rows — so there is no
 * filtering to get wrong here, and nothing to leak if there were.
 */
export function useMyClinic(userId: string | null) {
    const [owned, setOwned] = useState<Provider[]>([]);
    const [claims, setClaims] = useState<ClaimRow[]>([]);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        if (!supabase || !userId) {
            setOwned([]);
            setClaims([]);
            setLoading(false);
            return;
        }

        setLoading(true);

        const [ownerRes, claimRes] = await Promise.all([
            supabase.from('provider_owners').select('provider_id'),
            supabase.from('provider_claims').select('id, provider_id, status, created_at'),
        ]);

        const ids = (ownerRes.data ?? []).map((row) => row.provider_id as string);

        if (ids.length > 0) {
            // Own rows only, contact fields included (migration 0032): the
            // table grant no longer lets the browser `select *` providers.
            const rows = await fetchMyProviderRows(ids).catch(() => []);
            setOwned(rows.map(normalizeProvider));
        } else {
            setOwned([]);
        }

        setClaims((claimRes.data ?? []) as ClaimRow[]);
        setLoading(false);
    }, [userId]);

    useEffect(() => { void reload(); }, [reload]);

    return { owned, claims, loading, reload };
}
