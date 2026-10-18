import { useEffect, useState } from 'react';
import type { Provider } from '../types/provider';
import { supabase } from '../lib/supabase';
import { fetchProviderRow } from '../lib/providerRead';
import { normalizeProvider } from '../utils/normalizeProvider';
import { mockProviders } from '../data/providers';

interface ProviderResult {
    id: string;
    /** null once the fetch has settled and found nothing — distinct from "not fetched yet". */
    provider: Provider | null;
}

/**
 * A single provider by id, for the dedicated provider page.
 *
 * Same source as the rest of the directory (`ClaimPage` fetches the very same
 * way): Supabase first, falling back to `mockProviders` when there is no
 * client configured or the row can't be found — so a `/providers/:id` link
 * built from mock data during local dev, or hit while Supabase is down,
 * still resolves.
 *
 * `loading` is derived from comparing the requested id against the id the
 * last-settled result was fetched for, rather than a separate boolean set at
 * the top of the effect — a synchronous `setLoading(false)` on entry is what
 * this project's lint rule (`react-hooks/set-state-in-effect`) flags, and
 * deriving it sidesteps that entirely: state changes only ever happen inside
 * the `.then` callback below.
 */
export function useProvider(id: string | undefined): { provider: Provider | null; loading: boolean } {
    const [result, setResult] = useState<ProviderResult | null>(null);

    useEffect(() => {
        if (!id) return;
        let live = true;

        const fallback = (): Provider | null => mockProviders.find((p) => p.id === id) ?? null;

        if (!supabase) {
            // Resolved as a microtask, like the Supabase branch below, so the
            // setState always happens inside an async callback rather than
            // synchronously in the effect body itself.
            Promise.resolve().then(() => {
                if (live) setResult({ id, provider: fallback() });
            });
            return () => { live = false; };
        }

        // Contact columns are not readable from the browser's table grant
        // (migration 0032), so the full row comes through a function: one
        // provider per call, throttled per client. See lib/providerRead.ts.
        fetchProviderRow(id)
            .then((row) => (row ? normalizeProvider(row) : fallback()))
            .catch(fallback)
            .then((provider) => {
                if (live) setResult({ id, provider });
            });

        return () => { live = false; };
    }, [id]);

    const loading = !id ? false : result?.id !== id;
    const provider = result && result.id === id ? result.provider : null;
    return { provider, loading };
}
