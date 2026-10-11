/**
 * POST /api/inquiry
 *
 * A patient asks MedSociety a question about a provider. We store it in
 * `public.patient_inquiries` (supabase/migrations/0009_patient_inquiries.sql)
 * and email the team via Resend, then we contact the clinic on the patient's
 * behalf. This replaces the old "Book on Doctoralia" link.
 *
 * The insert happens here with the service role, not from the browser with the
 * anon key (as the `leads` table does): the table has RLS on and no policies,
 * so this function's validation, honeypot and rate limit cannot be bypassed by
 * talking to Supabase directly.
 *
 * ── Who may send ─────────────────────────────────────────────────────────────
 * Only a signed-in patient. The browser sends its Supabase access token as
 * `Authorization: Bearer <token>`; this function asks Supabase Auth who it
 * belongs to (the signature is never trusted locally) and refuses anonymous,
 * email-less and unconfirmed accounts with 401. The account is recorded on the
 * row (`user_id`, migration 0026) and its verified email goes to the team, so a
 * message can always be traced to a real, reachable person. Hiding the Send
 * button is only manners; this is the actual gate.
 *
 * ── Env (server-only, Vercel → Settings → Environment Variables) ─────────────
 *   VITE_SUPABASE_URL (or SUPABASE_URL)   already set
 *   SUPABASE_SERVICE_ROLE_KEY             must be set in Vercel (was scripts-only)
 *   RESEND_API_KEY, LEAD_NOTIFY_TO, LEAD_NOTIFY_FROM   same as api/lead-notify.ts
 *
 * The email is best-effort: if it fails after the row is saved we log it and
 * still return ok, because the inquiry is safely stored either way.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage & { body?: unknown; socket?: { remoteAddress?: string } };
type Res = ServerResponse & {
    status: (code: number) => Res;
    json: (body: unknown) => void;
};

const SITE = 'https://medsociety.one';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TIMES = new Set(['morning', 'afternoon', 'evening', 'any']);

/* Best-effort per-IP limit. In-memory: each serverless instance keeps its own
 * counter and it resets on cold start, so a determined attacker spread across
 * instances is not stopped. It only blunts a single noisy client. */
const HITS = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;

