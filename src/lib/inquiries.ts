import { supabase } from './supabase';

export interface InquiryPayload {
    providerId: string;
    providerName: string;
    name: string;
    contact: string;
    message: string;
    preferredTime?: string;
    language: 'en' | 'es';
    sourceUrl?: string;
    /** Honeypot. Real users never fill it. */
    website?: string;
}

export type InquiryOutcome =
    | { ok: true }
    | { ok: false; error: 'auth' | 'invalid' | 'too_many' | 'server' | 'network' };

/**
 * Posts a patient's message to /api/inquiry. Never throws.
 *
 * Sending needs an account: the API refuses a request with no valid access
 * token, so this asks Supabase for the current one at send time (not when the
 * page loaded) — it refreshes an expired token itself, which a copy taken at
 * mount would not. No session is the same outcome as the API's 401: `auth`,
 * meaning "sign in again", not "something broke".
 */
export async function sendInquiry(payload: InquiryPayload): Promise<InquiryOutcome> {
    try {
        const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined;
        if (!token) return { ok: false, error: 'auth' };

        const res = await fetch('/api/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(payload),
        });
        if (res.ok) return { ok: true };
        if (res.status === 401) return { ok: false, error: 'auth' };
        if (res.status === 429) return { ok: false, error: 'too_many' };
        if (res.status === 400) return { ok: false, error: 'invalid' };
        return { ok: false, error: 'server' };
    } catch {
        return { ok: false, error: 'network' };
    }
}
