/**
 * Supabase browser client — uses the PUBLIC anon key only.
 *
 * Security model:
 *  • The anon key is intentionally public (it is bundled into every Vite build).
 *  • Real data protection comes from Row Level Security (RLS) policies in Supabase.
 *  • The SERVICE ROLE key (which bypasses RLS) must NEVER be used here.
 *    It lives only in local scripts (scripts/seed-providers.ts) and is read
 *    exclusively from process.env — never from VITE_ env vars.
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL     ?? '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

// Fail loudly if someone accidentally sets the service-role key as the anon key.
// Service-role JWTs contain `"role":"service_role"` in their payload.
if (import.meta.env.DEV && supabaseAnonKey) {
    try {
        const payload = JSON.parse(atob(supabaseAnonKey.split('.')[1]));
        if (payload?.role === 'service_role') {
            throw new Error(
                '[Supabase] ❌ SECURITY: VITE_SUPABASE_ANON_KEY is set to the SERVICE ROLE key. ' +
                'This key bypasses Row Level Security and must NEVER be used in the browser. ' +
                'Use the "anon" key from your Supabase project settings instead.'
            );
        }
    } catch (e: any) {
        if (e.message.includes('SECURITY')) throw e; // re-throw our own error
        // Decoding failed — not a JWT; ignore
    }
}

export const supabase =
    supabaseUrl && supabaseAnonKey
        ? createClient(supabaseUrl, supabaseAnonKey, {
            // Passkeys are experimental in supabase-js and must be opted into
            // (https://supabase.com/docs/guides/auth/passkeys).
            auth: { experimental: { passkey: true } },
        })
        : null;

// Dev-only connection test
if (import.meta.env.DEV && supabase) {
    supabase
        .from('providers')
        .select('count', { count: 'exact', head: true })
        .then(({ count, error }) => {
            if (error) {
                console.error('[Supabase] ❌ Connection failed:', error.message);
            } else {
                console.log(`[Supabase] ✅ Connected — providers table has ${count ?? 0} rows`);
            }
        });
} else if (import.meta.env.DEV && !supabase) {
    console.warn('[Supabase] ⚠️  No env vars set — running without database');
}