function rateLimited(ip: string): boolean {
    const now = Date.now();
    const seen = (HITS.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (seen.length >= MAX_PER_WINDOW) {
        HITS.set(ip, seen);
        return true;
    }
    seen.push(now);
    HITS.set(ip, seen);
    if (HITS.size > 500) {
        for (const [k, v] of HITS) if (!v.some((t) => now - t < WINDOW_MS)) HITS.delete(k);
    }
    return false;
}

/** Strips control chars, collapses whitespace (optionally keeping newlines), caps length. */
function clean(v: unknown, max: number, multiline = false): string {
    let s = typeof v === 'string' ? v : v == null ? '' : String(v);
    // eslint-disable-next-line no-control-regex
    s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
    s = multiline
        ? s.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')
        : s.replace(/\s+/g, ' ');
    return s.trim().slice(0, max);
}

function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** The account behind a request, as far as this function needs to know. */
export interface AuthUser {
    id: string;
    email: string;
}

/** `Authorization: Bearer <token>` → the token, or null for anything else. */
export function bearerToken(header: string | string[] | undefined): string | null {
    const raw = Array.isArray(header) ? header[0] : header;
    const m = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/.exec((raw ?? '').trim());
    return m ? m[1] : null;
}

/**
 * Who a token belongs to, asked of Supabase Auth itself (GET /auth/v1/user) so a
 * forged, expired or revoked token fails here. Null means "not a usable
 * account": no such user, an anonymous sign-in, or no confirmed email.
 */
export async function getAuthUser(
    token: string,
    url: string,
    apikey: string,
    doFetch: typeof fetch = fetch,
): Promise<AuthUser | null> {
    try {
        const r = await doFetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
            headers: { apikey, Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return null;
        const u = (await r.json()) as {
            id?: unknown;
            email?: unknown;
            email_confirmed_at?: unknown;
            is_anonymous?: unknown;
        };
        if (typeof u.id !== 'string' || !UUID.test(u.id)) return null;
        if (typeof u.email !== 'string' || !EMAIL.test(u.email)) return null;
        if (u.is_anonymous === true || !u.email_confirmed_at) return null;
        return { id: u.id, email: u.email };
    } catch {
        return null;
    }
}

export interface InquiryRow {
    provider_id: string | null;
    provider_name: string | null;
    patient_name: string;
    contact: string;
    contact_kind: 'phone' | 'email';
    message: string;
    preferred_time: string | null;
    language: 'en' | 'es';
    source_url: string | null;
}

export type Parsed =
    | { ok: true; honeypot: false; row: InquiryRow }
    | { ok: false; honeypot: boolean; error: string };

/** Validation layer, exported so it can be tested without any I/O. */
export function parseInquiry(body: unknown): Parsed {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

    if (clean(b.website, 200)) return { ok: false, honeypot: true, error: 'honeypot' };

    if (typeof b.message === 'string' && b.message.trim().length > 2000) {
        return { ok: false, honeypot: false, error: 'message_too_long' };
    }
    const name = clean(b.name, 120);
    const message = clean(b.message, 2000, true);
    if (name.length < 2) return { ok: false, honeypot: false, error: 'bad_name' };
    if (message.length < 5) return { ok: false, honeypot: false, error: 'bad_message' };

    const contact = clean(b.contact, 200);
    let kind: 'phone' | 'email';
    if (contact.includes('@')) {
        if (!EMAIL.test(contact)) return { ok: false, honeypot: false, error: 'bad_contact' };
        kind = 'email';
    } else {
        const digits = contact.replace(/\D/g, '');
        if (digits.length < 8 || digits.length > 15 || !/^[\d\s+().-]+$/.test(contact)) {
            return { ok: false, honeypot: false, error: 'bad_contact' };
        }
        kind = 'phone';
    }

    const providerId = clean(b.providerId, 64);
    const time = clean(b.preferredTime, 20).toLowerCase();
    const sourceUrl = clean(b.sourceUrl, 500);

    return {
        ok: true,
        honeypot: false,
        row: {
            provider_id: UUID.test(providerId) ? providerId : null,
            provider_name: clean(b.providerName, 200) || null,
            patient_name: name,
            contact,
            contact_kind: kind,
            message,
            preferred_time: TIMES.has(time) ? time : null,
            language: clean(b.language, 2) === 'en' ? 'en' : 'es',
            source_url: /^https?:\/\//i.test(sourceUrl) ? sourceUrl : null,
        },
    };
}

type StoredRow = InquiryRow & { user_id: string };

async function insertRow(row: StoredRow, url: string, key: string): Promise<boolean> {
    const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/patient_inquiries`, {
        method: 'POST',
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
    });
    if (!r.ok) console.error('[inquiry] insert failed:', r.status, (await r.text().catch(() => '')).slice(0, 300));
    return r.ok;
}

async function sendEmail(row: InquiryRow, account: AuthUser): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_NOTIFY_FROM;
    const to = (process.env.LEAD_NOTIFY_TO ?? '').split(',').map((a) => a.trim()).filter(Boolean);
    if (!apiKey || !from || to.length === 0) {
        console.error('[inquiry] email not configured (RESEND_API_KEY / LEAD_NOTIFY_FROM / LEAD_NOTIFY_TO)');
        return;
    }
    const link = row.provider_id ? `${SITE}/providers/${row.provider_id}` : null;
    const clinic = row.provider_name ?? 'unknown provider';
    const subject = `Patient question for ${clinic}`;
    const rows: [string, string | null][] = [
        ['Provider', clinic],
        ['Provider id', row.provider_id],
        ['Patient', row.patient_name],
        [row.contact_kind === 'email' ? 'Email' : 'Phone', row.contact],
        // The verified sign-in, which can differ from the contact they chose to be answered at.
        ['Account', account.email],
        ['Preferred time', row.preferred_time],
        ['Language', row.language],
    ];
    const present = rows.filter((r): r is [string, string] => Boolean(r[1]));
    const html =
        `<h2 style="margin:0 0 16px;font:600 18px system-ui,sans-serif">${esc(subject)}</h2>` +
        '<table style="border-collapse:collapse;font:14px system-ui,sans-serif">' +
        present
            .map(
                ([l, v]) =>
                    `<tr><td style="padding:4px 16px 4px 0;color:#666">${esc(l)}</td>` +
                    `<td style="padding:4px 0"><strong>${esc(v)}</strong></td></tr>`
            )
            .join('') +
        '</table>' +
        `<p style="margin:16px 0 0;font:14px system-ui,sans-serif;white-space:pre-wrap">${esc(row.message)}</p>` +
        (link
            ? `<p style="margin:16px 0 0;font:14px system-ui,sans-serif"><a href="${esc(link)}">${esc(link)}</a></p>`
            : '');
    const text =
        present.map(([l, v]) => `${l}: ${v}`).join('\n') + `\n\n${row.message}` + (link ? `\n\n${link}` : '');

    const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from,
            to,
            subject,
            html,
            text,
            reply_to: row.contact_kind === 'email' ? row.contact : account.email,
        }),
    });
    if (!r.ok) console.error('[inquiry] resend failed:', r.status, (await r.text().catch(() => '')).slice(0, 300));
}

export default async function handler(req: Req, res: Res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const fwd = req.headers['x-forwarded-for'];
    const fwdValue = Array.isArray(fwd) ? fwd[0] : fwd;
    const ip = (fwdValue ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'too_many' });

    // No token, no message. Checked before the body is even read.
    const token = bearerToken(req.headers.authorization);
    if (!token) return res.status(401).json({ ok: false, error: 'auth_required' });

    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = {};
        }
    }
    if (body === undefined) {
        // Dev server (and any runtime that doesn't pre-parse): read the stream.
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            body = {};
        }
    }

    const parsed = parseInquiry(body);
    // Honeypot: look successful so a bot learns nothing, store nothing.
    if (!parsed.ok && parsed.honeypot) return res.status(200).json({ ok: true });
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

    const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
        console.error('[inquiry] misconfigured: Supabase URL or service role key missing');
        return res.status(500).json({ ok: false, error: 'server_error' });
    }

    // Verified only now, after the cheap checks, so malformed requests cost no
    // round trip. The anon key is enough for /auth/v1/user; the service key
    // is the fallback so a missing anon var cannot lock every patient out.
    const apikey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? key;
    const user = await getAuthUser(token, url, apikey);
    if (!user) return res.status(401).json({ ok: false, error: 'auth_required' });

    // One account, not just one IP: signing up again from a new address does
    // not reset the count for the account that is already sending.
    if (rateLimited(`user:${user.id}`)) return res.status(429).json({ ok: false, error: 'too_many' });

    try {
        if (!(await insertRow({ ...parsed.row, user_id: user.id }, url, key))) {
            return res.status(500).json({ ok: false, error: 'server_error' });
        }
    } catch (e) {
        console.error('[inquiry] insert threw:', String(e).slice(0, 200));
        return res.status(500).json({ ok: false, error: 'server_error' });
    }

    try {
        await sendEmail(parsed.row, user);
    } catch (e) {
        console.error('[inquiry] email threw:', String(e).slice(0, 200));
    }

    return res.status(200).json({ ok: true });
}
