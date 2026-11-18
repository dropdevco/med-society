/**
 * Claim e-mails, sent through GHL.
 *
 * The database queues one row in public.claim_emails per e-mail-worthy claim
 * status change (migration 0048), in the same transaction as the change. This
 * function takes queued rows and sends them:
 *
 *   claimant_received    "we received your claim, here is what happens next"
 *   claimant_needs_info  the reviewer's question, and where to answer it
 *   claimant_approved    "the listing is yours", with the dashboard link
 *   claimant_rejected    the reviewer's reason, and when they may try again
 *   team_new_claim       to CLAIM_NOTIFY_TO: a claim is waiting in /admin
 *
 * Every claimant e-mail is in both languages, Spanish first for a Mexican
 * listing. No e-mail ever carries the claimant's documents or ID numbers.
 *
 * Who calls it:
 *   POST  the browser, right after a claim is submitted or decided, with the
 *         user's Supabase access token. It only sends what the database already
 *         queued, so a caller cannot make it mail anything else.
 *   GET   ?job=drain, the daily Vercel cron (Authorization: Bearer CRON_SECRET),
 *         for anything the POST missed.
 *   GET   ?job=review, the daily Vercel cron: one e-mail to REVIEW_ALERT_TO
 *         listing the records the AI match scorer judged in the last day near
 *         the 80 auto-link bar (REVIEW_ALERT_BAND, default 70-89, either side)
 *         and every cédula conflict it saw. Nothing to report, nothing sent.
 *         Reads review_near_bar (migration 0052); docs/adr/0014.
 *
 * ── Setup (Vercel → Settings → Environment Variables, server-side) ──────────
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   required
 *   GHL_PIT_MEDSOCIETY       required. The token needs the scopes
 *                            contacts.write and conversations/message.write
 *   GHL_LOCATION_MEDSOCIETY  defaults to the MedSociety location
 *   CLAIM_NOTIFY_TO          team inboxes, comma-separated (falls back to
 *                            LEAD_NOTIFY_TO). Each becomes a GHL contact.
 *   CLAIM_EMAIL_FROM         optional sender address; GHL's default otherwise
 *   REVIEW_ALERT_TO          who gets the scorer alert, comma-separated (falls
 *                            back to CLAIM_NOTIFY_TO, then LEAD_NOTIFY_TO)
 *   REVIEW_ALERT_BAND        "low-high" scores to report, default 70-89
 *   PUBLIC_SITE_URL          defaults to https://medsociety.one
 *   CRON_SECRET              for the daily drain
 *
 * GHL API versions are per endpoint: contacts/upsert 2021-07-28,
 * conversations/messages 2021-04-15.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage & { body?: unknown; query?: Record<string, string | string[]> };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };

const GHL_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_LOCATION = 'HkBNfpRezC5hRkWJaeSx';
const BATCH = 20;

export type EmailKind = 'claimant_received' | 'team_new_claim' | 'claimant_needs_info' | 'claimant_approved' | 'claimant_rejected';

export interface QueuedEmail {
    id: string;
    kind: EmailKind;
    claim_id: string;
    attempts: number;
    claimant_email: string | null;
    legal_name: string | null;
    claimant_role: string | null;
    review_note: string | null;
    provider_id: string;
    provider_name: string;
    provider_city: string | null;
    provider_country: string | null;
}

interface Cfg {
    url: string;
    key: string;
    pit: string;
    location: string;
    team: string[];
    /** Who gets the daily scorer alert. */
    review: string[];
    band: { low: number; high: number };
    from: string | null;
    site: string;
}

export function config(): Cfg {
    const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
    return {
        url: (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, ''),
        key: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        pit: process.env.GHL_PIT_MEDSOCIETY || '',
        location: process.env.GHL_LOCATION_MEDSOCIETY || DEFAULT_LOCATION,
        team: list(process.env.CLAIM_NOTIFY_TO || process.env.LEAD_NOTIFY_TO),
        review: list(process.env.REVIEW_ALERT_TO || process.env.CLAIM_NOTIFY_TO || process.env.LEAD_NOTIFY_TO),
        band: parseBand(process.env.REVIEW_ALERT_BAND),
        from: (process.env.CLAIM_EMAIL_FROM || '').trim() || null,
        site: (process.env.PUBLIC_SITE_URL || 'https://medsociety.one').replace(/\/$/, ''),
    };
}

