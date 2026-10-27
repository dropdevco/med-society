/**
 * Forum email notifications, all three kinds, plus their unsubscribe link.
 *
 *   POST /api/forum-notify  {"kind":"thread"|"reply","id":"<uuid>"}
 *        Called by the browser right after it posts (src/lib/forum.ts), and by
 *        scripts/society-prompt.ts after a team prompt.
 *          thread → a team prompt in Med Society: email every clinician now.
 *          reply  → a clinician answered a patient: email that patient now.
 *        Anything else is acknowledged and ignored.
 *
 *   GET  /api/forum-notify?job=digest      (Vercel Cron, daily — vercel.json)
 *        Sweeps up anything a closed tab never reported, then sends each
 *        clinician one digest of new unanswered patient questions in their
 *        specialties. Needs `Authorization: Bearer $CRON_SECRET`.
 *
 *   GET|POST /api/forum-notify?job=unsubscribe&t=<token>&k=<kind>
 *        GET shows a confirm button (link scanners follow GETs, so a GET must
 *        never unsubscribe anyone); POST does it. Mail clients' one-click
 *        unsubscribe (RFC 8058) POSTs here directly.
 *
 * Why POST needs no secret: the request names a row, not an email. This
 * function re-reads the row with the service role, decides whether it
 * warrants an email, and stamps `notified_at` before sending, so a caller can
 * only ever trigger the single email that row was going to get anyway. See
 * supabase/migrations/0017_forum_notifications.sql.
 *
 * Self-contained on purpose, like every other file in api/: no sibling imports
 * to trip the ESM resolution of Vercel's Node runtime.
 *
 * ── Env (server-only, Vercel → Settings → Environment Variables) ─────────────
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   already used by api/inquiry.ts
 *   RESEND_API_KEY                                 already used by api/lead-notify.ts
 *   FORUM_NOTIFY_FROM   e.g. "MedSociety <hello@medsociety.one>". Falls back to
 *                       LEAD_NOTIFY_FROM. Must be on a domain verified in Resend.
 *   CRON_SECRET         random string (openssl rand -hex 32). Vercel Cron sends
 *                       it as a bearer token; the digest refuses to run without.
 *   PUBLIC_SITE_URL     optional, defaults to https://medsociety.one
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse & {
    status: (code: number) => Res;
    json: (body: unknown) => void;
};

interface ThreadRow {
    id: string;
    forum: 'patients' | 'society';
    author_id: string | null;
    title: string;
    body: string;
    specialty: string | null;
    is_prompt: boolean;
    hidden: boolean;
    lang: Lang | null;
    notified_at: string | null;
    created_at: string;
}

interface ReplyRow {
    id: string;
    thread_id: string;
    author_id: string | null;
    author_name: string;
    provider_id: string | null;
    body: string;
    hidden: boolean;
    notified_at: string | null;
}

interface Clinician {
    user_id: string;
    email: string;
    lang: Lang;
    token: string;
    specialties: string[];
}

/** Forum paths in email links. Keep in sync with src/lib/forumRoutes.ts. */
const ASK_PATH = process.env.FORUM_ASK_PATH || '/q-vj2ggfdrw';
const SOCIETY_PATH = process.env.FORUM_SOCIETY_PATH || '/s-p4bm06qny';

const THREAD_COLS = 'id,forum,author_id,title,body,specialty,is_prompt,hidden,lang,notified_at,created_at';
const REPLY_COLS = 'id,thread_id,author_id,author_name,provider_id,body,hidden,notified_at';

// ── Entry ───────────────────────────────────────────────────────────────────

export default async function handler(req: Req, res: Res) {
    const url = new URL(req.url ?? '/', 'http://local');
    const job = url.searchParams.get('job');

    try {
        if (job === 'unsubscribe') return await unsubscribe(req, res, url);
        if (job === 'digest') return await digest(req, res);

        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ error: 'Method not allowed' });
        }

        const body = await readBody(req);
        const kind = body.kind;
        const id = typeof body.id === 'string' ? body.id : '';
        if ((kind !== 'thread' && kind !== 'reply') || !UUID.test(id)) {
            return res.status(400).json({ error: 'Expected {kind: "thread"|"reply", id: uuid}' });
        }

        const sent = kind === 'thread' ? await notifyThread(id) : await notifyReply(id);
        return res.status(200).json({ ok: true, sent });
    } catch (err) {
        console.error('[forum-notify]', err);
        return res.status(500).json({ error: 'Notification failed' });
    }
}

