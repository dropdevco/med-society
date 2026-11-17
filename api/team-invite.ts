/**
 * POST /api/team-invite
 *   Authorization: Bearer <the signed-in user's Supabase access token>
 *
 *   {"clinicId","email","role":"owner"|"staff","providerId"?,"lang":"es"|"en"}
 *       Create a clinic-team invitation and e-mail it. Without providerId it
 *       brings someone onto the clinic's team; with it, it invites a doctor
 *       to claim their own listing (which still goes through claim review,
 *       migration 0049). Responds {ok, link, emailed}: the link comes back even
 *       when the e-mail could not be sent, so the dashboard can offer it for
 *       WhatsApp.
 *
 *   {"action":"link-notice","clinicId","providerId","lang"?}
 *       Tell a doctor who runs their own listing that a clinic wants to list
 *       them (the link is 'pending' until they accept in their dashboard).
 *       Best effort; responds {ok, emailed}.
 *
 * Both run the database check *as the user* (their token, not the service
 * role): team_invite and team_overview refuse anyone not on the clinic's team,
 * so this function adds nothing the user could not already do except the
 * e-mail. The service role is used only to look up the doctor's address for a
 * link notice.
 *
 * E-mail goes through GHL (decision D9), the same direct send as
 * api/claim-notify.ts: upsert the contact without tags, then
 * POST /conversations/messages. Self-contained like every file in api/.
 *
 * ── Env (server-only, Vercel → Settings → Environment Variables) ─────────────
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY   already set
 *   SUPABASE_SERVICE_ROLE_KEY                   link notices only
 *   GHL_PIT_MEDSOCIETY       contacts.write + conversations/message.write
 *   GHL_LOCATION_MEDSOCIETY  defaults to the MedSociety location
 *   TEAM_EMAIL_FROM          optional sender; falls back to CLAIM_EMAIL_FROM, then GHL's default
 *   PUBLIC_SITE_URL          defaults to https://medsociety.one
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse & { status: (code: number) => Res; json: (body: unknown) => void };
type Lang = 'en' | 'es';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_LOCATION = 'HkBNfpRezC5hRkWJaeSx';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const cfg = () => ({
    url: (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/$/, ''),
    anon: process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '',
    service: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    pit: process.env.GHL_PIT_MEDSOCIETY || '',
    location: process.env.GHL_LOCATION_MEDSOCIETY || DEFAULT_LOCATION,
    from: (process.env.TEAM_EMAIL_FROM || process.env.CLAIM_EMAIL_FROM || '').trim() || null,
    site: (process.env.PUBLIC_SITE_URL || 'https://medsociety.one').replace(/\/$/, ''),
});
type Cfg = ReturnType<typeof cfg>;

export interface InviteRow {
    invite_id: string;
    token: string;
    email: string;
    role: 'owner' | 'staff';
    kind?: 'team' | 'practitioner';
    provider_id: string;
    provider_name: string;
    clinic_name: string;
    country: string;
    inviter_email: string | null;
}

async function readBody(req: Req): Promise<Record<string, unknown>> {
    if (req.body && typeof req.body === 'object') return req.body as Record<string, unknown>;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

/** An RPC as the caller. Throws Error(<exception name or status_N>). */
async function rpcAsUser<T>(c: Cfg, token: string, fn: string, args: Record<string, unknown>): Promise<T> {
    if (!c.url || !c.anon) throw new Error('not_configured');
    const r = await fetch(`${c.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: c.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
    });
    const text = await r.text();
    if (!r.ok) {
        let message = `status_${r.status}`;
        try { message = JSON.parse(text)?.message || message; } catch { /* keep status */ }
        throw new Error(message);
    }
    return (text ? JSON.parse(text) : null) as T;
}

// ── Rendering (exported for scripts/team-selftest.ts) ───────────────────────
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function page(lang: Lang, heading: string, lines: string[], fine: string[], cta: { label: string; href: string }): string {
    const p = (t: string, muted = false) =>
        `<p style="margin:0 0 12px;font:${muted ? '14px' : '15px'}/1.55 system-ui,sans-serif;color:${muted ? '#5c6068' : '#27384a'}">${esc(t)}</p>`;
    return `<div lang="${lang}" style="max-width:560px;margin:0 auto;padding:24px 20px">`
        + `<h2 style="margin:0 0 12px;font:700 19px/1.3 system-ui,sans-serif;color:#0b1f33">${esc(heading)}</h2>`
        + lines.map((l) => p(l)).join('')
        + `<p style="margin:16px 0 14px"><a href="${esc(cta.href)}" style="display:inline-block;padding:11px 18px;border-radius:999px;background:#0e7a5f;color:#fff;font:600 15px system-ui,sans-serif;text-decoration:none">${esc(cta.label)}</a></p>`
        + fine.map((l) => p(l, true)).join('')
        + `<p style="margin:28px 0 0;font:12px/1.5 system-ui,sans-serif;color:#6b7b8a">MedSociety · medsociety.one</p></div>`;
}

export function renderInvite(row: InviteRow, link: string, lang: Lang): { subject: string; html: string } {
    const es = lang === 'es';
    const doctor = row.kind ? row.kind === 'practitioner' : row.provider_name !== row.clinic_name;
    const subject = doctor
        ? (es ? `${row.clinic_name} te invita a tu perfil en MedSociety` : `${row.clinic_name} invites you to your MedSociety profile`)
        : (es ? `Invitación para administrar ${row.clinic_name} en MedSociety` : `You're invited to manage ${row.clinic_name} on MedSociety`);
    const heading = doctor
        ? (es ? `${row.clinic_name} te agregó a su equipo médico` : `${row.clinic_name} listed you as one of its doctors`)
        : (es ? `Te invitaron al equipo de ${row.clinic_name}` : `You're invited to the ${row.clinic_name} team`);
    const lines = doctor
        ? (es
            ? [`Tu perfil, “${row.provider_name}”, aparece en MedSociety como parte del equipo de ${row.clinic_name}.`,
               'Para tomar control de tu perfil, confirma tu identidad: tu identificación y tu cédula profesional (o NPI). Nuestro equipo lo revisa a mano, normalmente en 1 a 3 días hábiles.']
            : [`Your profile, “${row.provider_name}”, is listed on MedSociety as part of the ${row.clinic_name} team.`,
               'To take over your profile, confirm who you are: your ID and your cédula profesional (or NPI). Our team checks it by hand, usually within 1–3 business days.'])
        : (es
            ? [row.role === 'staff'
                ? `Podrás editar el perfil de ${row.clinic_name}, sus fotos y sus médicos.`
                : `Podrás administrar el perfil de ${row.clinic_name} como propietario.`]
            : [row.role === 'staff'
                ? `You'll be able to edit ${row.clinic_name}'s profile, photos and doctors.`
                : `You'll be able to manage ${row.clinic_name}'s profile as an owner.`]);
    const fine = [
        es ? `Inicia sesión o crea tu cuenta con este correo (${row.email}). El enlace vence en 14 días.`
           : `Sign in or create your account with this e-mail (${row.email}). The link expires in 14 days.`,
        ...(row.inviter_email ? [es ? `Invitación enviada por ${row.inviter_email}.` : `Sent by ${row.inviter_email}.`] : []),
        es ? 'Si no esperabas este correo, puedes ignorarlo.' : "If you weren't expecting this, you can ignore it.",
    ];
    return { subject, html: page(lang, heading, lines, fine, { label: es ? 'Aceptar invitación' : 'Accept invitation', href: link }) };
}

export function renderLinkNotice(clinic: { name: string; city: string | null }, doctorName: string, site: string, lang: Lang): { subject: string; html: string } {
    const es = lang === 'es';
    const where = clinic.city ? `${clinic.name} (${clinic.city})` : clinic.name;
    return {
        subject: es ? `${clinic.name} quiere mostrarte en su perfil` : `${clinic.name} wants to list you on its profile`,
        html: page(lang,
            es ? `${where} quiere mostrarte como uno de sus médicos` : `${where} wants to list you as one of its doctors`,
            [es ? `Si aceptas, “${doctorName}” aparecerá en la página de la clínica en MedSociety y tu perfil mostrará dónde atiendes. La clínica no podrá editar tu perfil a menos que tú lo permitas.`
                : `If you accept, “${doctorName}” will appear on the clinic's MedSociety page and your profile will show where you practise. The clinic cannot edit your profile unless you allow it.`],
            [es ? 'Si no trabajas ahí, recházalo en tu panel.' : "If you don't work there, decline it in your dashboard."],
            { label: es ? 'Responder en mi panel' : 'Answer in my dashboard', href: `${site}/dashboard` }),
    };
}

// ── GHL ─────────────────────────────────────────────────────────────────────
async function ghl(c: Cfg, path: string, version: string, payload: unknown) {
    const r = await fetch(`${GHL_BASE}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.pit}`, Version: version, 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
    });
    const text = await r.text().catch(() => '');
    let json: Record<string, unknown> | null = null;
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { json = null; }
    return { ok: r.ok, status: r.status, json, text };
}