/** "70-89" → { low: 70, high: 89 }; anything unreadable falls back to 70-89. Exported for the self-test. */
export function parseBand(v: string | undefined): { low: number; high: number } {
    const m = /^\s*(\d{1,3})\s*-\s*(\d{1,3})\s*$/.exec(v ?? '');
    const low = m ? Number(m[1]) : NaN, high = m ? Number(m[2]) : NaN;
    return m && low <= high && high <= 100 ? { low, high } : { low: 70, high: 89 };
}

// ── Rendering ───────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

interface Block { heading: string; paragraphs: string[]; button?: { label: string; href: string }; quote?: string }

function blockHtml(b: Block): string {
    return [
        `<h2 style="margin:0 0 12px;font:700 19px/1.3 system-ui,sans-serif;color:#0b1f33">${esc(b.heading)}</h2>`,
        ...b.paragraphs.map((p) => `<p style="margin:0 0 12px;font:15px/1.55 system-ui,sans-serif;color:#27384a">${esc(p)}</p>`),
        b.quote ? `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #c98a12;background:#fbf6ea;font:15px/1.55 system-ui,sans-serif;color:#27384a;white-space:pre-wrap">${esc(b.quote)}</blockquote>` : '',
        b.button ? `<p style="margin:16px 0 4px"><a href="${esc(b.button.href)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#0e7a5f;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none">${esc(b.button.label)}</a></p>` : '',
    ].join('');
}

function page(blocks: Block[]): string {
    const body = blocks.map(blockHtml).join('<hr style="border:0;border-top:1px solid #dfe5ea;margin:26px 0">');
    return `<div style="max-width:560px;margin:0 auto;padding:24px 20px">${body}`
        + `<p style="margin:28px 0 0;font:12px/1.5 system-ui,sans-serif;color:#6b7b8a">MedSociety · medsociety.one</p></div>`;
}