// ── 1. Team prompt in Med Society → every clinician ─────────────────────────

async function notifyThread(id: string, row?: ThreadRow): Promise<number> {
    const thread = row ?? (await db<ThreadRow[]>(`forum_threads?id=eq.${id}&select=${THREAD_COLS}`))[0];
    // Only team prompts email anyone at once. A patient's question waits for
    // the daily digest: one email a day, not one per question.
    if (!thread || thread.hidden || !thread.is_prompt || thread.forum !== 'society' || thread.notified_at) return 0;
    if (!(await claim('forum_threads', id))) return 0;

    try {
        const recipients = await rpc<Clinician[]>('forum_clinician_recipients', { p_kind: 'prompts' });
        const link = `${SITE}${SOCIETY_PATH}/${thread.id}`;
        const mails = recipients.map((r): Mail => {
            const unsub = unsubscribeUrl(r.token, 'prompts');
            const es = r.lang === 'es';
            const heading = thread.title;
            const intro = es
                ? 'El equipo de MedSociety tiene una pregunta para los profesionales de la salud de El Paso – Ciudad Juárez y San Diego – Tijuana:'
                : 'The MedSociety team has a question for clinicians in El Paso – Ciudad Juárez and San Diego – Tijuana:';
            const nudge = es
                ? 'Tu respuesta queda en Med Society con tu clínica, para que tus colegas te conozcan.'
                : 'Your answer goes up in Med Society under your clinic, so colleagues get to know you.';
            const cta = es ? 'Responder en Med Society' : 'Answer in Med Society';
            return {
                to: r.email,
                subject: es ? `Pregunta para ti en Med Society: ${thread.title}` : `A question for you in Med Society: ${thread.title}`,
                html: layout({
                    lang: r.lang, kind: 'prompts', heading, unsubscribeUrl: unsub,
                    blocksHtml: para(intro, true) + (thread.body ? quote(excerpt(thread.body, 600)) : '') + para(nudge, true),
                    cta: { label: cta, href: link },
                }),
                text: `${intro}\n\n${thread.title}\n${thread.body ? `\n${excerpt(thread.body, 600)}\n` : ''}\n${nudge}\n\n${cta}: ${link}` + textFooter(r.lang, 'prompts', unsub),
                unsubscribeUrl: unsub,
            };
        });
        return await sendMail(mails);
    } catch (err) {
        // Un-stamp so the next sweep retries rather than the prompt going out
        // to nobody.
        await unclaim('forum_threads', id);
        throw err;
    }
}

// ── 3. A clinician answered a patient → that patient ────────────────────────

async function notifyReply(id: string, row?: ReplyRow): Promise<number> {
    const reply = row ?? (await db<ReplyRow[]>(`forum_replies?id=eq.${id}&select=${REPLY_COLS}`))[0];
    if (!reply || reply.hidden || reply.notified_at || !reply.provider_id) return 0;

    const thread = (await db<ThreadRow[]>(`forum_threads?id=eq.${reply.thread_id}&select=${THREAD_COLS}`))[0];
    if (!thread || thread.hidden || thread.forum !== 'patients' || !thread.author_id) return 0;
    // A clinician answering their own question is not news to them.
    if (thread.author_id === reply.author_id) return 0;
    if (!(await claim('forum_replies', id))) return 0;

    try {
        const contact = (await rpc<{ email: string; token: string }[]>('forum_user_contact', { p_user: thread.author_id }))[0];
        if (!contact) return 0; // opted out, or no confirmed email

        const lang: Lang = thread.lang === 'es' ? 'es' : 'en';
        const es = lang === 'es';
        const unsub = unsubscribeUrl(contact.token, 'answers');
        const link = `${SITE}${ASK_PATH}/${thread.id}`;
        const doctor = reply.author_name;
        const heading = es ? `${doctor} respondió tu pregunta` : `${doctor} answered your question`;
        const asked = es ? `Preguntaste: “${thread.title}”` : `You asked: “${thread.title}”`;
        const cta = es ? 'Ver la respuesta completa' : 'Read the full answer';
        const note = es
            ? 'Desde la respuesta puedes ver el perfil del doctor y contactarlo.'
            : 'From the answer you can open the doctor’s profile and contact them.';

        return await sendMail([{
            to: contact.email,
            subject: heading,
            html: layout({
                lang, kind: 'answers', heading, unsubscribeUrl: unsub,
                blocksHtml: para(asked, true) + quote(excerpt(reply.body)) + para(note, true),
                cta: { label: cta, href: link },
            }),
            text: `${asked}\n\n${doctor}:\n${excerpt(reply.body)}\n\n${note}\n${cta}: ${link}` + textFooter(lang, 'answers', unsub),
            unsubscribeUrl: unsub,
        }]);
    } catch (err) {
        await unclaim('forum_replies', id);
        throw err;
    }
}

