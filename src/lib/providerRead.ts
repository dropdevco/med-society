import { supabase } from './supabase';

/**
 * Full provider rows (contact fields included) for the pages that need them.
 *
 * Migration 0032 withdrew the browser's table-wide SELECT on `providers`, so
 * `select('*')` no longer works there: one provider's page row comes from
 * `provider_public` (live listings for anyone, throttled per client; pending
 * ones only for the people who manage them) and the owner's dashboard rows from
 * `my_providers`. Anything new that reads providers from the browser must list
 * columns explicitly or go through one of these.
 */

/** One provider's full row, or null when there is none to see. Rejects on any failure (incl. HTTP 429 when throttled). */
export async function fetchProviderRow(id: string): Promise<Record<string, unknown> | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('provider_public', { p_id: id });
    if (error) throw error;
    return (data as Record<string, unknown> | null) ?? null;
}

/** The signed-in user's own listings among `ids`, every column. */
export async function fetchMyProviderRows(ids: string[]): Promise<Record<string, unknown>[]> {
    if (!supabase || ids.length === 0) return [];
    const { data, error } = await supabase.rpc('my_providers', { p_ids: ids });
    if (error) throw error;
    return (data as Record<string, unknown>[] | null) ?? [];
}