/** Subject and HTML for one queued e-mail. Exported for the self-test. */
export function renderEmail(e: QueuedEmail, site: string): { subject: string; html: string } {
    const listing = e.provider_name;
    const name = (e.legal_name || '').trim();
    const claimUrl = `${site}/claim/${e.provider_id}`;
    const spanishFirst = (e.provider_country || 'MX') !== 'US';
    const pick = (es: Block, en: Block) => (spanishFirst ? [es, en] : [en, es]);
    const subj = (es: string, en: string) => (spanishFirst ? `${es} · ${en}` : `${en} · ${es}`);
    const hiEs = name ? `Hola ${name}:` : 'Hola:';
    const hiEn = name ? `Hi ${name},` : 'Hi,';

    switch (e.kind) {
        case 'claimant_received':
            return {
                subject: subj(`Recibimos tu solicitud para ${listing}`, `We received your claim for ${listing}`),
                html: page(pick(
                    { heading: 'Recibimos tu solicitud', paragraphs: [
                        hiEs,
                        `Recibimos tu solicitud para administrar ${listing} en MedSociety. Antes de aprobarla, una persona de nuestro equipo revisa tu identificación, verifica tu cédula o licencia en el registro oficial, y llama o manda mensaje a la clínica al teléfono que ya aparece en el perfil. Avísale a tu recepción que esperen nuestra llamada.`,
                        'Normalmente toma de 1 a 3 días hábiles. Nada cambia en el perfil hasta que se apruebe.',
                        '¿No hiciste esta solicitud? Responde a este correo y la detenemos.',
                    ], button: { label: 'Ver el estado de mi solicitud', href: claimUrl } },
                    { heading: 'We received your claim', paragraphs: [
                        hiEn,
                        `We received your request to manage ${listing} on MedSociety. Before approving it, a person on our team reviews your ID, checks your cédula or licence at the official registry, and calls or messages the clinic at the phone already on the listing. Please let your front desk know to expect us.`,
                        'This usually takes 1–3 business days. Nothing changes on the listing until it is approved.',
                        'Did not request this? Reply to this e-mail and we will stop it.',
                    ], button: { label: 'Check my claim', href: claimUrl } },
                )),
            };
        case 'claimant_needs_info':
            return {
                subject: subj(`Necesitamos algo más para verificar ${listing}`, `We need a little more to verify ${listing}`),
                html: page(pick(
                    { heading: 'Necesitamos algo más', paragraphs: [hiEs, `Revisamos tu solicitud para ${listing}. Antes de aprobarla, nuestro equipo te pide lo siguiente:`],
                      quote: e.review_note || undefined, button: { label: 'Responder y subir documentos', href: claimUrl } },
                    { heading: 'We need a little more', paragraphs: [hiEn, `We reviewed your claim for ${listing}. Before we can approve it, our team asks for the following:`],
                      quote: e.review_note || undefined, button: { label: 'Answer and upload documents', href: claimUrl } },
                )),
            };
        case 'claimant_approved':
            return {
                subject: subj(`${listing} ya es tuyo en MedSociety`, `${listing} is now yours on MedSociety`),
                html: page(pick(
                    { heading: 'Solicitud aprobada', paragraphs: [hiEs, `Verificamos tu solicitud. Ya administras ${listing}: actualiza fotos, horarios, servicios y tu información de contacto desde tu panel.`],
                      button: { label: 'Ir a mi panel', href: `${site}/dashboard` } },
                    { heading: 'Claim approved', paragraphs: [hiEn, `We verified your claim. You now manage ${listing}: update photos, hours, services and contact details from your dashboard.`],
                      button: { label: 'Go to my dashboard', href: `${site}/dashboard` } },
                )),
            };
        case 'claimant_rejected':
            return {
                subject: subj(`No pudimos aprobar tu solicitud para ${listing}`, `We could not approve your claim for ${listing}`),
                html: page(pick(
                    { heading: 'Solicitud no aprobada', paragraphs: [hiEs, `Revisamos tu solicitud para ${listing} y no pudimos aprobarla. El motivo:`,
                        'Puedes enviar una nueva solicitud para este perfil 30 días después de esta decisión. Si crees que es un error, responde a este correo.'],
                      quote: e.review_note || undefined },
                    { heading: 'Claim not approved', paragraphs: [hiEn, `We reviewed your claim for ${listing} and could not approve it. The reason:`,
                        'You can submit a new claim for this listing 30 days after this decision. If you think this is a mistake, reply to this e-mail.'],
                      quote: e.review_note || undefined },
                )),
            };
        case 'team_new_claim':
            return {
                subject: `Claim to review: ${listing}`,
                html: page([{
                    heading: 'A listing claim is waiting for review',
                    paragraphs: [
                        `Listing: ${listing}${e.provider_city ? ` (${e.provider_city}${e.provider_country ? `, ${e.provider_country}` : ''})` : ''}`,
                        `Claimant: ${name || 'no name given'} · ${e.claimant_role ?? 'role not given'} · ${e.claimant_email ?? 'unknown account'}`,
                        'Documents and the automatic checks are in the admin queue only. Do not forward ID documents by e-mail.',
                    ],
                    button: { label: 'Open the Claims queue', href: `${site}/admin?tab=claims` },
                }]),
            };
    }
}

// ── GHL ─────────────────────────────────────────────────────────────────────
async function ghl(path: string, pit: string, version: string, payload: unknown): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null; text: string }> {
    const r = await fetch(`${GHL_BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${pit}`, Version: version, 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
    });
    const text = await r.text().catch(() => '');
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
    return { ok: r.ok, status: r.status, json, text };
}

