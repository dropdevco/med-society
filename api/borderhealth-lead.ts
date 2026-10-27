/**
 * POST /api/borderhealth-lead
 *
 * Puts the person who just finished a form into the MedSociety LayerOne (GHL)
 * sub-account as a contact, tagged by audience, with selected Border Health
 * Contact Custom Fields and a note pointing at the full answers in Supabase.
 *
 * The full answers stay in Supabase (bh_responses). GHL gets native contact
 * fields, tags, and the 43 outreach-relevant custom fields (universal + the
 * matching segment block). Research-only answers stay in Supabase only.
 *
 * This is a function rather than a fetch from the page because the page is
 * public and already carries the Supabase anon key. The PIT lives here, in
 * Vercel's environment, and never crosses to the client. The page calls this
 * best-effort after the Supabase insert succeeds: if this fails the survey
 * still counts.
 *
 * This endpoint moved here from borderhealth.dropdev.co — it now lives in the
 * medsociety Vercel project as api/borderhealth-lead.ts, served (via
 * vercel.json's rewrite of everything except /api/) at
 * POST /api/borderhealth-lead.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 * Set these in this (medsociety) Vercel project → Settings → Environment
 * Variables, production scope (also with `vercel env add`):
 *   GHL_PIT_MEDSOCIETY       private integration token for the MedSociety
 *                            sub-account. Secret. Also in 1Password
 *                            (HealthAtlas vault, GHL_PIT_MEDSOCIETY).
 *   GHL_LOCATION_MEDSOCIETY  the sub-account's location id. Defaults to the
 *                            MedSociety location below.
 *
 * GHL Contact Custom Field IDs are hardcoded below (from GET
 * /locations/{id}/customFields?model=contact). They are not secrets.
 *
 * GHL API versions are per-endpoint and not interchangeable:
 *   contacts/upsert, contacts/{id}/notes -> 2021-07-28
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

/** The Vercel Node runtime pre-parses JSON bodies onto `req.body`. */
type Req = IncomingMessage & { body?: unknown; socket?: { remoteAddress?: string } };
type Res = ServerResponse & {
    status: (code: number) => Res;
    json: (body: unknown) => void;
};

const GHL_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_LOCATION = 'HkBNfpRezC5hRkWJaeSx';
const SEGMENTS = new Set(['employer', 'employee', 'provider']);

/* One person fills one form, maybe two. A burst from one address is a script.
 * In-memory resets on cold start, which still stops the case that matters. */
const HITS = new Map<string, number[]>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 10;

