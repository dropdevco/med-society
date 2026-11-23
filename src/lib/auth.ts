import { supabase } from './supabase';
import { track } from './posthog';

/**
 * Sign-in, sign-up and sign-out, as functions that never throw.
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

/**
 * A same-site path from user-controlled input (`?next=`), or the fallback.
 *
 * `${origin}${next}` with `next = "@evil.com"` is `https://medsociety.one@evil.com`,
 * which browsers read as host `evil.com`. Only a single leading slash is a
 * path on this site; `//host` and `/\host` are not.
 */
export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
    if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
    // Control characters (a tab or newline inside "//") are stripped by URL parsers.
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f]/.test(next)) return fallback;
    return next;
}

/**
 * Google refuses OAuth inside embedded webviews (error `disallowed_useragent`):
 * the in-app browsers of WhatsApp, Instagram, Facebook and the like, which is
 * where much of this site's traffic arrives. Detected so the button can say
 * "open in your browser" instead of sending someone to a dead end.
 */
export function isEmbeddedBrowser(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
    if (/FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|LinkedInApp|Twitter/i.test(ua)) return true;
    if (/; wv\)/.test(ua)) return true; // Android WebView
    // iOS WKWebView apps omit "Safari/"; Safari and every iOS browser include it.
    return /iPhone|iPad|iPod/.test(ua) && !/Safari\//.test(ua);
}

/**
 * Leaves the page for Google; the browser comes back to `redirectTo` (an
 * absolute URL on this site, on the Supabase redirect allowlist) with a
 * session in the URL, which `useSession` picks up. Resolves only on failure,
 * since success navigates away.
 *
 * Google accounts arrive with a verified email, so every check in the schema
 * that reads `email_confirmed_at` passes. An existing password account with
 * the same email is linked, not duplicated: `user.id` stays the same.
 */
export async function signInWithGoogle(redirectTo: string): Promise<AuthResult> {
    if (!supabase) return { error: NOT_CONFIGURED };
    track('sign_in', { method: 'google' });
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // Let people pick which of their Google accounts to use.
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
    });
    return { error: error?.message ?? null };
}

/** Whether this browser can do a passkey ceremony at all. */
export function supportsPasskeys(): boolean {
    return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !isEmbeddedBrowser();
}

/**
 * Discoverable-credential sign-in: the device offers the accounts it holds a
 * passkey for, so no email is typed. Only an account that registered a passkey
 * earlier can use it. A cancelled prompt comes back as an error, which the
 * caller shows as a quiet message rather than a failure.
 */
export async function signInWithPasskey(): Promise<AuthResult> {
    if (!supabase) return { error: NOT_CONFIGURED };
    const { error } = await supabase.auth.signInWithPasskey();
    track('sign_in', { method: 'passkey', ok: !error });
    return { error: error?.message ?? null };
}

/** For a signed-in user: add a passkey to their account. */
export async function registerPasskey(): Promise<AuthResult> {
    if (!supabase) return { error: NOT_CONFIGURED };
    const { error } = await supabase.auth.registerPasskey();
    track('passkey_registered', { ok: !error });
    return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
    track('sign_out');
    await supabase?.auth.signOut();
}

// Claiming a listing lives in ./claims.ts (claim_submit, migration 0047).
