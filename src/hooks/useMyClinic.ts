import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Provider } from '../types/provider';
import { supabase } from '../lib/supabase';
import { fetchMyProviderRows } from '../lib/providerRead';
import { normalizeProvider } from '../utils/normalizeProvider';

export interface ClaimRow {
    id: string;
    provider_id: string;
    status: 'incomplete' | 'pending' | 'needs_info' | 'approved' | 'rejected';
    created_at: string;
    /** The reviewer's message to the claimant (needs_info / rejected). */
    review_note: string | null;
}

/**
 * How this user comes to manage a listing:
 *   owner    claimed it, or was invited onto the clinic as an owner
 *   staff    front desk / administrator: everything but speaking as it
 *   managed  a doctor's listing a clinic this user is on created, or that the
 *            doctor lets the clinic edit (clinic_practitioners.managed)
 */
export type ListingAccess = 'owner' | 'staff' | 'managed';

/** A clinic asking to list one of this user's own listings as its doctor. */
export interface PendingClinicLink {
    clinic_id: string;
    practitioner_id: string;
    clinic_name: string;
    clinic_city: string | null;
}

/**
 * Everything the dashboard needs to know about who this user is to us: the
 * listings they manage and how, clinics waiting on them, and the claims still
 * waiting on a person.
 *
 * All of it comes back from RLS-scoped reads: `provider_owners` and
 * `provider_claims` return the caller's own rows, `clinic_practitioners` the
 * links the caller's listings are party to, and `my_providers` only listings
 * `manages_provider()` allows. There is no filtering here to get wrong.
 */
export function useMyClinic(userId: string | null) {
    const [owned, setOwned] = useState<Provider[]>([]);
    const [access, setAccess] = useState<Record<string, ListingAccess>>({});
    const [pendingLinks, setPendingLinks] = useState<PendingClinicLink[]>([]);
    const [claims, setClaims] = useState<ClaimRow[]>([]);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(async () => {
        if (!supabase || !userId) {
            setOwned([]);
            setAccess({});
            setPendingLinks([]);
            setClaims([]);
            setLoading(false);
            return;
        }

        setLoading(true);

        const [ownerRes, claimRes] = await Promise.all([
            supabase.from('provider_owners').select('provider_id, role'),
            supabase.from('provider_claims').select('id, provider_id, status, created_at, review_note'),
        ]);

        const next: Record<string, ListingAccess> = {};
        for (const row of ownerRes.data ?? []) {
            next[row.provider_id as string] = row.role === 'staff' ? 'staff' : 'owner';
        }

        const mine = Object.keys(next);
        let pending: PendingClinicLink[] = [];
        if (mine.length > 0) {
            const [managedRes, pendingRes] = await Promise.all([
                // Doctors' listings one of this user's clinics may edit.
                supabase.from('clinic_practitioners').select('practitioner_id')
                    .in('clinic_id', mine).eq('status', 'active').eq('managed', true),
                // Clinics asking to list one of this user's own listings.
                supabase.from('clinic_practitioners')
                    .select('clinic_id, practitioner_id, clinic:providers!clinic_practitioners_clinic_id_fkey(name, city)')
                    .in('practitioner_id', mine).eq('status', 'pending'),
            ]);
            for (const l of managedRes.data ?? []) {
                const id = l.practitioner_id as string;
                if (!next[id]) next[id] = 'managed';
            }
            pending = (pendingRes.data ?? [])
                // Only the doctor's own owners answer for the listing.
                .filter((l) => next[l.practitioner_id as string] === 'owner')
                .map((l) => {
                    const c = (Array.isArray(l.clinic) ? l.clinic[0] : l.clinic) as { name?: string; city?: string } | null;
                    return {
                        clinic_id: l.clinic_id as string,
                        practitioner_id: l.practitioner_id as string,
                        clinic_name: c?.name ?? '',
                        clinic_city: c?.city ?? null,
                    };
                });
        }

        const ids = Object.keys(next);
        if (ids.length > 0) {
            // Own rows only, contact fields included (migration 0032): the
            // table grant no longer lets the browser `select *` providers.
            // my_providers also returns the doctors' listings a clinic manages.
            const rows = await fetchMyProviderRows(ids).catch(() => []);
            // The user's own listings first, then the doctors they run.
            setOwned(rows.map(normalizeProvider).sort((a, b) =>
                Number(next[a.id] === 'managed') - Number(next[b.id] === 'managed')
                || a.name.localeCompare(b.name)));
        } else {
            setOwned([]);
        }

        setAccess(next);
        setPendingLinks(pending);
        setClaims((claimRes.data ?? []) as ClaimRow[]);
        setLoading(false);
    }, [userId]);

    useEffect(() => { void reload(); }, [reload]);

    // The listings this user may sign forum posts with (public.speaks_as_provider).
    const speaksAs = useMemo(() => owned.filter((p) => access[p.id] === 'owner'), [owned, access]);

    return { owned, access, speaksAs, pendingLinks, claims, loading, reload };
}