function rateLimited(ip: string): boolean {
    const now = Date.now();
    const seen = (HITS.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    if (seen.length >= MAX_PER_WINDOW) return true;
    seen.push(now);
    HITS.set(ip, seen);
    if (HITS.size > 500) {
        for (const [k, v] of HITS) if (!v.some((t) => now - t < WINDOW_MS)) HITS.delete(k);
    }
    return false;
}

const str = (v: unknown, n: number): string => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** Verified MedSociety location Contact Custom Field ids (not secrets). */
const GHL = {
    universal: {
        segment: 'TFCiyaz63Z64EVhFdw9N',
        language: '9SBpVIPJG3sJBzV2AIl9',
        leadSource: 'YoDuec9qIPAHYuF8zi9U',
        whatsapp: 'jEi4QIYd2GV1rpTjdeac',
        followUpPreference: 'cPvyK7ZrLH8xKvlfflou',
        formVariant: 'baXFVU3BB7T7jv5QLt8y',
        submissionKey: 'JgMJzEhKQSUeqTEKcboj',
        lastSubmissionDate: 'xZBvro0vIGHGXOBdSNJO',
    },
    employer: {
        industry: '5NL0h52GbDd4xNrf4e9w',
        size: '0RkqV4HKrJAhWfv3VGCE',
        employeeLocation: '4krZegTg6ZGShB6aTURC',
        contactRole: 'dQEQdsu2GjK62qp2BhIp',
        healthCoverage: 'GiP1zHDqTpvB6gQPgFHd',
        insurerPlan: '9njRsudBvGvoMI6axyMk',
        crossBorderCare: 'p6GGHvP9TmVwmQhcipRD',
        challenges: 'GxGbhMt5n3TyopaOLEMW',
        primaryChallenge: 'SDKqsSdXWNBo9wbbmoAi',
        priority: 'PK8FiJvZZWzdAY9EUbSx',
    },
    employee: {
        industry: 'XqyPgCrI3nYxYOzlKdpq',
        workLocation: 'pqAH11DBOZVOyukgymkv',
        residence: '9PpEMJPAgYCLiRsjjEwf',
        healthCoverage: 'nRlEc1y1E1L7lGpKUWzn',
        challenges: 'T2MVMgougTpMudZr2rMT',
        primaryChallenge: 'BGCifzbWaFVSXE6uC9iF',
        crossBorderCareUsage: 'bl8JbFYfIyEshlyHhK45',
        improvementPriority: 'Npvqe0o3FZ2QcB0c4IHc',
    },
    provider: {
        practiceType: 'mwYMjg4kprTVOXskfdRC',
        specialty: '82F6b0evLmPVEMOOfrlR',
        location: 'XrtqODHTiJOMmZGqHf1I',
        practiceSize: 'Lc9ov7VHDvtwSivCCY7I',
        crossBorderPatientShare: 'vdzjfxJX5mwCrOSDnhyV',
        onlinePresence: '6hTf0PyWDMhOqpKA7se6',
        website: 'pbIBn4NNWZ0Rk5b3CCiR',
        bookingMethods: 'O1bHe4VZMkVtjFhTVl4U',
        englishAvailability: '6OXw6yidX3WczV41b0XR',
        virtualVisits: '5o1LPiViR5guCqvVHqUE',
        paymentMethods: 'zYEO8880t5EYa1EM79LA',
        acceptedInsurers: 'o0UyjpLPhzoFV9vtCi0L',
        onsiteServices: 'XpMCf6bQAEP3NrbSa7Te',
        primaryProcessChallenge: 'JSlT0keTpWKaWn62D4a6',
        challenges: '1tIPg8ZjTZFVhwqyHa0K',
        primaryChallenge: 'GOJ6I7dnWbOPyyh3M1v2',
        referralInterest: 'RDi7pQSqKzMOMI09Bbrb',
    },
} as const;

interface GhlCustomField {
    id: string;
    field_value: string | string[];
}

interface GhlResult {
    ok: boolean;
    status: number;
    json: Record<string, unknown> | null;
    text: string;
}

interface GhlContactPayload {
    locationId: string;
    firstName?: string;
    lastName?: string;
    name?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    source: string;
    tags: string[];
    customFields?: GhlCustomField[];
}

function ansStr(answers: Record<string, unknown>, key: string, n: number): string {
    return str(answers[key], n);
}

function ansKey(answers: Record<string, unknown>, key: string): string {
    return str(answers[key], 80);
}

function ansMulti(answers: Record<string, unknown>, key: string): string[] | null {
    const v = answers[key];
    if (!Array.isArray(v) || v.length === 0) return null;
    const keys = v.map((x) => String(x).trim()).filter(Boolean);
    return keys.length ? keys : null;
}

function pushField(out: GhlCustomField[], id: string, value: unknown): void {
    if (value == null) return;
    if (Array.isArray(value)) {
        if (value.length === 0) return;
        out.push({ id, field_value: value.map((x) => String(x)) });
        return;
    }
    const s = String(value).trim();
    if (!s) return;
    out.push({ id, field_value: s });
}

function buildCustomFields(opts: {
    segment: string;
    lang: string;
    ref: string;
    whatsapp: string;
    followKey: string;
    variant: string;
    submissionKey: string;
    answers: Record<string, unknown>;
}): GhlCustomField[] {
    const { segment, lang, ref, whatsapp, followKey, variant, submissionKey, answers } = opts;
    const out: GhlCustomField[] = [];
    const U = GHL.universal;

    pushField(out, U.segment, segment);
    pushField(out, U.language, lang);
    pushField(out, U.leadSource, ref);
    pushField(out, U.whatsapp, whatsapp || ansStr(answers, 'contact_whatsapp', 40));
    pushField(out, U.followUpPreference, followKey || ansKey(answers, 'follow_up_key'));
    pushField(out, U.formVariant, variant || ansKey(answers, 'variant') || 'medsociety');
    pushField(out, U.submissionKey, submissionKey);
    pushField(out, U.lastSubmissionDate, new Date().toISOString().slice(0, 10));

    if (segment === 'employer') {
        const E = GHL.employer;
        pushField(out, E.industry, ansKey(answers, 'industry_key'));
        pushField(out, E.size, ansKey(answers, 'size_key'));
        pushField(out, E.employeeLocation, ansKey(answers, 'where_key'));
        pushField(out, E.contactRole, ansKey(answers, 'role_key'));
        pushField(out, E.healthCoverage, ansMulti(answers, 'coverage_key'));
        pushField(out, E.insurerPlan, ansStr(answers, 'insurers', 600));
        pushField(out, E.crossBorderCare, ansKey(answers, 'crossing_key'));
        pushField(out, E.challenges, ansMulti(answers, 'difficulties_key'));
        pushField(out, E.primaryChallenge, ansKey(answers, 'difficulties_top_key'));
        pushField(out, E.priority, ansStr(answers, 'change', 600));
    } else if (segment === 'employee') {
        const E = GHL.employee;
        pushField(out, E.industry, ansKey(answers, 'industry_key'));
        pushField(out, E.workLocation, ansKey(answers, 'work_where_key'));
        pushField(out, E.residence, ansKey(answers, 'live_where_key'));
        pushField(out, E.healthCoverage, ansMulti(answers, 'coverage_key'));
        pushField(out, E.challenges, ansMulti(answers, 'last_hardest_key'));
        pushField(out, E.primaryChallenge, ansKey(answers, 'last_hardest_top_key'));
        pushField(out, E.crossBorderCareUsage, ansKey(answers, 'crossed_key'));
        pushField(out, E.improvementPriority, ansStr(answers, 'change', 600));
    } else if (segment === 'provider') {
        const P = GHL.provider;
        pushField(out, P.practiceType, ansKey(answers, 'practice_type_key'));
        pushField(out, P.specialty, ansStr(answers, 'specialty', 200));
        pushField(out, P.location, ansKey(answers, 'city_key'));
        pushField(out, P.practiceSize, ansKey(answers, 'size_key'));
        pushField(out, P.crossBorderPatientShare, ansKey(answers, 'us_patients_key'));
        pushField(out, P.onlinePresence, ansMulti(answers, 'presence_key'));
        pushField(out, P.website, ansStr(answers, 'website', 300));
        pushField(out, P.bookingMethods, ansMulti(answers, 'booking_key'));
        pushField(out, P.englishAvailability, ansKey(answers, 'english_key'));
        pushField(out, P.virtualVisits, ansKey(answers, 'virtual_key'));
        pushField(out, P.paymentMethods, ansMulti(answers, 'payments_key'));
        pushField(out, P.acceptedInsurers, ansStr(answers, 'insurers', 600));
        pushField(out, P.onsiteServices, ansMulti(answers, 'imaging_key'));
        pushField(out, P.primaryProcessChallenge, ansKey(answers, 'process_hardest_key'));
        pushField(out, P.challenges, ansMulti(answers, 'bottlenecks_key'));
        pushField(out, P.primaryChallenge, ansKey(answers, 'bottlenecks_top_key'));
        pushField(out, P.referralInterest, ansKey(answers, 'referrals_key'));
    }

    return out;
}

async function ghl(path: string, pit: string, payload: GhlContactPayload | { body: string }): Promise<GhlResult> {
    const r = await fetch(`${GHL_BASE}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${pit}`,
            Version: '2021-07-28',
            'content-type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const text = await r.text().catch(() => '');
    let json: Record<string, unknown> | null = null;
    try {
        json = JSON.parse(text) as Record<string, unknown>;
    } catch {
        json = null;
    }
    return { ok: r.ok, status: r.status, json, text };
}

async function readBody(req: Req): Promise<Record<string, unknown>> {
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = {};
        }
    }
    if (body === undefined) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        } catch {
            body = {};
        }
    }
    return (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
}