// ── 2. Daily digest of unanswered patient questions → clinicians ───────────

async function digest(req: Req, res: Res) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization ?? '';
    if (!secret || !secretMatches(auth.replace(/^Bearer\s+/i, ''), secret)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const now = Date.now();
    const iso = (ms: number) => new Date(ms).toISOString();

    // Sweep first: prompts and answers whose tab closed before it called us.
    // Older than two minutes so we never race the browser's own call; younger
    // than three days so a long outage does not email last month's news.
    const since3d = iso(now - 3 * 864e5);
    const before2m = iso(now - 2 * 60e3);
    const [lostThreads, lostReplies] = await Promise.all([
        db<ThreadRow[]>(`forum_threads?select=${THREAD_COLS}&is_prompt=is.true&forum=eq.society&hidden=is.false&notified_at=is.null&created_at=gte.${since3d}&created_at=lte.${before2m}`),
        db<ReplyRow[]>(`forum_replies?select=${REPLY_COLS}&provider_id=not.is.null&hidden=is.false&notified_at=is.null&created_at=gte.${since3d}&created_at=lte.${before2m}`),
    ]);
    let swept = 0;
    for (const t of lostThreads) swept += await notifyThread(t.id, t).catch(() => 0);
    for (const r of lostReplies) swept += await notifyReply(r.id, r).catch(() => 0);

    // The digest. Each clinician gets questions posted since their last
    // digest (or the last day), still without a clinician's answer, in their
    // specialties or untagged.
    const today = new Date().toISOString().slice(0, 10);
    const [clinicians, log] = await Promise.all([
        rpc<Clinician[]>('forum_clinician_recipients', { p_kind: 'digest' }),
        db<{ user_id: string; sent_at: string }[]>(`forum_digest_log?select=user_id,sent_at&sent_at=gte.${iso(now - 8 * 864e5)}&order=sent_at.desc`),
    ]);
    if (clinicians.length === 0) return res.status(200).json({ ok: true, swept, digests: 0 });

    const lastSent = new Map<string, number>();
    for (const row of log) if (!lastSent.has(row.user_id)) lastSent.set(row.user_id, Date.parse(row.sent_at));

    // One query for the widest window anyone needs, filtered per person below.
    const windowStart = Math.min(...clinicians.map((c) => lastSent.get(c.user_id) ?? now - 864e5));
    const questions = await db<ThreadRow[]>(
        `forum_threads?select=${THREAD_COLS}&forum=eq.patients&hidden=is.false&doctor_reply_count=eq.0&created_at=gte.${iso(windowStart)}&order=created_at.desc&limit=200`,
    );

    const mails: Mail[] = [];
    for (const c of clinicians) {
        const from = lastSent.get(c.user_id) ?? now - 864e5;
        const mine = questions.filter((q) =>
            Date.parse(q.created_at) >= from && (!q.specialty || c.specialties.includes(q.specialty)));
        if (mine.length === 0) continue;

        // Claim today's slot before building the email; a second cron run on
        // the same day finds it taken and sends nothing.
        const claimed = await db<unknown[]>('forum_digest_log?on_conflict=user_id,sent_on', {
            method: 'POST',
            prefer: 'resolution=ignore-duplicates,return=representation',
            body: JSON.stringify({ user_id: c.user_id, sent_on: today }),
        });
        if (!claimed?.length) continue;

        mails.push(digestMail(c, mine));
    }

    const sent = mails.length ? await sendMail(mails) : 0;
    return res.status(200).json({ ok: true, swept, digests: sent });
}

