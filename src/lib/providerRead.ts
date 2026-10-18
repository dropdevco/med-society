import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * Full provider rows (contact fields included) for the pages that need them.
 *
 * Migration 0032 withdrew the browser's table-wide SELECT on `providers`, so
 * `select('*')` no longer works there: one provider's page row comes from
 * `provider_public` (live listings for anyone, throttled per client; pending
 * ones only for the people who manage them) and the owner's dashboard rows from
 * `my_providers`.
 *
 * COMPAT SHIM: until 0032 is applied those functions do not exist and
 * PostgREST answers PGRST202 / 404. Both readers then fall back to the old
 * `select *`, which is what lets the client be deployed BEFORE the migration
 * with no broken window. Delete `functionMissing` and the two fallbacks once
 * 0032 is live everywhere.
 */

/** PostgREST's "no such function" - the migration has not been applied. */
function functionMissing(error: PostgrestError | null): boolean {
    return !!error && (error.code === 'PGRST202' || error.code === '42883');
}

/** One provider's full row, or null when there is none to see. Rejects on any other failure. */
export async function fetchProviderRow(id: string): Promise<Record<string, unknown> | null> {
    if (!supabase) return null;
    const { data, error } = await supabase.rpc('provider_public', { p_id: id });
    if (!error) return (data as Record<string, unknown> | null) ?? null;
    if (!functionMissing(error)) throw error;

    const legacy = await supabase.from('providers').select('*').eq('id', id).maybeSingle();
    if (legacy.error) throw legacy.error;
    return (legacy.data as Record<string, unknown> | null) ?? null;
}

/** The signed-in user's own listings among `ids`, every column. */
export async function fetchMyProviderRows(ids: string[]): Promise<Record<string, unknown>[]> {
    if (!supabase || ids.length === 0) return [];
    const { data, error } = await supabase.rpc('my_providers', { p_ids: ids });
    if (!error) return (data as Record<string, unknown>[] | null) ?? [];
    if (!functionMissing(error)) throw error;

    const legacy = await supabase.from('providers').select('*').in('id', ids);
    if (legacy.error) throw legacy.error;
    return (legacy.data as Record<string, unknown>[] | null) ?? [];
}