/** Find-or-create the GHL contact for an address. No tags: an upsert must not touch a customer's billing tags. */
async function contactFor(cfg: Cfg, email: string, name: string | null): Promise<string> {
    const payload: Record<string, unknown> = { locationId: cfg.location, email, source: 'MedSociety claim' };
    if (name) payload.name = name;
    const r = await ghl('/contacts/upsert', cfg.pit, '2021-07-28', payload);
    const id = (r.json?.contact as { id?: unknown } | undefined)?.id;
    if (!r.ok || typeof id !== 'string') throw new Error(`GHL contact upsert ${r.status}: ${r.text.slice(0, 200)}`);
    return id;
}

async function sendEmail(cfg: Cfg, to: string, name: string | null, subject: string, html: string): Promise<string> {
    const contactId = await contactFor(cfg, to, name);
    const payload: Record<string, unknown> = { type: 'Email', contactId, subject, html };
    if (cfg.from) payload.emailFrom = cfg.from;
    const r = await ghl('/conversations/messages', cfg.pit, '2021-04-15', payload);
    if (!r.ok) throw new Error(`GHL send ${r.status}: ${r.text.slice(0, 200)}`);
    const id = r.json?.messageId ?? r.json?.emailMessageId ?? r.json?.id;
    return typeof id === 'string' ? id : '';
}

// ── Scorer alert ────────────────────────────────────────────────────────────

/** One row of review_near_bar (migration 0052). */
export interface NearBarItem {
    source_slug: string; external_id: string; score: number; verdict: 'approve' | 'reject' | 'needs_human'; reason: string;
    scored_at: string; status: string; tier: number; name: string; label: string | null; region: string | null;
    candidate: string | null; linked: boolean;
}

/**
 * The daily alert: cédula conflicts first, then the linked ones (already on
 * the site, so the most worth a second look), then those waiting. Names and
 * scores only: no cédula numbers or contact data in an e-mail. Exported for
 * the self-test.
 */
export function renderReviewDigest(items: NearBarItem[], site: string, band: { low: number; high: number }): { subject: string; html: string } {
    const conflicts = items.filter((i) => i.tier === 1);
    const linked = items.filter((i) => i.tier !== 1 && i.linked);
    const waiting = items.filter((i) => i.tier !== 1 && !i.linked);
    const line = (i: NearBarItem) => `${i.name}${i.candidate ? ` → ${i.candidate}` : ''} · AI ${i.score} · ${i.reason}`;
    const blocks: Block[] = [{
        heading: `${items.length} AI match${items.length === 1 ? '' : 'es'} to look at`,
        paragraphs: [
            `The match scorer links a source record to a doctor at a score of 80 or more. In the last day it judged these within ${band.low}-${band.high}, or found a cédula that belongs to another doctor.`,
            `Open each one in Verification to see the record and the doctor side by side.`,
        ],
        button: { label: 'Open Verification', href: `${site}/admin?tab=verification` },
    }];
    const section = (heading: string, why: string, list: NearBarItem[]) => {
        if (list.length) blocks.push({ heading: `${heading} (${list.length})`, paragraphs: [why, ...list.slice(0, 40).map(line), ...(list.length > 40 ? [`…and ${list.length - 40} more in Verification.`] : [])] });
    };
    section('Cédula conflicts', 'Never linked automatically. A person decides.', conflicts);
    section('Linked, badge live', 'Scored at or above 80, so the badge is on the site now. Worth a second look.', linked);
    section('Waiting for a person', 'Scored below 80, so nothing was linked.', waiting);
    return { subject: `MedSociety: ${items.length} AI match${items.length === 1 ? '' : 'es'} near the 80 bar`, html: page(blocks) };
}

/** Sends the daily alert. Nothing near the bar, nothing sent. */
export async function reviewAlert(cfg: Cfg, now = new Date()): Promise<{ items: number; sent: number; failed: number }> {
    const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
    const items = await rpc<NearBarItem[]>(cfg, 'review_near_bar', { p_since: since, p_low: cfg.band.low, p_high: cfg.band.high });
    if (!items?.length) return { items: 0, sent: 0, failed: 0 };
    if (!cfg.review.length) throw new Error('REVIEW_ALERT_TO is not set');
    const { subject, html } = renderReviewDigest(items, cfg.site, cfg.band);
    let sent = 0, failed = 0;
    for (const to of cfg.review) {
        try { await sendEmail(cfg, to, null, subject, html); sent++; } catch (err) { failed++; console.error('claim-notify review:', (err as Error).message); }
    }
    return { items: items.length, sent, failed };
}