function digestMail(c: Clinician, questions: ThreadRow[]): Mail {
    const es = c.lang === 'es';
    const n = questions.length;
    const shown = questions.slice(0, 5);
    const unsub = unsubscribeUrl(c.token, 'digest');
    const link = `${SITE}${ASK_PATH}?sort=unanswered`;
    const heading = es
        ? (n === 1 ? 'Un paciente espera tu respuesta' : `${n} pacientes esperan respuesta`)
        : (n === 1 ? 'A patient is waiting for an answer' : `${n} patients are waiting for an answer`);
    const intro = es
        ? 'Preguntas nuevas en Pregunta al Doctor que ningún doctor ha respondido todavía:'
        : 'New questions in Ask a Doctor that no doctor has answered yet:';
    const nudge = es
        ? 'Cada respuesta muestra tu clínica y enlaza a tu perfil. Es marketing gratuito que los pacientes sí leen.'
        : 'Every answer shows your clinic and links to your profile. Free marketing that patients actually read.';
    const cta = es ? 'Responder preguntas' : 'Answer questions';
    const more = n > shown.length
        ? (es ? `y ${n - shown.length} más.` : `and ${n - shown.length} more.`)
        : '';

    const items = shown.map((q) => {
        const tag = q.specialty && SPECIALTY[q.specialty] ? SPECIALTY[q.specialty][c.lang] : '';
        return `<li style="margin:0 0 12px"><a href="${esc(`${SITE}${ASK_PATH}/${q.id}`)}" style="color:#14161a;font-weight:700;text-decoration:none">${esc(q.title)}</a>` +
            (tag ? `<br><span style="font-size:13px;color:#0f6b52">${esc(tag)}</span>` : '') + '</li>';
    }).join('');

    return {
        to: c.email,
        subject: heading,
        html: layout({
            lang: c.lang, kind: 'digest', heading, unsubscribeUrl: unsub,
            blocksHtml: para(intro, true) +
                `<ul style="margin:0 0 12px;padding-left:18px">${items}</ul>` +
                (more ? para(more, true) : '') + para(nudge, true),
            cta: { label: cta, href: link },
        }),
        text: `${intro}\n\n` +
            shown.map((q) => `• ${q.title}\n  ${SITE}${ASK_PATH}/${q.id}`).join('\n') +
            (more ? `\n${more}` : '') + `\n\n${nudge}\n${cta}: ${link}` + textFooter(c.lang, 'digest', unsub),
        unsubscribeUrl: unsub,
    };
}

// ── Unsubscribe ─────────────────────────────────────────────────────────────

async function unsubscribe(req: Req, res: Res, url: URL) {
    const token = url.searchParams.get('t') ?? '';
    const k = url.searchParams.get('k') ?? 'all';
    const kind = (['prompts', 'digest', 'answers', 'reports', 'all'] as const).find((x) => x === k) ?? 'all';
    const valid = UUID.test(token);

    if (req.method === 'POST') {
        const ok = valid && (await rpc<boolean>('forum_unsubscribe', { p_token: token, p_kind: kind }));
        return page(res, ok ? 200 : 400, ok
            ? { en: 'You’re unsubscribed', es: 'Suscripción cancelada', bodyEn: 'You won’t get these emails anymore.', bodyEs: 'Ya no recibirás estos correos.' }
            : { en: 'That link doesn’t work', es: 'Ese enlace no funciona', bodyEn: 'It may have expired. Reply to any MedSociety email and we’ll take care of it.', bodyEs: 'Puede haber caducado. Responde a cualquier correo de MedSociety y lo resolvemos.' });
    }

    if (!valid) {
        return page(res, 400, { en: 'That link doesn’t work', es: 'Ese enlace no funciona', bodyEn: '', bodyEs: '' });
    }
    const action = `/api/forum-notify?job=unsubscribe&t=${encodeURIComponent(token)}&k=${kind}`;
    return page(res, 200, {
        en: 'Unsubscribe?', es: '¿Cancelar suscripción?',
        bodyEn: 'Stop getting this kind of email from MedSociety.',
        bodyEs: 'Deja de recibir este tipo de correo de MedSociety.',
    }, `<form method="post" action="${esc(action)}" style="margin-top:20px"><button type="submit" style="background:#1b1d22;color:#fff;border:0;border-radius:100px;padding:12px 22px;font:700 15px -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;cursor:pointer">Unsubscribe · Cancelar</button></form>`);
}

