/**
 * Network side of the survey, ported from bh.js + the static page's send().
 *
 * bh_responses is write-only for anon: insert without `.select()` (returning
 * the row would need a SELECT policy that deliberately does not exist). The
 * client-generated `submission_key` is how onboarding finds the row later.
 *
 * Nothing here may throw into the page except the insert itself, whose
 * failure the form shows as "tap send again" with every answer kept.
 */
import { supabase } from '../../lib/supabase';
import type { BhLang, BhSegment } from './types';

const TABLE = 'bh_responses';

/** ?session=test keeps dry runs out of the real numbers. */
export function getSession(search: string): string {
    return new URLSearchParams(search).get('session') || 'live';
}

/** ?by=kevyn records who sat with the person. Absent means a shared link. */
export function getRef(search: string): string {
    const p = new URLSearchParams(search);
    return (p.get('by') || p.get('ref') || 'link').slice(0, 40);
}

let cachedClientId: string | null = null;
/**
 * Stable per-device id (same key and format as the static page's bh.js), so a
 * duplicate from the same phone is visible in the data without blocking a
 * second real person on Kevyn's phone.
 */
export function getClientId(): string {
    if (cachedClientId) return cachedClientId;
    let id: string | null = null;
    try {
        id = localStorage.getItem('bh_cid');
        if (!id) {
            id = 'c' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
            localStorage.setItem('bh_cid', id);
        }
    } catch {
        id = 'c' + Math.random().toString(36).slice(2, 10);
    }
    cachedClientId = id;
    return id;
}

function cut(v: unknown, n: number): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, n) : null;
}

export function newSubmissionKey(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    } catch { /* fall through */ }
    // RFC 4122 v4 fallback for very old browsers.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

export interface ResponseFields {
    submissionKey: string;
    session: string;
    ref: string;
    segment: BhSegment;
    lang: BhLang;
    industry: string | null;
    city: string | null;
    answers: Record<string, unknown>;
    contact_name?: string;
    contact_org?: string;
    contact_email?: string;
    contact_phone?: string;
    follow_up: boolean | null;
    duration_s: number | null;
}

/**
 * One row per finished form. Column lengths mirror the RLS insert policy, so a
 * row is trimmed here rather than rejected there. user_id / provider_id /
 * claim_id / outcome are never sent (the anon policy requires them null).
 */
export async function insertResponse(f: ResponseFields): Promise<void> {
    if (!supabase) throw new Error('offline');
    const row = {
        submission_key: f.submissionKey,
        session: cut(f.session, 40) || 'live',
        form_slug: typeof window !== 'undefined' && window.location.pathname.startsWith('/research') ? 'research' : 'borderhealth',
        segment: f.segment,
        lang: f.lang,
        ref: cut(f.ref, 40),
        client_id: cut(getClientId(), 40),
        industry: cut(f.industry, 80),
        city: cut(f.city, 80),
        answers: f.answers || {},
        contact_name: cut(f.contact_name, 120),
        contact_org: cut(f.contact_org, 160),
        contact_email: cut(f.contact_email, 160),
        contact_phone: cut(f.contact_phone, 40),
        follow_up: typeof f.follow_up === 'boolean' ? f.follow_up : null,
        duration_s: f.duration_s != null ? Math.max(0, Math.min(86400, Math.round(f.duration_s))) : null,
        ua: cut(typeof navigator !== 'undefined' ? navigator.userAgent : null, 300),
    };
    const { error } = await supabase.from(TABLE).insert([row]);
    // 23505 = unique violation on submission_key: an earlier attempt with this
    // same key already committed and only its response was lost. That is a success.
    if (error && error.code !== '23505') throw error;
}

export interface LeadBody {
    segment: BhSegment;
    lang: BhLang;
    name?: string;
    org?: string;
    email?: string;
    phone?: string;
    whatsapp?: string;
    industry: string | null;
    city: string | null;
    ref: string;
    session: string;
    follow_up: boolean;
    follow_up_key?: string;
    variant?: 'research' | 'medsociety';
    /** Client-generated uuid; also stored on bh_responses.submission_key. */
    submission_key: string;
    /** Same answers object inserted into bh_responses.answers (for GHL custom fields). */
    answers: Record<string, unknown>;
}

/**
 * The lead goes to the MedSociety CRM through a function that holds the
 * token. Best effort: if it fails the survey still counts.
 */
export function pushLead(body: LeadBody): void {
    try {
        fetch('/api/borderhealth-lead', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...body, variant: window.location.pathname.startsWith('/research') ? 'research' : 'medsociety' }),
        }).catch(() => { /* ignored */ });
    } catch { /* never blocks the thank-you */ }
}