export default async function handler(req: Req, res: Res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    }

    const forwardedFor = req.headers['x-forwarded-for'];
    const forwardedForValue = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    const ip = (forwardedForValue || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
    if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'too_many' });

    const b = await readBody(req);

    const segment = str(b.segment, 20);
    const email = str(b.email, 160).toLowerCase();
    const phone = str(b.phone, 40);
    const name = str(b.name, 120);
    const org = str(b.org, 160);
    const industry = str(b.industry, 80);
    const city = str(b.city, 80);
    const lang = str(b.lang, 2) === 'en' ? 'en' : 'es';
    const ref = str(b.ref, 40) || 'link';
    const session = str(b.session, 40) || 'live';
    const followUp = b.follow_up === true;
    const followKey = str(b.follow_up_key, 20);
    const whatsapp = str(b.whatsapp, 40);
    const variant = str(b.variant, 20) === 'research' ? 'research' : 'medsociety';
    const submissionKey = str(b.submission_key, 40);
    const answers =
        b.answers && typeof b.answers === 'object' && !Array.isArray(b.answers)
            ? (b.answers as Record<string, unknown>)
            : {};

    if (!SEGMENTS.has(segment)) return res.status(400).json({ ok: false, error: 'bad_segment' });
    if (!email && !phone) return res.status(400).json({ ok: false, error: 'no_reach' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'bad_email' });

    const pit = process.env.GHL_PIT_MEDSOCIETY || '';
    const locationId = process.env.GHL_LOCATION_MEDSOCIETY || DEFAULT_LOCATION;
    if (!pit) {
        console.error('borderhealth-lead: GHL_PIT_MEDSOCIETY missing, nothing pushed');
        return res.status(500).json({ ok: false, error: 'not_configured' });
    }

    /* Test sessions get their own tag so they are one click to find and delete
     * in the CRM, and never mix with the real study tags. */
    const tags =
        session === 'test'
            ? ['borderhealth-test']
            : ['borderhealth', `borderhealth-${segment}`, followUp ? 'borderhealth-followup' : 'borderhealth-no-followup'].concat(
                  followKey === 'info_first' ? ['borderhealth-info-first'] : []
              ).concat([`borderhealth-v-${variant}`]);

    const customFields = buildCustomFields({
        segment,
        lang,
        ref,
        whatsapp,
        followKey,
        variant,
        submissionKey,
        answers,
    });

    const parts = name.split(' ');
    const contact: GhlContactPayload = {
        locationId,
        firstName: parts[0] || undefined,
        lastName: parts.length > 1 ? parts.slice(1).join(' ') : undefined,
        name: name || undefined,
        email: email || undefined,
        phone: phone || undefined,
        companyName: org || undefined,
        source: variant === 'research' ? 'borderhealth research (MLCIC)' : 'medsociety.one/borderhealth',
        tags,
        ...(customFields.length ? { customFields } : {}),
    };

    try {
        const up = await ghl('/contacts/upsert', pit, contact);
        if (!up.ok) {
            console.error('borderhealth-lead: upsert non-2xx', up.status, up.text.slice(0, 300));
            return res.status(502).json({ ok: false, error: 'upsert_failed' });
        }
        const upContact = up.json?.contact as { id?: string } | undefined;
        const id = upContact?.id || null;

        /* The note is what a human reads in the CRM. Answers live in Supabase. */
        if (id) {
            const lines = [
                `Border health study, ${segment} form (${lang}), via ${ref}${session === 'test' ? ', TEST' : ''}.`,
                industry ? `Industry or practice: ${industry}.` : null,
                city ? `Location: ${city}.` : null,
                `Follow-up: ${followKey === 'info_first' ? 'yes, but send information first' : followUp ? 'yes, 15 minute conversation' : 'no'}.`,
                whatsapp && whatsapp !== phone ? `WhatsApp: ${whatsapp}.` : null,
                'Full answers: Supabase bh_responses, match on email or phone.',
            ].filter((l): l is string => Boolean(l));
            const note = await ghl(`/contacts/${id}/notes`, pit, { body: lines.join('\n') });
            if (!note.ok) console.error('borderhealth-lead: note non-2xx', note.status, note.text.slice(0, 200));
        }

        return res.status(200).json({ ok: true, id });
    } catch (e) {
        console.error('borderhealth-lead: threw', String(e).slice(0, 200));
        return res.status(502).json({ ok: false, error: 'push_failed' });
    }
}