function page(res: Res, status: number, copy: { en: string; es: string; bodyEn: string; bodyEs: string }, extra = '') {
    res.statusCode = status;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>MedSociety</title></head>
<body style="margin:0;background:#f6f6f5;font:16px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14161a">
<main style="max-width:440px;margin:12vh auto;padding:32px 28px;background:#fff;border:1px solid #d6d6d3;border-radius:14px;text-align:center">
<p style="margin:0 0 18px;font:600 16px Georgia,serif">Med<span style="color:#0f6b52">Society</span></p>
<h1 style="margin:0 0 6px;font-size:22px">${esc(copy.en)}</h1><p style="margin:0;color:#5c6068">${esc(copy.bodyEn)}</p>
<h2 style="margin:18px 0 6px;font-size:18px">${esc(copy.es)}</h2><p style="margin:0;color:#5c6068">${esc(copy.bodyEs)}</p>
${extra}
<p style="margin:24px 0 0;font-size:14px"><a href="${esc(SITE)}" style="color:#0f6b52">medsociety.one</a></p>
</main></body></html>`);
}

// ── Plumbing ────────────────────────────────────────────────────────────────

/** Stamp `notified_at` only if it is still null. True when this call won. */
async function claim(table: 'forum_threads' | 'forum_replies', id: string): Promise<boolean> {
    const rows = await db<unknown[]>(`${table}?id=eq.${id}&notified_at=is.null`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: JSON.stringify({ notified_at: new Date().toISOString() }),
    });
    return (rows?.length ?? 0) > 0;
}

async function unclaim(table: 'forum_threads' | 'forum_replies', id: string) {
    await db(`${table}?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notified_at: null }) }).catch(() => {});
}

function secretMatches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: Req): Promise<Record<string, unknown>> {
    if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
        return {};
    }
}

const SITE = (process.env.PUBLIC_SITE_URL || 'https://medsociety.one').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Lang = 'en' | 'es';
type Kind = 'prompts' | 'digest' | 'answers';

// ── Supabase REST ───────────────────────────────────────────────────────────

function supabaseEnv() {
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) throw new Error('Supabase service credentials are not configured');
    return { url, key };
}

/** A REST call as the service role. Throws on a non-2xx with the body text. */
async function db<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const { url, key } = supabaseEnv();
    const res = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`supabase ${res.status} ${path.split('?')[0]}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
}

function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return db<T>(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

// ── Email ───────────────────────────────────────────────────────────────────

interface Mail {
    to: string;
    subject: string;
    html: string;
    text: string;
    /** One-click unsubscribe target (RFC 8058); also the footer link. */
    unsubscribeUrl: string;
}

function unsubscribeUrl(token: string, kind: Kind): string {
    return `${SITE}/api/forum-notify?job=unsubscribe&t=${encodeURIComponent(token)}&k=${kind}`;
}

/**
 * Sends through Resend's batch endpoint, 100 at a time. Returns how many were
 * accepted. Resend rejects a whole batch on one bad address, so a failed
 * batch is retried one by one rather than losing the other 99.
 */
async function sendMail(mails: Mail[]): Promise<number> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.FORUM_NOTIFY_FROM || process.env.LEAD_NOTIFY_FROM;
    if (!apiKey || !from) throw new Error('Email is not configured (RESEND_API_KEY, FORUM_NOTIFY_FROM)');

    const toPayload = (m: Mail) => ({
        from,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
        headers: {
            'List-Unsubscribe': `<${m.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
    });
    const post = (path: string, body: unknown) => fetch(`https://api.resend.com/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    let sent = 0;
    for (let i = 0; i < mails.length; i += 100) {
        const chunk = mails.slice(i, i + 100);
        const res = await post('emails/batch', chunk.map(toPayload));
        if (res.ok) { sent += chunk.length; continue; }
        console.error('[forum-mail] batch failed:', res.status, (await res.text()).slice(0, 300));
        for (const m of chunk) {
            const one = await post('emails', toPayload(m));
            if (one.ok) sent += 1;
            else console.error('[forum-mail] send failed:', one.status, (await one.text()).slice(0, 200));
        }
    }
    return sent;
}

// ── Templates ───────────────────────────────────────────────────────────────

function esc(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** First `max` characters, cut on a word, for a quoted preview. */
function excerpt(text: string, max = 280): string {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return t.slice(0, t.lastIndexOf(' ', max) > max * 0.6 ? t.lastIndexOf(' ', max) : max).trimEnd() + '…';
}

const FOOTER: Record<Lang, Record<Kind, string>> = {
    en: {
        prompts: 'You get this because you’re a verified clinician on MedSociety.',
        digest: 'You get this daily summary because you’re a verified clinician on MedSociety.',
        answers: 'You get this because you asked a question on MedSociety.',
    },
    es: {
        prompts: 'Recibes esto porque eres un profesional verificado en MedSociety.',
        digest: 'Recibes este resumen diario porque eres un profesional verificado en MedSociety.',
        answers: 'Recibes esto porque hiciste una pregunta en MedSociety.',
    },
};
const UNSUB: Record<Lang, string> = { en: 'Unsubscribe', es: 'Cancelar suscripción' };

/**
 * The one email layout: wordmark, heading, body blocks, one button, footer.
 * Inline styles and a table-free single column, because that is what renders
 * the same in Gmail, Outlook and a phone. Ink and the one green, matching the
 * site's tokens.
 */
function layout(opts: {
    lang: Lang;
    kind: Kind;
    heading: string;
    blocksHtml: string;
    cta: { label: string; href: string };
    unsubscribeUrl: string;
}): string {
    const { lang, kind, heading, blocksHtml, cta } = opts;
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f6f5;padding:24px 12px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d6d6d3;border-radius:14px;padding:28px 26px;font:15px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14161a">
<p style="margin:0 0 20px;font:600 15px Georgia,serif;letter-spacing:.01em">Med<span style="color:#0f6b52">Society</span></p>
<h1 style="margin:0 0 16px;font:700 21px/1.3 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${esc(heading)}</h1>
${blocksHtml}
<p style="margin:24px 0 4px"><a href="${esc(cta.href)}" style="display:inline-block;background:#1b1d22;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px">${esc(cta.label)} &rarr;</a></p>
</div>
<p style="max-width:560px;margin:14px auto 0;font:12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6d7178;text-align:center">${esc(FOOTER[lang][kind])}<br><a href="${esc(opts.unsubscribeUrl)}" style="color:#6d7178">${UNSUB[lang]}</a></p>
</body></html>`;
}

