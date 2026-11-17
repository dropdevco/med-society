/**
 * The pipeline's database client (service role: it bypasses RLS, so it stays
 * server-side). SOURCES_DB_URL points it at the local sandbox instead of
 * production; scripts/sources/sandbox sets it.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export function database(): SupabaseClient {
    const url = process.env.SOURCES_DB_URL ?? process.env.VITE_SUPABASE_URL;
    const key = process.env.SOURCES_DB_URL ? 'sandbox' : process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are needed (see .env.example)');
    return createClient(url, key, { auth: { persistSession: false } });
}

export const isSandbox = () => !!process.env.SOURCES_DB_URL;

/** Read every row of a query, 1,000 at a time: Supabase caps a select at 1,000. */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await page(from, from + 999);
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as T[];
        out.push(...rows);
        if (rows.length < 1000) return out;
    }
}

/** Run a write over a big array in slices. */
export async function inChunks<T>(rows: T[], size: number, write: (chunk: T[]) => PromiseLike<{ error: { message: string } | null }>): Promise<void> {
    for (let i = 0; i < rows.length; i += size) {
        const { error } = await write(rows.slice(i, i + size));
        if (error) throw new Error(error.message);
    }
}
