import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { ProviderBadge, Specialty } from '../types/provider';

/** A doctor on a clinic's page. Same public columns as a search card; never contact details. */
export interface TeamDoctor {
    id: string;
    name: string;
    specialty: Specialty[];
    imageUrl: string | null;
    city: string | null;
    rating: number | null;
    reviewCount: number | null;
    badges: ProviderBadge[];
    serviceNames: string[];
}

/** A clinic on a doctor's page ("Practises at"). */
export interface TeamClinic {
    id: string;
    name: string;
    city: string | null;
    imageUrl: string | null;
    specialty: Specialty[];
    rating: number | null;
    reviewCount: number | null;
}

export interface ProviderTeam {
    practitioners: TeamDoctor[];
    clinics: TeamClinic[];
}

const EMPTY: ProviderTeam = { practitioners: [], clinics: [] };
// Opening the same profile twice (modal, then page) reads it once.
const cache = new Map<string, ProviderTeam>();

/**
 * Who practises at this clinic, or where this doctor practises: active links
 * to live listings only (provider_team, migration 0049). Empty, not an error,
 * when the database has no roster for it or the function is not there yet.
 */
export function useProviderTeam(providerId: string | undefined) {
    const [state, setState] = useState<{ id: string; team: ProviderTeam } | null>(() =>
        providerId && cache.has(providerId) ? { id: providerId, team: cache.get(providerId)! } : null);

    useEffect(() => {
        if (!providerId || !supabase || cache.has(providerId)) return;
        let live = true;
        void supabase.rpc('provider_team', { p_id: providerId }).then(({ data, error }) => {
            const team: ProviderTeam = error || !data
                ? EMPTY
                : {
                    practitioners: ((data as ProviderTeam).practitioners ?? []).map((d) => ({
                        ...d, badges: d.badges ?? [], serviceNames: d.serviceNames ?? [], specialty: d.specialty ?? [],
                    })),
                    clinics: (data as ProviderTeam).clinics ?? [],
                };
            if (!error) cache.set(providerId, team);
            if (live) setState({ id: providerId, team });
        });
        return () => { live = false; };
    }, [providerId]);

    const team = providerId && cache.has(providerId)
        ? cache.get(providerId)!
        : state && state.id === providerId ? state.team : EMPTY;
    const loading = Boolean(providerId && supabase && !cache.has(providerId) && state?.id !== providerId);
    return { team, loading };
}