function quote(text: string): string {
    return `<p style="margin:0 0 12px;padding:12px 14px;background:#f6f6f5;border-left:3px solid #0f6b52;border-radius:6px;color:#2a2d33;white-space:pre-wrap">${esc(text)}</p>`;
}

function para(text: string, muted = false): string {
    return `<p style="margin:0 0 12px;${muted ? 'color:#5c6068;font-size:14px' : ''}">${esc(text)}</p>`;
}

function textFooter(lang: Lang, kind: Kind, unsub: string): string {
    return `\n\n—\n${FOOTER[lang][kind]}\n${UNSUB[lang]}: ${unsub}`;
}

/** Specialty labels for subject lines, both languages. Keys match src/types/provider.ts. */
const SPECIALTY: Record<string, Record<Lang, string>> = {
    dentist: { en: 'Dentistry', es: 'Odontología' },
    orthodontist: { en: 'Orthodontics', es: 'Ortodoncia' },
    plastic_surgery: { en: 'Plastic surgery', es: 'Cirugía plástica' },
    aesthetician: { en: 'Aesthetics', es: 'Estética' },
    obgyn: { en: 'OB/GYN', es: 'Ginecología' },
    physical_therapy: { en: 'Physical therapy', es: 'Fisioterapia' },
    massage: { en: 'Massage therapy', es: 'Masoterapia' },
    optometry: { en: 'Optometry', es: 'Optometría' },
    general: { en: 'Primary care', es: 'Medicina general' },
    pediatrics: { en: 'Pediatrics', es: 'Pediatría' },
    cardiology: { en: 'Cardiology', es: 'Cardiología' },
    urgent_care: { en: 'Urgent care', es: 'Urgencias' },
    mental_health: { en: 'Mental health', es: 'Salud mental' },
    pharmacy: { en: 'Pharmacy', es: 'Farmacia' },
    telehealth: { en: 'Telehealth', es: 'Telemedicina' },
    neurology: { en: 'Neurology', es: 'Neurología' },
    otolaryngology: { en: 'ENT', es: 'Otorrinolaringología' },
    orthopedics: { en: 'Orthopedics', es: 'Ortopedia y Traumatología' },
    gastroenterology: { en: 'Gastroenterology', es: 'Gastroenterología' },
};