/** Upsert the contact (no tags: never touch a customer's billing tags), then send. */
async function sendEmail(c: Cfg, to: string, mail: { subject: string; html: string }): Promise<boolean> {
    if (!c.pit) { console.error('[team-invite] GHL_PIT_MEDSOCIETY not set'); return false; }
    const up = await ghl(c, '/contacts/upsert', '2021-07-28', { locationId: c.location, email: to, source: 'MedSociety team' });
    const contactId = (up.json?.contact as { id?: unknown } | undefined)?.id;
    if (!up.ok || typeof contactId !== 'string') {
        console.error('[team-invite] GHL contact upsert', up.status, up.text.slice(0, 200));
        return false;
    }
    const payload: Record<string, unknown> = { type: 'Email', contactId, subject: mail.subject, html: mail.html };
    if (c.from) payload.emailFrom = c.from;
    const r = await ghl(c, '/conversations/messages', '2021-04-15', payload);
    if (!r.ok) console.error('[team-invite] GHL send', r.status, r.text.slice(0, 200));
    return r.ok;
}

/** E-mails of the people who own a listing as its owner (role 'owner'). Service role. */
async function ownerEmails(c: Cfg, providerId: string): Promise<string[]> {
    if (!c.url || !c.service) return [];
    const h = { apikey: c.service, Authorization: `Bearer ${c.service}` };
    const r = await fetch(`${c.url}/rest/v1/provider_owners?select=user_id&role=eq.owner&provider_id=eq.${providerId}`, { headers: h });
    if (!r.ok) return [];
    const rows = (await r.json()) as { user_id: string }[];
    const out: string[] = [];
    for (const { user_id } of rows.slice(0, 5)) {
        const u = await fetch(`${c.url}/auth/v1/admin/users/${user_id}`, { headers: h });
        if (!u.ok) continue;
        const user = (await u.json()) as { email?: string; email_confirmed_at?: string | null };
        if (user.email && user.email_confirmed_at) out.push(user.email);
    }
    return out;
}

