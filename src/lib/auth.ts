import { supabase } from './supabase';
import { track } from './posthog';

/**
 * Sign-in, sign-up and claiming, as four functions that never throw.
 *
 * Every one returns `{ error }` with a message already fit to render, because
 * the alternative is each caller inventing its own try/catch and its own
 * phrasing for the same three failures. `supabase` is nullable by design, so
 * "not configured" is one of those failures rather than a crash.
 */

export interface AuthResult {
    error: string | null;
}

const NOT_CONFIGURED = 'Sign-in is unavailable: Supabase is not configured.';

export async function signIn(email: string, password: string): Promise<AuthResult> {
    if (!supabase) return { error: NOT_CONFIGURED };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    track('sign_in', { ok: !error });
    return { error: error?.message ?? null };
}

/**
 * `redirectTo` is where the confirmation link lands. Optional and absolute;
 * the default is the dashboard. The border-health onboarding passes
 * `/borderhealth?resume=1` so a confirmed account finishes the claim or
 * listing it started instead of arriving at an empty portal.
 */
export async function signUp(email: string, password: string, redirectTo?: string): Promise<AuthResult> {
    if (!supabase) return { error: NOT_CONFIGURED };
    const { error } = await supabase.auth.signUp({
        email,
        password,
        // Back to the claim flow rather than to the marketing page, so a
        // confirmation click lands where the person was going.
        options: { emailRedirectTo: redirectTo ?? `${window.location.origin}/dashboard` },
    });
    track('sign_up', { ok: !error, redirect: redirectTo ? new URL(redirectTo, window.location.origin).pathname : 'dashboard' });
    return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
    track('sign_out');
    await supabase?.auth.signOut();
}

/**
 * Ask to own a listing.
 *
 * Upsert rather than insert: the table holds one claim per person per listing,
 * and someone who submits again after adding better evidence should amend
 * their request rather than collide with it. Approval is manual — nothing
 * here grants anything, and `status` is not a column the client may write.
 */
export async function submitClaim(
    providerId: string,
    userId: string,
    evidence: string,
): Promise<AuthResult> {
    if (!supabase) return { error: NOT_CONFIGURED };

    const { error } = await supabase
        .from('provider_claims')
        .upsert(
            { provider_id: providerId, user_id: userId, evidence },
            { onConflict: 'provider_id,user_id' },
        );

    track('claim_submitted', { provider_id: providerId, ok: !error });
    return { error: error?.message ?? null };
}