// ── Supabase (service role) ─────────────────────────────────────────────────
async function rpc<T>(cfg: Cfg, fn: string, args: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(`${fn} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    const text = await r.text();
    return (text ? JSON.parse(text) : null) as T;
}

async function signedIn(cfg: Cfg, header: string | string[] | undefined): Promise<boolean> {
    const raw = Array.isArray(header) ? header[0] : header;
    const m = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/.exec((raw ?? '').trim());
    if (!m) return false;
    try {
        const apikey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || cfg.key;
        const r = await fetch(`${cfg.url}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${m[1]}` } });
        if (!r.ok) return false;
        const u = (await r.json()) as { id?: unknown; is_anonymous?: unknown };
        return typeof u.id === 'string' && u.is_anonymous !== true;
    } catch {
        return false;
    }
}

/** Sends everything queued, up to one batch. Never throws; failures stay queued for the next run. */
export async function drain(cfg: Cfg): Promise<{ sent: number; failed: number; skipped: number }> {
    const rows = await rpc<QueuedEmail[]>(cfg, 'claim_emails_take', { p_limit: BATCH });
    let sent = 0, failed = 0, skipped = 0;
    for (const e of rows ?? []) {
        const { subject, html } = renderEmail(e, cfg.site);
        const recipients = e.kind === 'team_new_claim' ? cfg.team : (e.claimant_email ? [e.claimant_email.toLowerCase()] : []);
        if (recipients.length === 0) {
            skipped++;
            await rpc(cfg, 'claim_emails_done', { p_id: e.id, p_ok: false, p_error: e.kind === 'team_new_claim' ? 'CLAIM_NOTIFY_TO is not set' : 'claimant has no e-mail' }).catch(() => undefined);
            continue;
        }
        try {
            const ids: string[] = [];
            for (const to of recipients) ids.push(await sendEmail(cfg, to, e.kind === 'team_new_claim' ? null : e.legal_name, subject, html));
            await rpc(cfg, 'claim_emails_done', { p_id: e.id, p_ok: true, p_message_id: ids.filter(Boolean).join(',') || null });
            sent++;
        } catch (err) {
            failed++;
            await rpc(cfg, 'claim_emails_done', { p_id: e.id, p_ok: false, p_error: (err as Error).message }).catch(() => undefined);
        }
    }
    return { sent, failed, skipped };
}

export default async function handler(req: Req, res: Res) {
    const cfg = config();
    if (!cfg.url || !cfg.key || !cfg.pit) {
        console.error('claim-notify: missing VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or GHL_PIT_MEDSOCIETY');
        return res.status(503).json({ error: 'not_configured' });
    }

    if (req.method === 'GET') {
        const secret = process.env.CRON_SECRET;
        if (!secret || req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'unauthorized' });
    } else if (req.method === 'POST') {
        if (!(await signedIn(cfg, req.headers.authorization))) return res.status(401).json({ error: 'unauthorized' });
    } else {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ error: 'method_not_allowed' });
    }

    const job = Array.isArray(req.query?.job) ? req.query?.job[0] : req.query?.job;
    if (job === 'review') {
        if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
        try {
            return res.status(200).json(await reviewAlert(cfg));
        } catch (err) {
            console.error('claim-notify review:', (err as Error).message);
            return res.status(500).json({ error: 'review_failed' });
        }
    }

    try {
        const out = await drain(cfg);
        if (out.failed) console.error(`claim-notify: ${out.failed} e-mail(s) failed; they stay queued`);
        return res.status(200).json(out);
    } catch (err) {
        console.error('claim-notify:', (err as Error).message);
        return res.status(500).json({ error: 'drain_failed' });
    }
}