const statusFor = (message: string) =>
    /not_signed_in|JWT|status_401/.test(message) ? 401
        : /not_on_team|owner_only|not_linked/.test(message) ? 403
            : /not_configured/.test(message) ? 500 : 400;

export default async function handler(req: Req, res: Res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method_not_allowed' });
    }
    const c = cfg();
    const auth = String(req.headers.authorization || '');
    const userToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!userToken) return res.status(401).json({ error: 'not_signed_in' });

    const body = await readBody(req);
    const clinicId = String(body.clinicId || '');
    const providerId = body.providerId ? String(body.providerId) : null;
    const lang: Lang = body.lang === 'en' ? 'en' : 'es';
    if (!UUID.test(clinicId) || (providerId && !UUID.test(providerId))) {
        return res.status(400).json({ error: 'bad_request' });
    }

    if (body.action === 'link-notice') {
        if (!providerId) return res.status(400).json({ error: 'bad_request' });
        try {
            // As the user: proves they are on the clinic's team, and that this link is pending.
            const team = await rpcAsUser<{ practitioners: { id: string; name: string; link_status: string }[] }>(
                c, userToken, 'team_overview', { p_clinic: clinicId });
            const doc = team.practitioners.find((p) => p.id === providerId && p.link_status === 'pending');
            if (!doc) return res.status(200).json({ ok: true, emailed: false });
            const info = await fetch(`${c.url}/rest/v1/provider_list?select=name,city,country&id=eq.${clinicId}`, {
                headers: { apikey: c.anon, Authorization: `Bearer ${c.anon}` },
            }).then((r) => (r.ok ? r.json() : [])) as { name: string; city: string | null; country: string }[];
            const cl = info[0] ?? { name: '', city: null, country: 'MX' };
            const mailLang: Lang = body.lang ? lang : (cl.country === 'US' ? 'en' : 'es');
            let emailed = false;
            for (const to of await ownerEmails(c, providerId)) {
                emailed = (await sendEmail(c, to, renderLinkNotice(cl, doc.name, c.site, mailLang))) || emailed;
            }
            return res.status(200).json({ ok: true, emailed });
        } catch (e) {
            const message = (e as Error).message;
            return res.status(statusFor(message)).json({ error: message });
        }
    }

    const email = String(body.email || '').trim().toLowerCase();
    const role = body.role === 'owner' ? 'owner' : 'staff';
    if (!EMAIL.test(email) || email.length > 160) return res.status(400).json({ error: 'bad_email' });

    let row: InviteRow;
    try {
        row = await rpcAsUser<InviteRow>(c, userToken, 'team_invite', {
            p_clinic: clinicId, p_email: email, p_role: role, p_provider: providerId,
        });
    } catch (e) {
        const message = (e as Error).message;
        const status = statusFor(message);
        if (status === 500) console.error('[team-invite]', message);
        return res.status(status).json({ error: message });
    }

    const link = `${c.site}/invite/${row.token}`;
    let emailed = false;
    try {
        emailed = await sendEmail(c, row.email, renderInvite(row, link, lang));
    } catch (e) {
        console.error('[team-invite] send threw:', (e as Error).message);
    }
    return res.status(200).json({ ok: true, link, emailed });
}
