/**
 * Paid plans: payment → listing tier → GHL contact tags, and back out again when
 * the payments stop. Payments move from GoHighLevel payment links to Stripe (see
 * the Stripe section further down: checkout, customer portal and webhook); the
 * GHL path below stays until that cutover and GHL remains the CRM either way.
 *
 *   POST /api/billing?job=stripe-checkout   an owner starts a Stripe Checkout.
 *   POST /api/billing?job=stripe-portal     an owner opens the Stripe portal.
 *   POST /api/billing?job=stripe            Stripe webhook (authenticated by
 *                                           fetching the event from Stripe).
 *
 *   POST /api/billing                  a GHL workflow reports a payment, cancel,
 *                                      failed charge or refund. Needs the shared
 *                                      secret (header `x-webhook-secret`).
 *   GET  /api/billing?job=sync         Vercel Cron, daily (vercel.json). Lets
 *                                      unpaid plans run out, repairs any tier that
 *                                      drifted, and retries GHL tagging that failed.
 *                                      Needs `Authorization: Bearer $CRON_SECRET`.
 *
 * Where the logic lives: matching a payer to a listing, extending the plan and
 * computing the tier are all in Postgres (supabase/migrations/0029_plan_billing.sql),
 * so they are atomic, replay-safe and testable without this file. This function
 * is the thin edge: authenticate, normalise GHL's payload, call the database,
 * then mirror the result into the GHL contact.
 *
 * ── Why a lost webhook cannot leave anyone on a plan they stopped paying for ──
 * Access is `paid_through + 4 days > now`. Every successful payment moves
 * `paid_through` out one month. Nothing has to arrive for a plan to END.
 *
 * ── GHL workflow (one per payment link, or one with branches) ────────────────
 *   Trigger : Payment Received (filter by product), plus one for the cancel /
 *             refund events you want honoured.
 *   Action  : Webhook → POST https://www.medsociety.one/api/billing
 *             Header  x-webhook-secret: <BILLING_WEBHOOK_SECRET>
 *             Custom data (these keys are read, in any case or snake/camel form):
 *               event   payment | canceled | failed | refunded   (default payment)
 *               plan    promoted | featured
 *               market  us | mx
 *             Plus whatever of these GHL can fill in (all optional, all improve
 *             matching): contact_id, email, phone, transaction_id / order_id /
 *             invoice_id, subscription_id, amount, currency, product_name.
 *   The standard contact fields GHL adds to every webhook are enough on their own.
 *
 * ── Sync ping: catching every change the moment it happens ───────────────────
 * Add one more GHL workflow: trigger "Contact Tag" (added / removed, for the
 * tier-promoted and tier-featured tags), or any payment trigger, action Webhook
 * with custom data `event` = `sync`. The payload only names the contact. The
 * site then reads that contact's payments from GHL, applies them, mirrors the
 * tags and emails the team, so a plan switches on within seconds of the tag.
 *
 * ── The backstop: the daily sync reads GHL itself ────────────────────────────
 * The webhook is the fast path; it is not the only one. Every day the sync also
 * lists GHL's live transactions and subscriptions (read-only) and feeds any
 * payment, cancellation or refund it finds through the same database function.
 * Events are keyed by GHL's own charge / subscription id, so whatever the
 * webhook already delivered is a no-op, and whatever it missed or never had a
 * workflow for is picked up the next morning. Test-mode objects are ignored.
 *
 * ── Env (Vercel → Settings → Environment Variables, production) ──────────────
 *   GHL_PIT_READONLY         optional but needed for the backstop: a Private
 *                            Integration Token with view access to Payments
 *                            (transactions, subscriptions). Falls back to
 *                            GHL_PIT_MEDSOCIETY if that token has those scopes.
 *   BILLING_ACCEPT_TEST_MODE set to 1 ONLY while rehearsing with GHL test payments;
 *                            remove it before going live (test charges then count).
 *   BILLING_WEBHOOK_SECRET   random string (openssl rand -hex 32), same as the header
 *   CRON_SECRET              already set for api/forum-notify.ts; Vercel sends it
 *   SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL      already set
 *   GHL_PIT_MEDSOCIETY, GHL_LOCATION_MEDSOCIETY       already set (borderhealth-lead)
 *   RESEND_API_KEY, LEAD_NOTIFY_TO, LEAD_NOTIFY_FROM  already set; used for the
 *                            "payment I could not match" alert
 *   PUBLIC_SITE_URL          optional, defaults to https://medsociety.one
 *   STRIPE_SECRET_KEY        sk_test_… (Preview) or sk_live_… (Production); without
 *                            it the Stripe routes answer 500 and the cron skips Stripe
 *   STRIPE_PORTAL_CONFIG     optional bpc_… to choose a portal configuration
 *
 * GHL API version for contacts and tags: 2021-07-28.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse & {
    status: (code: number) => Res;
    json: (body: unknown) => void;
};

const GHL_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_LOCATION = 'HkBNfpRezC5hRkWJaeSx';
const SITE = process.env.PUBLIC_SITE_URL || 'https://medsociety.one';

// ── Normalisation ────────────────────────────────────────────────────────────

export type Kind = 'payment' | 'canceled' | 'failed' | 'refunded' | 'refund_seen';
export type Plan = 'promoted' | 'featured';
export type Market = 'us' | 'mx';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Trimmed, lower-cased, or '' when it is not an email at all. */
export function normEmail(v: unknown): string {
    const s = String(v ?? '').trim().toLowerCase();
    return EMAIL.test(s) ? s : '';
}

/**
 * Phone in E.164, which is how GHL stores it. Bare ten-digit numbers take the
 * country of the market the payment came from; anything that cannot be read
 * with confidence returns '' rather than a guess that creates a second contact.
 */
export function toE164(v: unknown, market: Market | null): string {
    const raw = String(v ?? '').trim();
    if (!raw) return '';
    const digits = raw.replace(/\D/g, '');
    // Old Mexican mobile format, +52 1 XX XXXX XXXX: the 1 is gone from the real number.
    if (digits.length === 13 && digits.startsWith('521')) return `+52${digits.slice(3)}`;
    if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : '';
    if (digits.length === 10) return market === 'mx' ? `+52${digits}` : `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
    return '';
}

/** Reads a plan out of free text such as a GHL product name, in either language. */
export function inferPlan(text: string): Plan | null {
    const s = text.toLowerCase();
    if (/featured|destacad/.test(s)) return 'featured';
    if (/promoted|promocionad|promovid|promoci[oó]n/.test(s)) return 'promoted';
    return null;
}

const squash = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * First non-empty scalar found under any of `keys`, looking at the payload root
 * and the places GHL nests things. Key matching ignores case, `_` and `-`, so
 * `contact_id`, `contactId` and `Contact-ID` are all the same key.
 */
export function pick(root: unknown, keys: string[]): string {
    const wanted = new Set(keys.map(squash));
    const r = (root && typeof root === 'object' ? root : {}) as Record<string, unknown>;
    const scopes: unknown[] = [r, r.customData, r.custom_data, r.contact, r.data, r.payment, r.order];
    for (const scope of scopes) {
        if (!scope || typeof scope !== 'object') continue;
        for (const [k, v] of Object.entries(scope as Record<string, unknown>)) {
            if (!wanted.has(squash(k))) continue;
            if (typeof v === 'string' || typeof v === 'number') {
                const s = String(v).trim();
                if (s) return s;
            }
        }
    }
    return '';
}

export interface ParsedEvent {
    key: string;
    kind: Kind;
    plan: Plan | null;
    market: Market | null;
    email: string;
    phone: string;
    contactId: string;
    subscriptionId: string;
    amount: number | null;
    currency: string;
    product: string;
}

export function parseEvent(body: unknown, now = new Date()): { ok: true; ev: ParsedEvent } | { ok: false; error: string } {
    if (!body || typeof body !== 'object') return { ok: false, error: 'empty_body' };

    const rawKind = pick(body, ['event', 'eventType', 'billingEvent']).toLowerCase();
    const kind: Kind = /cancel/.test(rawKind) ? 'canceled'
        : /refund/.test(rawKind) ? 'refunded'
        : /fail|declin/.test(rawKind) ? 'failed'
        : 'payment';

    // `entitySourceName` is the payment link's own name in GHL ("MedSociety Promoted US").
    const product = pick(body, ['productName', 'product', 'priceName', 'planName', 'itemName', 'entitySourceName', 'sourceName', 'description']);
    const planRaw = pick(body, ['plan']).toLowerCase();
    const plan: Plan | null = planRaw === 'promoted' || planRaw === 'featured' ? planRaw : inferPlan(`${planRaw} ${product}`);

    const currency = pick(body, ['currency']).toUpperCase().slice(0, 3);
    const marketRaw = pick(body, ['market', 'region']).toLowerCase();
    const market: Market | null = marketRaw === 'mx' || marketRaw === 'us' ? marketRaw
        : currency === 'MXN' ? 'mx'
        : currency === 'USD' ? 'us'
        : /\bmx\b/i.test(product) ? 'mx'
        : /\bus\b/i.test(product) ? 'us'
        : null;

    const email = normEmail(pick(body, ['email', 'contactEmail', 'customerEmail']));
    const phone = pick(body, ['phone', 'contactPhone', 'customerPhone']);
    // A bare `id` is only the contact's inside the `contact` object; elsewhere it is a payment or order id.
    const nested = (body as { contact?: { id?: unknown } }).contact?.id;
    const contactId = (pick(body, ['contactId']) || (typeof nested === 'string' ? nested.trim() : '')).slice(0, 64);
    const subscriptionId = pick(body, ['subscriptionId']).slice(0, 80);
    const amountRaw = Number.parseFloat(pick(body, ['amount', 'total', 'amountPaid']));
    const amount = Number.isFinite(amountRaw) ? amountRaw : null;

    if (!email && !phone && !contactId && !subscriptionId) return { ok: false, error: 'no_payer' };

    // One charge is often reported more than once (order, invoice, payment). A
    // real id dedupes exactly; without one, same payer + plan + day does.
    const txn = pick(body, ['transactionId', 'paymentId', 'orderId', 'invoiceId', 'chargeId']).slice(0, 80);
    const day = now.toISOString().slice(0, 10);
    const who = contactId || email || squash(phone);
    const key = txn
        ? `${kind}:${txn}`
        : `${kind}:${plan ?? '?'}:${createHash('sha1').update(who).digest('hex').slice(0, 16)}:${day}`;

    return { ok: true, ev: { key, kind, plan, market, email, phone, contactId, subscriptionId, amount, currency, product } };
}

/** `Authorization: Bearer x` or a raw value, compared without leaking length or position. */
export function secretMatches(given: string, secret: string): boolean {
    if (!secret) return false;
    const a = createHash('sha256').update(given).digest();
    const b = createHash('sha256').update(secret).digest();
    return timingSafeEqual(a, b);
}

// ── Tags ─────────────────────────────────────────────────────────────────────
// The tags are how the team (and any GHL automation) sees who is on a paid plan.
// They are computed from the plans a contact holds RIGHT NOW across all of its
// listings, never from the single event, so a lapse never strips a tag the
// contact still earns elsewhere.

export const PLAN_TAGS: Record<Plan, string> = {
    promoted: 'tier-promoted',
    featured: 'tier-featured',
};
const ACTIVE_TAG = 'medsociety-plan-active';
const LAPSED_TAG = 'medsociety-plan-lapsed';

export function tagsFor(activePlans: string[], market: string | null): { add: string[]; remove: string[] } {
    const active = new Set(activePlans.filter((p): p is Plan => p === 'promoted' || p === 'featured'));
    const add = ['medsociety-customer'];
    const remove: string[] = [];
    if (market === 'us' || market === 'mx') add.push(`medsociety-market-${market}`);
    for (const p of ['promoted', 'featured'] as const) (active.has(p) ? add : remove).push(PLAN_TAGS[p]);
    (active.size > 0 ? add : remove).push(ACTIVE_TAG);
    (active.size > 0 ? remove : add).push(LAPSED_TAG);
    return { add, remove };
}

// ── Supabase (service role) ──────────────────────────────────────────────────

interface Cfg {
    supaUrl: string;
    supaKey: string;
    /** Read-write token: contacts, tags, notes. */
    pit: string;
    /** Token for listing payments; the read-write one when no separate token is set. */
    readPit: string;
    locationId: string;
}

function settings(): Cfg | null {
    const supaUrl = (process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
    const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
    if (!supaUrl || !supaKey) return null;
    return {
        supaUrl,
        supaKey,
        pit: process.env.GHL_PIT_MEDSOCIETY ?? '',
        readPit: process.env.GHL_PIT_READONLY || process.env.GHL_PIT_MEDSOCIETY || '',
        locationId: process.env.GHL_LOCATION_MEDSOCIETY || DEFAULT_LOCATION,
    };
}

async function rpc<T>(cfg: Cfg, fn: string, args: Record<string, unknown>): Promise<T> {
    const r = await fetch(`${cfg.supaUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.supaKey, Authorization: `Bearer ${cfg.supaKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${fn} ${r.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
}

interface ApplyResult {
    outcome: string;
    detail?: string;
    event_id?: string;
    provider_id?: string;
    plan?: Plan;
    tier?: string;
    subscription_id?: string;
    ghl_contact_id?: string | null;
}

interface PendingRow {
    id: string;
    provider_id: string;
    provider_name: string;
    plan: Plan;
    market: Market | null;
    status: string;
    paid_through: string | null;
    payer_email: string | null;
    payer_phone: string | null;
    ghl_contact_id: string | null;
    active_plans: string[];
}

// ── GoHighLevel ──────────────────────────────────────────────────────────────

interface GhlResult {
    ok: boolean;
    status: number;
    json: Record<string, unknown> | null;
    text: string;
}

async function ghl(cfg: Cfg, method: 'POST' | 'DELETE', path: string, payload: unknown): Promise<GhlResult> {
    const r = await fetch(`${GHL_BASE}${path}`, {
        method,
        headers: {
            Authorization: `Bearer ${cfg.pit}`,
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

async function upsertContact(
    cfg: Cfg,
    row: { email: string | null; phone: string | null; market: Market | null; name: string },
    tags: string[],
): Promise<string | null> {
    const email = normEmail(row.email);
    const phone = toE164(row.phone, row.market);
    if (!email && !phone) return null;
    const up = await ghl(cfg, 'POST', '/contacts/upsert', {
        locationId: cfg.locationId,
        email: email || undefined,
        phone: phone || undefined,
        companyName: row.name || undefined,
        source: 'medsociety.one/plans',
        tags,
    });
    if (!up.ok) throw new Error(`upsert ${up.status}: ${up.text.slice(0, 200)}`);
    return (up.json?.contact as { id?: string } | undefined)?.id ?? null;
}

/** Mirrors one subscription into its GHL contact. Throws on anything that should be retried. */
async function pushToGhl(cfg: Cfg, row: PendingRow): Promise<string> {
    if (!cfg.pit) throw new Error('GHL_PIT_MEDSOCIETY is not set');
    const { add, remove } = tagsFor(row.active_plans, row.market);
    const who = { email: row.payer_email, phone: row.payer_phone, market: row.market, name: row.provider_name };

    let id = row.ghl_contact_id;
    if (!id) {
        id = await upsertContact(cfg, who, add);
        if (!id) throw new Error('no contact id and no usable email or phone to find one');
    }

    let added = await ghl(cfg, 'POST', `/contacts/${id}/tags`, { tags: add });
    if (!added.ok && (added.status === 404 || added.status === 400)) {
        // The contact id from the webhook is stale (merged or deleted). Find the person again.
        const found = await upsertContact(cfg, who, add);
        if (!found) throw new Error(`tags ${added.status}: ${added.text.slice(0, 200)}`);
        id = found;
        added = await ghl(cfg, 'POST', `/contacts/${id}/tags`, { tags: add });
    }
    if (!added.ok) throw new Error(`tags ${added.status}: ${added.text.slice(0, 200)}`);

    if (remove.length > 0) {
        const removed = await ghl(cfg, 'DELETE', `/contacts/${id}/tags`, { tags: remove });
        if (!removed.ok) throw new Error(`untag ${removed.status}: ${removed.text.slice(0, 200)}`);
    }

    const until = row.paid_through ? row.paid_through.slice(0, 10) : 'n/a';
    const note = await ghl(cfg, 'POST', `/contacts/${id}/notes`, {
        body: [
            `MedSociety plan: ${row.plan}${row.market ? ` (${row.market.toUpperCase()})` : ''}, status ${row.status}.`,
            `Listing: ${row.provider_name} ${SITE}/providers/${row.provider_id}`,
            `Paid through ${until}.`,
        ].join('\n'),
    });
    if (!note.ok) console.error('billing: note non-2xx', note.status, note.text.slice(0, 200));
    return id;
}

// ── Doctor websites: reserved when a Featured plan switches on ───────────────
//
// A Featured (US$99) clinic gets <name>.medsociety.one. When its payment is mirrored to GHL we
//   1. create the doctor_sites row (private preview, never public by itself),
//   2. add the subdomain to the Vercel project (needs VERCEL_TOKEN),
//   3. tag the GHL contact `site-brief-invite`, which starts the "set up your website" email.
// Every step is safe to repeat: the row is looked up first, a domain that is already on the project
// counts as done, and the tag is only sent when something was newly created. A failure throws so the
// daily sync retries the whole thing. Set SITE_AUTOCREATE=0 to switch it off without a deploy.

const SITE_ROOT = 'medsociety.one';
export const SITE_INVITE_TAG = 'site-brief-invite';
const SITE_RESERVED = new Set([
    'www', 'api', 'app', 'admin', 'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2',
    'support', 'help', 'blog', 'docs', 'status', 'dashboard', 'account', 'accounts', 'login',
    'auth', 'billing', 'pay', 'pricing', 'cdn', 'static', 'assets', 'media', 'files', 'dev',
    'staging', 'test', 'demo', 'preview', 'beta', 'medsociety',
]);

/** A subdomain from a clinic's name: ASCII, lower case, hyphens, at most 30 characters; `attempt` adds -2, -3... */
export function siteSubdomain(name: string, attempt = 0): string {
    let slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug.length > 30) slug = slug.slice(0, 30).replace(/-[^-]*$/, '') || slug.slice(0, 30);
    slug = slug.replace(/^-+|-+$/g, '');
    if (slug.length < 3) slug = `clinic-${slug}`.replace(/-+$/, '');
    if (attempt > 0) slug = `${slug}-${attempt + 1}`;
    return slug;
}

async function supa(cfg: Cfg, method: 'GET' | 'POST', path: string, payload?: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
    const r = await fetch(`${cfg.supaUrl}/rest/v1/${path}`, {
        method,
        headers: {
            apikey: cfg.supaKey, Authorization: `Bearer ${cfg.supaKey}`, 'Content-Type': 'application/json',
            ...(method === 'POST' ? { Prefer: 'return=representation' } : {}),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const text = await r.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { ok: r.ok, status: r.status, json };
}

export interface SiteOutcome { subdomain: string; rowCreated: boolean; domain: 'created' | 'exists'; tagged: boolean }

/** Makes sure a Featured clinic has its site row, its domain on Vercel and its invite tag. Null when switched off. */
export async function ensureSite(cfg: Cfg, row: { provider_id: string; provider_name: string }, contactId: string): Promise<SiteOutcome | null> {
    const token = process.env.VERCEL_TOKEN;
    if (!token || process.env.SITE_AUTOCREATE === '0') return null;
    const projectId = process.env.VERCEL_PROJECT_ID || 'prj_K8fOI7RFDxAkN6SIGGQSUtSVt1ko';
    const teamId = process.env.VERCEL_TEAM_ID || 'team_u2N7euFcusjSyjyA6t6kRDha';

    // 1. the row
    let subdomain = '';
    let rowCreated = false;
    const have = await supa(cfg, 'GET', `doctor_sites?select=subdomain&provider_id=eq.${encodeURIComponent(row.provider_id)}&limit=1`);
    if (!have.ok) throw new Error(`site lookup ${have.status}`);
    const existing = (have.json as { subdomain: string }[])[0];
    if (existing) {
        subdomain = existing.subdomain;
    } else {
        for (let attempt = 0; attempt < 6 && !subdomain; attempt++) {
            const candidate = siteSubdomain(row.provider_name, attempt);
            if (SITE_RESERVED.has(candidate)) continue;
            const made = await supa(cfg, 'POST', 'doctor_sites', { provider_id: row.provider_id, subdomain: candidate, status: 'preview' });
            if (made.ok) { subdomain = candidate; rowCreated = true; break; }
            if (made.status === 409) {
                // Either someone created this clinic's row a moment ago, or the name is taken: look again, else try the next name.
                const again = await supa(cfg, 'GET', `doctor_sites?select=subdomain&provider_id=eq.${encodeURIComponent(row.provider_id)}&limit=1`);
                const found = again.ok ? (again.json as { subdomain: string }[])[0] : undefined;
                if (found) { subdomain = found.subdomain; break; }
                continue;
            }
            throw new Error(`site insert ${made.status}: ${JSON.stringify(made.json).slice(0, 200)}`);
        }
        if (!subdomain) throw new Error('site insert: no free subdomain after 6 tries');
    }

    // 2. the domain on the Vercel project
    const domain = `${subdomain}.${SITE_ROOT}`;
    const vercel = (path: string, init?: RequestInit) => fetch(`https://api.vercel.com${path}${path.includes('?') ? '&' : '?'}teamId=${teamId}`, {
        ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const added = await vercel(`/v10/projects/${projectId}/domains`, { method: 'POST', body: JSON.stringify({ name: domain }) });
    let domainState: 'created' | 'exists';
    if (added.ok) {
        domainState = 'created';
    } else if (added.status === 409) {
        // Already attached to this project is fine; attached to another one is not.
        const check = await vercel(`/v9/projects/${projectId}/domains/${encodeURIComponent(domain)}`);
        if (!check.ok) throw new Error(`vercel domain ${domain} is in use elsewhere (${added.status})`);
        domainState = 'exists';
    } else {
        throw new Error(`vercel domain ${added.status}: ${(await added.text().catch(() => '')).slice(0, 200)}`);
    }

    // 3. the email trigger, only when something is new
    let tagged = false;
    if (rowCreated || domainState === 'created') {
        const t = await ghl(cfg, 'POST', `/contacts/${contactId}/tags`, { tags: [SITE_INVITE_TAG] });
        if (!t.ok) throw new Error(`site tag ${t.status}: ${t.text.slice(0, 200)}`);
        tagged = true;
        const note = await ghl(cfg, 'POST', `/contacts/${contactId}/notes`, { body: `Website reserved: https://${domain} (private preview until the team publishes it).` });
        if (!note.ok) console.error('billing: site note non-2xx', note.status);
        await alertTeam(`MedSociety: website reserved for ${row.provider_name}`, [
            `https://${domain} (preview, not public). The owner was sent the set-up email via the ${SITE_INVITE_TAG} tag.`,
            `${SITE}/providers/${row.provider_id}`,
        ]);
    }
    return { subdomain, rowCreated, domain: domainState, tagged };
}

/** Pushes one row and records the result, so a failure is retried tomorrow instead of lost. */
async function syncRow(cfg: Cfg, row: PendingRow): Promise<boolean> {
    try {
        const contactId = await pushToGhl(cfg, row);
        if (row.plan === 'featured' && row.status === 'active') await ensureSite(cfg, row, contactId);
        await rpc(cfg, 'billing_mark_synced', { sid: row.id, ok: true, err: null, contact_id: contactId });
        return true;
    } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        console.error('billing: ghl sync failed', row.id, msg.slice(0, 300));
        await rpc(cfg, 'billing_mark_synced', { sid: row.id, ok: false, err: msg, contact_id: null }).catch(() => undefined);
        return false;
    }
}

// ── Alerts ───────────────────────────────────────────────────────────────────

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function alertTeam(subject: string, lines: string[]): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_NOTIFY_FROM;
    const to = (process.env.LEAD_NOTIFY_TO ?? '').split(',').map((a) => a.trim()).filter(Boolean);
    if (!apiKey || !from || to.length === 0) {
        console.error('billing: alert not sent (Resend env missing):', subject);
        return;
    }
    const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from,
            to,
            subject,
            text: lines.join('\n'),
            html: `<div style="font:14px system-ui,sans-serif">${lines.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join('')}</div>`,
        }),
    });
    if (!r.ok) console.error('billing: resend failed', r.status, (await r.text().catch(() => '')).slice(0, 200));
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function readBody(req: Req): Promise<unknown> {
    let body = req.body;
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch {
            body = undefined;
        }
    }
    if (body === undefined) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            body = undefined;
        }
    }
    return body;
}

function applyEvent(cfg: Cfg, ev: ParsedEvent): Promise<ApplyResult> {
    return rpc<ApplyResult>(cfg, 'apply_billing_event', {
        p_event_key: ev.key,
        p_kind: ev.kind,
        p_plan: ev.plan,
        p_market: ev.market,
        p_email: ev.email,
        p_phone: ev.phone,
        p_contact_id: ev.contactId,
        p_subscription_id: ev.subscriptionId,
        p_amount: ev.amount,
        p_currency: ev.currency,
        p_product: ev.product,
        p_payload: null,
    });
}

// ── Backstop: read GHL's own payment records ─────────────────────────────────
// Shapes taken from the live API (payments/transactions, payments/subscriptions).
// Only the fields used here are typed.

export interface GhlTransaction {
    contactId?: string;
    contactEmail?: string;
    currency?: string;
    amount?: number;
    amountRefunded?: number;
    status?: string;
    liveMode?: boolean;
    entitySourceName?: string;
    subscriptionId?: string;
    chargeId?: string;
    createdAt?: string;
}

export interface GhlSubscription {
    contactId?: string;
    contactEmail?: string;
    currency?: string;
    amount?: number;
    status?: string;
    liveMode?: boolean;
    entitySourceName?: string;
    subscriptionId?: string;
    recurringProduct?: { product?: { name?: string } };
    updatedAt?: string;
}

/** A new payment is only taken from the last 10 days: the daily run has long since seen anything older. */
export const PAYMENT_WINDOW_DAYS = 10;
/** Cancellations and refunds are idempotent by id, so a longer look-back is safe. */
export const CHANGE_WINDOW_DAYS = 45;

const within = (iso: string | undefined, days: number, now: Date) => {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) && now.getTime() - t <= days * 86_400_000;
};

/**
 * Turns GHL's live payment records into the same events the webhook produces.
 * Keys come from GHL's own ids, so running this daily, or after the webhook
 * already delivered the same charge, changes nothing. Test-mode records are
 * ignored unless `acceptTest` is set (BILLING_ACCEPT_TEST_MODE=1, for rehearsing
 * the whole loop before GHL payments go live); products that are not one of the
 * two plans are always ignored.
 */
export function eventsFromGhl(
    txs: GhlTransaction[],
    subs: GhlSubscription[],
    now = new Date(),
    opts: { acceptTest?: boolean } = {},
): ParsedEvent[] {
    const usable = (liveMode: boolean | undefined) => liveMode === true || opts.acceptTest === true;
    const out: ParsedEvent[] = [];
    const base = (name: string, currency: string | undefined, email: string | undefined) => {
        const cur = String(currency ?? '').toUpperCase().slice(0, 3);
        const plan = inferPlan(name);
        const market: Market | null = cur === 'MXN' ? 'mx' : cur === 'USD' ? 'us' : /\bmx\b/i.test(name) ? 'mx' : /\bus\b/i.test(name) ? 'us' : null;
        return { plan, market, cur, email: normEmail(email) };
    };

    for (const t of txs) {
        if (!usable(t.liveMode) || !t.chargeId) continue;
        const name = t.entitySourceName ?? '';
        const { plan, market, cur, email } = base(name, t.currency, t.contactEmail);
        if (!plan) continue;
        const common = {
            plan, market, email, phone: '', contactId: t.contactId ?? '', subscriptionId: t.subscriptionId ?? '',
            amount: typeof t.amount === 'number' ? t.amount : null, currency: cur, product: name,
        };
        if (t.status === 'succeeded' && within(t.createdAt, PAYMENT_WINDOW_DAYS, now) && !(t.amountRefunded && t.amountRefunded > 0)) {
            out.push({ ...common, key: `payment:${t.chargeId}`, kind: 'payment' });
        }
        // GHL moves a fully refunded charge to `refunded`. Flagged in /admin, not
        // applied: refunding the money and ending the plan are separate decisions.
        if ((t.status === 'succeeded' || t.status === 'refunded') && t.amount && (t.amountRefunded ?? 0) >= t.amount && within(t.createdAt, CHANGE_WINDOW_DAYS, now)) {
            out.push({ ...common, key: `refund_seen:${t.chargeId}`, kind: 'refund_seen' });
        }
    }

    for (const s of subs) {
        if (!usable(s.liveMode) || s.status !== 'canceled' || !s.subscriptionId) continue;
        if (!within(s.updatedAt, CHANGE_WINDOW_DAYS, now)) continue;
        const name = s.recurringProduct?.product?.name || s.entitySourceName || '';
        const { plan, market, cur, email } = base(`${name} ${s.entitySourceName ?? ''}`, s.currency, s.contactEmail);
        if (!plan) continue;
        out.push({
            key: `canceled:${s.subscriptionId}`, kind: 'canceled', plan, market, email, phone: '',
            contactId: s.contactId ?? '', subscriptionId: s.subscriptionId,
            amount: typeof s.amount === 'number' ? s.amount : null, currency: cur, product: name,
        });
    }
    return out;
}

async function ghlGet<T>(cfg: Cfg, path: string): Promise<T> {
    const r = await fetch(`${GHL_BASE}${path}`, {
        headers: { Authorization: `Bearer ${cfg.readPit}`, Version: '2021-07-28', Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`GET ${path.split('?')[0]} ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    return (await r.json()) as T;
}

/** Up to `pages` x 100 most recent records of a GHL payments list. */
async function ghlList<T>(cfg: Cfg, resource: 'transactions' | 'subscriptions', pages = 5): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 0; page < pages; page++) {
        const r = await ghlGet<{ data?: T[] }>(
            cfg, `/payments/${resource}?altId=${cfg.locationId}&altType=location&limit=100&offset=${page * 100}`);
        const batch = r.data ?? [];
        rows.push(...batch);
        if (batch.length < 100) break;
    }
    return rows;
}

/** Test-mode GHL records only count while this is deliberately switched on. */
const acceptTest = () => process.env.BILLING_ACCEPT_TEST_MODE === '1';

interface PollSummary {
    seen: number;
    applied: number;
    already: number;
    unmatched: number;
    error: string | null;
    /** Subscriptions this run changed, so the caller can announce and mirror them. */
    changed: { subscriptionId: string; kind: Kind | StripeKind }[];
}

const emptySummary = (): PollSummary => ({ seen: 0, applied: 0, already: 0, unmatched: 0, error: null, changed: [] });

/** Feeds GHL-derived events through the database function and tallies what happened. */
async function applyAll(cfg: Cfg, events: ParsedEvent[], s: PollSummary, source: string): Promise<void> {
    s.seen += events.length;
    const needsHelp: string[] = [];
    const refunds: string[] = [];
    for (const ev of events) {
        try {
            const r = await applyEvent(cfg, ev);
            if (r.outcome === 'duplicate' || r.outcome === 'duplicate_period') s.already++;
            else if (r.outcome === 'unmatched' || r.outcome === 'ambiguous') {
                s.unmatched++;
                needsHelp.push(`${ev.kind} ${ev.plan} (${ev.market ?? '?'}): ${ev.email || ev.contactId} - ${r.detail ?? r.outcome}`);
            } else {
                s.applied++;
                if (r.outcome === 'applied' && r.subscription_id) s.changed.push({ subscriptionId: r.subscription_id, kind: ev.kind });
                if (ev.kind === 'refund_seen') refunds.push(`${ev.plan} (${ev.market ?? '?'}): ${ev.email || ev.contactId}`);
            }
        } catch (e) {
            s.error = String(e instanceof Error ? e.message : e).slice(0, 300);
            console.error(`billing: ${source} apply failed`, s.error);
        }
    }
    if (needsHelp.length > 0) {
        await alertTeam('MedSociety payments found in GHL need a listing attached', [
            ...needsHelp,
            `Attach them in ${SITE}/admin → Billing. The next payments from the same person then match by themselves.`,
        ]);
    }
    if (refunds.length > 0) {
        await alertTeam('MedSociety refund found in GHL: the plan is still on', [
            ...refunds,
            `If the plan should stop now, end it in ${SITE}/admin → Billing.`,
        ]);
    }
}

async function pollGhl(cfg: Cfg): Promise<PollSummary> {
    const s = emptySummary();
    if (!cfg.readPit) {
        s.error = 'no GHL token for reading payments (GHL_PIT_READONLY)';
        return s;
    }
    let events: ParsedEvent[];
    try {
        const [txs, subs] = await Promise.all([
            ghlList<GhlTransaction>(cfg, 'transactions'),
            ghlList<GhlSubscription>(cfg, 'subscriptions'),
        ]);
        events = eventsFromGhl(txs, subs, new Date(), { acceptTest: acceptTest() });
    } catch (e) {
        s.error = String(e instanceof Error ? e.message : e).slice(0, 300);
        console.error('billing: ghl poll failed', s.error);
        return s;
    }
    await applyAll(cfg, events, s, 'poll');
    return s;
}

// ── Sync ping: "something changed on this contact" ───────────────────────────
// A GHL workflow on a tag change (or a payment) sends `event: sync` with the
// contact. The payload is only a pointer: the site reads that contact's real
// payment records from GHL and acts on those, so nothing in the ping can grant
// a plan by itself.

const SYNC_EVENTS = /^(sync|check|tag|tag_?added|tag_?removed|tag_?changed|contact_?updated)$/;

export function isSyncPing(body: unknown): boolean {
    return SYNC_EVENTS.test(pick(body, ['event', 'eventType', 'billingEvent']).toLowerCase().replace(/[\s-]+/g, '_'));
}

async function findContactByEmail(cfg: Cfg, email: string): Promise<string> {
    const r = await ghlGet<{ contacts?: { id: string; email?: string }[] }>(
        cfg, `/contacts/?locationId=${cfg.locationId}&query=${encodeURIComponent(email)}&limit=10`);
    return (r.contacts ?? []).find((c) => normEmail(c.email) === email)?.id ?? '';
}

async function syncContact(cfg: Cfg, contactId: string): Promise<PollSummary> {
    const s = emptySummary();
    if (!cfg.readPit) {
        s.error = 'no GHL token for reading payments (GHL_PIT_READONLY)';
        return s;
    }
    try {
        const q = `altId=${cfg.locationId}&altType=location&limit=100&contactId=${encodeURIComponent(contactId)}`;
        const [txs, subs] = await Promise.all([
            ghlGet<{ data?: GhlTransaction[] }>(cfg, `/payments/transactions?${q}`),
            ghlGet<{ data?: GhlSubscription[] }>(cfg, `/payments/subscriptions?${q}`),
        ]);
        await applyAll(cfg, eventsFromGhl(txs.data ?? [], subs.data ?? [], new Date(), { acceptTest: acceptTest() }), s, 'contact sync');
    } catch (e) {
        s.error = String(e instanceof Error ? e.message : e).slice(0, 300);
        console.error('billing: contact sync failed', s.error);
    }
    return s;
}

/** One line to the team for every plan that switches on, is cancelled, refunded or lapses. */
async function announce(row: PendingRow, what: 'activated' | 'cancelled' | 'refunded' | 'lapsed'): Promise<void> {
    const plan = row.plan === 'featured' ? 'Featured' : 'Promoted';
    await alertTeam(`MedSociety: ${plan} plan ${what} for ${row.provider_name}`, [
        `${plan}${row.market ? ` (${row.market.toUpperCase()})` : ''} ${what}: ${row.provider_name}`,
        `Payer: ${row.payer_email ?? 'unknown'}${row.ghl_contact_id ? ` · GHL contact ${row.ghl_contact_id}` : ''}`,
        row.paid_through ? `Paid through ${row.paid_through.slice(0, 10)}` : 'No end date',
        `${SITE}/providers/${row.provider_id}`,
    ]);
}

const WHAT: Record<Kind | StripeKind, 'activated' | 'cancelled' | 'refunded' | 'lapsed'> = {
    payment: 'activated', canceled: 'cancelled', refunded: 'refunded', failed: 'lapsed', refund_seen: 'refunded', resumed: 'activated',
};

/**
 * Server-side PostHog event, so revenue and leads are counted even when the
 * browser blocked or never sent its own. Fire-and-forget with a short timeout:
 * analytics must never delay or fail a webhook. No-op without the key.
 */
async function capture(event: string, distinctId: string, properties: Record<string, unknown>): Promise<void> {
    const key = process.env.VITE_POSTHOG_KEY ?? process.env.POSTHOG_KEY;
    if (!key) return;
    const host = (process.env.VITE_POSTHOG_HOST ?? process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com').replace(/\/$/, '');
    try {
        await fetch(`${host}/capture/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key: key, event, distinct_id: distinctId, properties: { ...properties, source: 'server' } }),
            signal: AbortSignal.timeout(2000),
        });
    } catch { /* never surface an analytics failure */ }
}

async function webhook(req: Req, res: Res, url: URL) {
    const secret = process.env.BILLING_WEBHOOK_SECRET ?? '';
    const header = req.headers['x-webhook-secret'];
    // The query form exists for GHL setups that cannot set headers; it ends up in
    // access logs, so prefer the header.
    const given = (Array.isArray(header) ? header[0] : header) || url.searchParams.get('secret') || '';
    if (!secretMatches(given, secret)) return res.status(401).json({ ok: false, error: 'unauthorized' });

    const cfg = settings();
    if (!cfg) {
        console.error('billing: Supabase URL or service role key missing');
        return res.status(500).json({ ok: false, error: 'not_configured' });
    }

    const body = await readBody(req);

    if (isSyncPing(body)) {
        let contactId = pick(body, ['contactId']) || (() => {
            const n = (body as { contact?: { id?: unknown } }).contact?.id;
            return typeof n === 'string' ? n.trim() : '';
        })();
        try {
            if (!contactId) {
                const email = normEmail(pick(body, ['email', 'contactEmail']));
                if (email) contactId = await findContactByEmail(cfg, email);
            }
        } catch (e) {
            console.error('billing: contact lookup failed', String(e).slice(0, 200));
        }
        if (!contactId) return res.status(400).json({ ok: false, error: 'no_contact' });

        const s = await syncContact(cfg, contactId);
        // Mirror and announce whatever this contact's payments changed.
        let mirrored = 0;
        if (s.changed.length > 0) {
            try {
                const pending = await rpc<PendingRow[]>(cfg, 'billing_pending_ghl', { lim: 50 });
                for (const c of s.changed) {
                    const row = pending.find((p) => p.id === c.subscriptionId);
                    if (!row) continue;
                    if (await syncRow(cfg, row)) mirrored++;
                    await announce(row, WHAT[c.kind]);
                }
            } catch (e) {
                console.error('billing: ping mirror failed', String(e).slice(0, 200));
            }
        }
        // 502 when GHL itself could not be read, so GHL's retry policy gets another go.
        if (s.error && s.applied === 0 && s.already === 0) return res.status(502).json({ ok: false, error: 'sync_failed' });
        return res.status(200).json({ ok: true, mode: 'sync', seen: s.seen, applied: s.applied, already: s.already, unmatched: s.unmatched, ghl_synced: mirrored });
    }

    const parsed = parseEvent(body);
    if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });
    const ev = parsed.ev;

    let result: ApplyResult;
    try {
        result = await applyEvent(cfg, ev);
    } catch (e) {
        // Nothing was recorded (the insert and the decision are one call), so a
        // retry from GHL is safe and is what we want.
        console.error('billing: apply failed', String(e).slice(0, 300));
        await alertTeam('Payment webhook failed', [String(e).slice(0, 300), `${ev.kind} ${ev.plan ?? '?'} ${ev.email || ev.phone}`]);
        return res.status(500).json({ ok: false, error: 'apply_failed' });
    }

    if (result.outcome !== 'duplicate') {
        await capture(`billing_${ev.kind}`, `clinic:${result.provider_id ?? 'unmatched'}`, {
            plan: ev.plan, market: ev.market, amount: ev.amount, currency: ev.currency,
            outcome: result.outcome, tier: result.tier ?? null, provider_id: result.provider_id ?? null,
            $groups: result.provider_id ? { clinic: result.provider_id } : undefined,
        });
    }

    // Mirror into GHL. Best effort: a failure leaves the row marked dirty and the cron retries it.
    let synced: boolean | null = null;
    if (result.subscription_id && result.outcome !== 'duplicate') {
        try {
            const pending = await rpc<PendingRow[]>(cfg, 'billing_pending_ghl', { lim: 50 });
            const mine = pending.find((p) => p.id === result.subscription_id);
            if (mine) {
                synced = await syncRow(cfg, mine);
                if (result.outcome === 'applied') await announce(mine, WHAT[ev.kind]);
            }
        } catch (e) {
            console.error('billing: pending fetch failed', String(e).slice(0, 200));
        }
    }

    if (result.outcome === 'unmatched' || result.outcome === 'ambiguous') {
        // Mark the contact in GHL too, so the team sees it where they already work.
        if (cfg.pit && ev.contactId) {
            await ghl(cfg, 'POST', `/contacts/${ev.contactId}/tags`, { tags: ['medsociety-payment-unmatched'] }).catch(() => undefined);
        }
        await alertTeam('A MedSociety payment needs a listing attached', [
            `${ev.kind} for ${ev.plan ?? 'unknown plan'} (${ev.market ?? 'unknown market'}): ${result.detail ?? result.outcome}`,
            `Payer: ${ev.email || '(no email)'} ${ev.phone || ''} ${ev.contactId ? `GHL contact ${ev.contactId}` : ''}`.trim(),
            `Attach it in ${SITE}/admin → Billing. The next payments from this person then match by themselves.`,
        ]);
    }

    return res.status(200).json({ ok: true, outcome: result.outcome, tier: result.tier ?? null, ghl_synced: synced });
}

async function sync(req: Req, res: Res) {
    const secret = process.env.CRON_SECRET ?? '';
    const auth = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!secretMatches(auth, secret)) return res.status(401).json({ error: 'Unauthorized' });

    const cfg = settings();
    if (!cfg) return res.status(500).json({ error: 'not_configured' });

    try {
        // 1. Anything GHL has that the webhook did not deliver. 2. Let unpaid plans run out.
        // 3. Push every state change into GHL. In that order, so step 3 sees steps 1 and 2.
        const poll = await pollGhl(cfg);
        const sk = stripeSettings();
        const stripePoll = sk ? await pollStripe(cfg, sk) : null;
        if (stripePoll) poll.changed.push(...stripePoll.changed);
        const lapsed = await rpc<{ provider_id: string; plan: string }[] | null>(cfg, 'billing_expire', {});
        const pending = (await rpc<PendingRow[] | null>(cfg, 'billing_pending_ghl', { lim: 100 })) ?? [];
        // Announce only what changed in THIS run, not rows that are merely waiting on a GHL retry.
        const changedNow = new Map(poll.changed.map((c) => [c.subscriptionId, c.kind]));
        const lapsedNow = new Set((lapsed ?? []).map((l) => `${l.provider_id}:${l.plan}`));
        for (const row of pending) {
            const kind = changedNow.get(row.id);
            if (kind) await announce(row, WHAT[kind]);
            else if (lapsedNow.has(`${row.provider_id}:${row.plan}`)) await announce(row, 'lapsed');
        }
        let ok = 0;
        let failed = 0;
        for (const row of pending) {
            if (await syncRow(cfg, row)) ok++;
            else failed++;
        }

        if (failed > 0) {
            await alertTeam('MedSociety → GHL sync is failing', [
                `${failed} subscription(s) could not be written to GHL; they will be retried tomorrow.`,
                `See ${SITE}/admin → Billing for the error on each.`,
            ]);
        }
        if (stripePoll?.error) {
            await alertTeam('MedSociety could not read subscriptions from Stripe', [
                stripePoll.error,
                'The webhook still works; only the daily cross-check is down.',
            ]);
        }
        if (poll.error) {
            await alertTeam('MedSociety could not read payments from GHL', [
                poll.error,
                'The webhook still works; only the daily cross-check is down.',
            ]);
        }
        return res.status(200).json({ ok: true, poll, stripe: stripePoll, lapsed: lapsed?.length ?? 0, ghl_synced: ok, ghl_failed: failed });
    } catch (e) {
        console.error('billing: sync job failed', String(e).slice(0, 300));
        return res.status(500).json({ ok: false, error: 'sync_failed' });
    }
}

// ── Stripe ───────────────────────────────────────────────────────────────────
//
// Payments are taken by Stripe: Checkout to buy, the customer portal to switch
// plan, update the card or cancel. One Stripe customer per listing. The plan and
// market come from the subscription's current price, identified by its Stripe
// `lookup_key` (promoted_us_monthly, promoted_mx_monthly, featured_us_monthly,
// featured_mx_monthly), so changing an amount never needs a code change. The
// listing travels with the checkout in the subscription's metadata, so a payment
// is never matched by guessing an email.
//
//   POST /api/billing?job=stripe-checkout   signed-in owner → Checkout URL
//   POST /api/billing?job=stripe-portal     signed-in owner → customer portal URL
//   POST /api/billing?job=stripe            Stripe webhook (see below)
//
// Webhook authenticity: the endpoint only reads the event's id from the request
// and then fetches that event from Stripe with the secret key. What Stripe
// returns is what we act on, so nothing in the request can forge a payment. (This
// is why no signing secret or raw request body is needed.) Events from the other
// mode (test vs live) than the key in use are ignored.
//
// Env: STRIPE_SECRET_KEY (sk_test_… on Preview, sk_live_… on Production),
//      optional STRIPE_PORTAL_CONFIG (bpc_…) to pick a portal configuration.

export type StripeKind = 'payment' | 'canceled' | 'resumed' | 'failed' | 'refund_seen';

const STRIPE_API = 'https://api.stripe.com/v1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOOKUP_KEY = /^(promoted|featured)_(us|mx)_monthly$/;

export const priceLookupKey = (plan: Plan, market: Market) => `${plan}_${market}_monthly`;

export function planFromLookupKey(key: string | null | undefined): { plan: Plan; market: Market } | null {
    const m = LOOKUP_KEY.exec(key ?? '');
    return m ? { plan: m[1] as Plan, market: m[2] as Market } : null;
}

export interface StripeCfg {
    key: string;
    /** True for a live-mode key. Events from the other mode are ignored. */
    live: boolean;
}

export function stripeSettings(): StripeCfg | null {
    const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
    if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]+$/.test(key)) return null;
    return { key, live: /^(sk|rk)_live_/.test(key) };
}

/** Stripe's form encoding: nested objects as a[b], lists as a[0]. */
export function formEncode(obj: Record<string, unknown>): string {
    const out: string[] = [];
    const walk = (prefix: string, v: unknown) => {
        if (v === undefined || v === null) return;
        if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
        else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(`${prefix}[${k}]`, x);
        else out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(String(v))}`);
    };
    for (const [k, v] of Object.entries(obj)) walk(k, v);
    return out.join('&');
}

async function stripe<T>(sk: StripeCfg, method: 'GET' | 'POST', path: string, params?: Record<string, unknown>): Promise<T> {
    const qs = params ? formEncode(params) : '';
    const r = await fetch(`${STRIPE_API}${path}${method === 'GET' && qs ? `?${qs}` : ''}`, {
        method,
        headers: {
            Authorization: `Bearer ${sk.key}`,
            ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: method === 'POST' ? qs : undefined,
        signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`stripe ${method} ${path} ${r.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
}

interface StripePrice { id: string; lookup_key?: string | null }
interface StripeInvoice {
    id: string;
    status?: string;
    customer_email?: string | null;
    amount_paid?: number;
    currency?: string;
    subscription?: string | null;
    parent?: { subscription_details?: { subscription?: string | null } } | null;
}
interface StripeSub {
    id: string;
    status: string;
    customer: string | { id: string };
    cancel_at_period_end?: boolean;
    /** Newer API versions record a scheduled cancel here (a date) instead of cancel_at_period_end. */
    cancel_at?: number | null;
    ended_at?: number | null;
    current_period_end?: number;
    metadata?: Record<string, string>;
    items?: { data: { current_period_end?: number; price?: StripePrice }[] };
    latest_invoice?: StripeInvoice | string | null;
}
interface StripeCharge { id: string; amount?: number; amount_refunded?: number; currency?: string; invoice?: string | null; payment_intent?: string | null }
export interface StripeEvent {
    id: string;
    type: string;
    livemode: boolean;
    data: { object: Record<string, unknown>; previous_attributes?: Record<string, unknown> };
}

/** The API moved the subscription id and period end between versions; read both places. */
const invoiceSubscriptionId = (inv: StripeInvoice) => inv.subscription || inv.parent?.subscription_details?.subscription || '';
const subPeriodEnd = (s: StripeSub) => s.current_period_end ?? s.items?.data?.[0]?.current_period_end ?? null;
const isoFromUnix = (n: number | null) => (n ? new Date(n * 1000).toISOString() : null);
/** When a subscription is set to end (either way Stripe records it), else null. */
const scheduledEnd = (s: StripeSub): number | null =>
    s.cancel_at_period_end === true ? subPeriodEnd(s) ?? s.cancel_at ?? null : s.cancel_at ?? null;
const customerId = (s: StripeSub) => (typeof s.customer === 'string' ? s.customer : s.customer?.id ?? '');

export interface StripeApply {
    key: string;
    kind: StripeKind;
    providerId: string | null;
    plan: Plan | null;
    market: Market | null;
    email: string;
    customerId: string;
    subscriptionId: string;
    priceId: string;
    amount: number | null;
    currency: string;
    periodEnd: string | null;
}

/** What a subscription says about itself: its listing, plan, market and period. Null when it is not one of our plans. */
function fromSubscription(sub: StripeSub): Omit<StripeApply, 'key' | 'kind' | 'email' | 'amount' | 'currency'> | null {
    const price = sub.items?.data?.[0]?.price;
    const m = planFromLookupKey(price?.lookup_key);
    if (!price || !m) return null;
    const pid = sub.metadata?.provider_id ?? '';
    return {
        providerId: UUID_RE.test(pid) ? pid : null,
        plan: m.plan, market: m.market,
        customerId: customerId(sub), subscriptionId: sub.id, priceId: price.id,
        periodEnd: isoFromUnix(subPeriodEnd(sub)),
    };
}

function paymentFrom(inv: StripeInvoice, sub: StripeSub): StripeApply | null {
    const base = fromSubscription(sub);
    if (!base) return null;
    return {
        ...base,
        key: `stripe:invoice:${inv.id}`,
        kind: 'payment',
        email: normEmail(inv.customer_email),
        amount: typeof inv.amount_paid === 'number' ? inv.amount_paid / 100 : null,
        currency: String(inv.currency ?? '').toUpperCase().slice(0, 3),
    };
}

/**
 * Turns one Stripe event into the call for the database, or null when it is not
 * about one of our plans. The plan always comes from the subscription's current
 * price, never from an invoice line (a prorated upgrade invoice carries both).
 */
export async function stripeToApply(sk: StripeCfg, evt: StripeEvent): Promise<StripeApply | null> {
    const key = `stripe:evt:${evt.id}`;
    const obj = evt.data.object;
    const none = { providerId: null, plan: null, market: null, customerId: '', priceId: '', periodEnd: null, email: '', amount: null, currency: '' };

    switch (evt.type) {
        case 'invoice.paid': {
            const inv = obj as unknown as StripeInvoice;
            const subId = invoiceSubscriptionId(inv);
            if (!subId) return null;
            return paymentFrom(inv, await stripe<StripeSub>(sk, 'GET', `/subscriptions/${subId}`));
        }
        case 'customer.subscription.updated': {
            // Events are neither ordered nor promptly retried: act on the subscription as it is
            // now, not on the snapshot, so a late "cancel" can never undo a newer "don't cancel".
            const snap = obj as unknown as StripeSub;
            if (!fromSubscription(snap)) return null;
            const sub = await stripe<StripeSub>(sk, 'GET', `/subscriptions/${snap.id}`);
            const base = fromSubscription(sub);
            if (!base || sub.status === 'canceled') return null;
            const prev = evt.data.previous_attributes ?? {};
            const end = scheduledEnd(sub);
            if (end) return { ...base, key, kind: 'canceled', periodEnd: isoFromUnix(end), email: '', amount: null, currency: '' };
            const wasScheduled = prev.cancel_at_period_end === true || (typeof prev.cancel_at === 'number' && prev.cancel_at > 0);
            if (wasScheduled) return { ...base, key, kind: 'resumed', email: '', amount: null, currency: '' };
            return null; // a price change is applied when its invoice is paid
        }
        case 'customer.subscription.deleted': {
            const sub = obj as unknown as StripeSub;
            const base = fromSubscription(sub);
            // The paid time stays (null period end): a cancel keeps what was paid for.
            return base ? { ...base, key, kind: 'canceled', periodEnd: null, email: '', amount: null, currency: '' } : null;
        }
        case 'invoice.payment_failed': {
            const subId = invoiceSubscriptionId(obj as unknown as StripeInvoice);
            return subId ? { ...none, key, kind: 'failed', subscriptionId: subId } : null;
        }
        case 'charge.refunded': {
            const ch = obj as unknown as StripeCharge;
            if (!ch.amount || (ch.amount_refunded ?? 0) < ch.amount) return null; // partial refunds are not the plan's end
            // Older API versions put the invoice on the charge; newer ones link it through an invoice payment.
            let invoiceId = ch.invoice ?? '';
            if (!invoiceId && ch.payment_intent) {
                const ip = await stripe<{ data: { invoice?: string | null }[] }>(sk, 'GET', '/invoice_payments', {
                    payment: { type: 'payment_intent', payment_intent: ch.payment_intent }, limit: 1,
                });
                invoiceId = ip.data[0]?.invoice ?? '';
            }
            if (!invoiceId) return null;
            const subId = invoiceSubscriptionId(await stripe<StripeInvoice>(sk, 'GET', `/invoices/${invoiceId}`));
            return subId ? { ...none, key, kind: 'refund_seen', subscriptionId: subId, amount: ch.amount / 100, currency: String(ch.currency ?? '').toUpperCase() } : null;
        }
        default:
            return null;
    }
}

function applyStripe(cfg: Cfg, a: StripeApply): Promise<ApplyResult> {
    return rpc<ApplyResult>(cfg, 'apply_stripe_event', {
        p_event_key: a.key, p_kind: a.kind, p_provider: a.providerId, p_plan: a.plan, p_market: a.market,
        p_email: a.email, p_customer_id: a.customerId, p_subscription_id: a.subscriptionId, p_price_id: a.priceId,
        p_amount: a.amount, p_currency: a.currency, p_period_end: a.periodEnd,
    });
}

async function stripeWebhook(req: Req, res: Res) {
    const sk = stripeSettings();
    const cfg = settings();
    if (!sk || !cfg) {
        console.error('billing: stripe webhook not configured', { stripeKey: Boolean(sk), supabase: Boolean(cfg) });
        return res.status(500).json({ ok: false, error: 'not_configured' });
    }

    const body = (await readBody(req)) as { id?: unknown } | null;
    const id = typeof body?.id === 'string' && /^evt_[A-Za-z0-9_]{6,}$/.test(body.id) ? body.id : '';
    if (!id) return res.status(400).json({ ok: false, error: 'bad_event' });

    // Authenticate by asking Stripe for the event itself.
    let evt: StripeEvent;
    try {
        evt = await stripe<StripeEvent>(sk, 'GET', `/events/${id}`);
    } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        if (/ 404:/.test(msg)) return res.status(401).json({ ok: false, error: 'unknown_event' });
        console.error('billing: stripe event fetch failed', msg.slice(0, 200));
        return res.status(502).json({ ok: false, error: 'stripe_unreachable' }); // Stripe retries
    }
    if (evt.livemode !== sk.live) return res.status(200).json({ ok: true, ignored: 'other_mode' });

    let a: StripeApply | null;
    try {
        a = await stripeToApply(sk, evt);
    } catch (e) {
        console.error('billing: stripe event mapping failed', String(e).slice(0, 200));
        return res.status(502).json({ ok: false, error: 'stripe_unreachable' });
    }
    if (!a) {
        console.info('billing: stripe event ignored', evt.type, evt.id);
        return res.status(200).json({ ok: true, ignored: evt.type });
    }

    let result: ApplyResult;
    try {
        result = await applyStripe(cfg, a);
    } catch (e) {
        console.error('billing: stripe apply failed', String(e).slice(0, 300));
        await alertTeam('Stripe payment webhook failed', [String(e).slice(0, 300), `${evt.type} ${evt.id}`]);
        return res.status(500).json({ ok: false, error: 'apply_failed' });
    }
    if (result.outcome === 'duplicate') return res.status(200).json({ ok: true, outcome: 'duplicate' });

    await capture(`billing_${a.kind}`, `clinic:${result.provider_id ?? 'unmatched'}`, {
        plan: a.plan, market: a.market, amount: a.amount, currency: a.currency, outcome: result.outcome,
        tier: result.tier ?? null, provider_id: result.provider_id ?? null, processor: 'stripe',
        $groups: result.provider_id ? { clinic: result.provider_id } : undefined,
    });

    // Mirror into GHL (tags, note, site set-up email). A failure leaves the row dirty for the daily run.
    let synced: boolean | null = null;
    if (result.subscription_id) {
        try {
            const pending = await rpc<PendingRow[]>(cfg, 'billing_pending_ghl', { lim: 50 });
            const mine = pending.find((p) => p.id === result.subscription_id);
            if (mine) {
                synced = await syncRow(cfg, mine);
                if (result.outcome === 'applied') await announce(mine, WHAT[a.kind]);
            }
        } catch (e) {
            console.error('billing: pending fetch failed', String(e).slice(0, 200));
        }
    }

    // Only a payment with nowhere to go needs a person; a stray cancel or refund is just logged.
    if (result.outcome === 'unmatched' && a.kind === 'payment') {
        await alertTeam('A Stripe payment needs a listing attached', [
            `${a.plan ?? 'unknown plan'} (${a.market ?? 'unknown market'}) ${a.amount ?? ''} ${a.currency}: ${result.detail ?? result.outcome}`,
            `Customer ${a.customerId} · subscription ${a.subscriptionId} · ${a.email || '(no email)'}`,
            `Attach it in ${SITE}/admin → Billing.`,
        ]);
    }
    return res.status(200).json({ ok: true, outcome: result.outcome, tier: result.tier ?? null, ghl_synced: synced });
}

// ── Checkout and portal (signed-in owners) ───────────────────────────────────

async function sessionUser(cfg: Cfg, header: string | string[] | undefined): Promise<{ id: string; email: string } | null> {
    const raw = Array.isArray(header) ? header[0] : header;
    const m = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/.exec((raw ?? '').trim());
    if (!m) return null;
    try {
        const apikey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? cfg.supaKey;
        const r = await fetch(`${cfg.supaUrl}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${m[1]}` } });
        if (!r.ok) return null;
        const u = (await r.json()) as { id?: unknown; email?: unknown; is_anonymous?: unknown };
        if (typeof u.id !== 'string' || !UUID_RE.test(u.id) || u.is_anonymous === true) return null;
        return { id: u.id, email: typeof u.email === 'string' ? u.email : '' };
    } catch {
        return null;
    }
}

/** Billing is the owner's: staff (front desk) cannot buy, switch, cancel or see invoices on the owner's card. */
async function ownsListing(cfg: Cfg, userId: string, providerId: string): Promise<boolean> {
    const r = await supa(cfg, 'GET', `provider_owners?select=role&provider_id=eq.${providerId}&user_id=eq.${userId}&role=eq.owner&limit=1`);
    return r.ok && Array.isArray(r.json) && r.json.length > 0;
}

interface SubRow { plan: string; status: string; paid_through: string | null; stripe_customer_id: string | null; stripe_subscription_id: string | null }

async function listingSubs(cfg: Cfg, providerId: string): Promise<SubRow[]> {
    const r = await supa(cfg, 'GET', `provider_subscriptions?select=plan,status,paid_through,stripe_customer_id,stripe_subscription_id&provider_id=eq.${providerId}&order=updated_at.desc`);
    return r.ok && Array.isArray(r.json) ? (r.json as SubRow[]) : [];
}

/**
 * A customer id stored for a listing can belong to the other Stripe mode (previews
 * share the production database) or have been deleted. Only a customer the current
 * key can see counts.
 */
async function liveCustomer(sk: StripeCfg, id: string | null | undefined): Promise<string> {
    if (!id) return '';
    try {
        const c = await stripe<{ id: string; deleted?: boolean }>(sk, 'GET', `/customers/${id}`);
        return c.deleted ? '' : c.id;
    } catch (e) {
        if (/ 404:/.test(String(e))) return '';
        throw e;
    }
}

async function ownerRequest(req: Req, res: Res): Promise<{ cfg: Cfg; sk: StripeCfg; user: { id: string; email: string }; body: Record<string, unknown> } | null> {
    const sk = stripeSettings();
    const cfg = settings();
    if (!sk || !cfg) {
        // Names only, never values: which setting is missing on this deployment.
        console.error('billing: stripe checkout/portal not configured', { stripeKey: Boolean(sk), supabase: Boolean(cfg) });
        res.status(500).json({ ok: false, error: 'not_configured' });
        return null;
    }
    const user = await sessionUser(cfg, req.headers.authorization);
    if (!user) { res.status(401).json({ ok: false, error: 'unauthorized' }); return null; }
    const body = ((await readBody(req)) ?? {}) as Record<string, unknown>;
    const providerId = typeof body.provider_id === 'string' ? body.provider_id : '';
    if (!UUID_RE.test(providerId)) { res.status(400).json({ ok: false, error: 'bad_provider' }); return null; }
    if (!(await ownsListing(cfg, user.id, providerId))) { res.status(403).json({ ok: false, error: 'not_your_listing' }); return null; }
    return { cfg, sk, user, body };
}

/**
 * Where Stripe sends the owner back: the site they came from when it is one of
 * ours (production, this project's Vercel previews, local dev), else production.
 * Never an arbitrary origin, so a crafted request cannot turn Stripe into a redirect.
 */
export function returnBase(origin: string | string[] | undefined): string {
    const raw = (Array.isArray(origin) ? origin[0] : origin) ?? '';
    try {
        const u = new URL(raw);
        const host = u.hostname;
        const site = new URL(SITE).hostname.replace(/^www\./, '');
        const ours = (u.protocol === 'https:' && (host === site || host === `www.${site}`
            || /^medsociety-marketplace-[a-z0-9-]+-dropdevs-projects-25301cf7\.vercel\.app$/.test(host)))
            || (u.protocol === 'http:' && host === 'localhost');
        if (ours) return u.origin;
    } catch { /* not a URL */ }
    return SITE;
}

async function stripeCheckout(req: Req, res: Res) {
    const ctx = await ownerRequest(req, res);
    if (!ctx) return;
    const { cfg, sk, user, body } = ctx;
    const providerId = String(body.provider_id);
    const plan = body.plan === 'promoted' || body.plan === 'featured' ? body.plan : null;
    const market = body.market === 'us' || body.market === 'mx' ? body.market : null;
    if (!plan || !market) return res.status(400).json({ ok: false, error: 'bad_plan' });

    try {
        const subs = await listingSubs(cfg, providerId);
        // A listing that already pays changes plan in the portal; a second subscription would double-bill.
        if (subs.some((s) => (s.status === 'active' || s.status === 'canceled') && s.paid_through && Date.parse(s.paid_through) > Date.now())) {
            return res.status(409).json({ ok: false, error: 'already_subscribed' });
        }

        const prices = await stripe<{ data: StripePrice[] }>(sk, 'GET', '/prices', { 'lookup_keys': [priceLookupKey(plan, market)], active: true, limit: 1 });
        const price = prices.data[0];
        if (!price) return res.status(500).json({ ok: false, error: 'price_missing' });

        // One Stripe customer per listing: reuse it, else look one up, else create it.
        let customer = await liveCustomer(sk, subs.find((s) => s.stripe_customer_id)?.stripe_customer_id);
        if (!customer) {
            const found = await stripe<{ data: { id: string }[] }>(sk, 'GET', '/customers/search', { query: `metadata['provider_id']:'${providerId}'`, limit: 1 });
            customer = found.data[0]?.id ?? '';
        }
        // Stripe is the truth on whether this customer still has a subscription: ours can show a
        // plan as lapsed while Stripe is still retrying its last charge. A second one would double-bill.
        if (customer) {
            const open = await stripe<{ data: { status: string }[] }>(sk, 'GET', '/subscriptions', { customer, status: 'all', limit: 20 });
            if (open.data.some((x) => !['canceled', 'incomplete', 'incomplete_expired'].includes(x.status))) {
                return res.status(409).json({ ok: false, error: 'already_subscribed' });
            }
        }
        if (!customer) {
            const name = await supa(cfg, 'GET', `providers?select=name&id=eq.${providerId}&limit=1`);
            const clinic = Array.isArray(name.json) ? (name.json as { name?: string }[])[0]?.name : undefined;
            const made = await stripe<{ id: string }>(sk, 'POST', '/customers', {
                email: user.email || undefined, name: clinic || undefined, metadata: { provider_id: providerId },
            });
            customer = made.id;
        }

        const meta = { provider_id: providerId, plan, market };
        const session = await stripe<{ url?: string }>(sk, 'POST', '/checkout/sessions', {
            mode: 'subscription',
            customer,
            client_reference_id: providerId,
            line_items: [{ price: price.id, quantity: 1 }],
            subscription_data: { metadata: meta },
            metadata: meta,
            success_url: `${returnBase(req.headers.origin)}/dashboard?tab=plan&paid=${plan}`,
            cancel_url: `${returnBase(req.headers.origin)}/dashboard?tab=plan`,
        });
        if (!session.url) throw new Error('no checkout url');
        return res.status(200).json({ ok: true, url: session.url });
    } catch (e) {
        console.error('billing: stripe checkout failed', String(e).slice(0, 300));
        return res.status(502).json({ ok: false, error: 'stripe_failed' });
    }
}

async function stripePortal(req: Req, res: Res) {
    const ctx = await ownerRequest(req, res);
    if (!ctx) return;
    const { cfg, sk, body } = ctx;
    try {
        const customer = await liveCustomer(sk, (await listingSubs(cfg, String(body.provider_id))).find((s) => s.stripe_customer_id)?.stripe_customer_id);
        if (!customer) return res.status(404).json({ ok: false, error: 'no_billing_account' });
        const session = await stripe<{ url?: string }>(sk, 'POST', '/billing_portal/sessions', {
            customer,
            return_url: `${returnBase(req.headers.origin)}/dashboard?tab=plan&portal=1`,
            configuration: process.env.STRIPE_PORTAL_CONFIG || undefined,
        });
        if (!session.url) throw new Error('no portal url');
        return res.status(200).json({ ok: true, url: session.url });
    } catch (e) {
        console.error('billing: stripe portal failed', String(e).slice(0, 300));
        return res.status(502).json({ ok: false, error: 'stripe_failed' });
    }
}

// ── Daily cross-check against Stripe ─────────────────────────────────────────
// Lists every subscription (up to 500) and feeds the facts through the same
// database function. The payment key is the invoice id, the same one the webhook
// uses, so anything already delivered is a no-op and anything missed is applied.

export async function pollStripe(cfg: Cfg, sk: StripeCfg): Promise<PollSummary> {
    const s = emptySummary();
    const subs: StripeSub[] = [];
    try {
        let after = '';
        for (let page = 0; page < 5; page++) {
            const r = await stripe<{ data: StripeSub[]; has_more: boolean }>(sk, 'GET', '/subscriptions', {
                status: 'all', limit: 100, expand: ['data.latest_invoice'], ...(after ? { starting_after: after } : {}),
            });
            subs.push(...r.data);
            if (!r.has_more || r.data.length === 0) break;
            after = r.data[r.data.length - 1].id;
        }
    } catch (e) {
        s.error = String(e instanceof Error ? e.message : e).slice(0, 300);
        console.error('billing: stripe poll failed', s.error);
        return s;
    }

    const events: StripeApply[] = [];
    const longAgo = Date.now() / 1000 - CHANGE_WINDOW_DAYS * 86_400;
    for (const sub of subs) {
        const base = fromSubscription(sub);
        if (!base || !base.providerId) continue; // not made through our checkout
        if (sub.status === 'canceled' && (sub.ended_at ?? 0) < longAgo) continue; // settled long ago: keeps the daily run short
        const inv = typeof sub.latest_invoice === 'object' && sub.latest_invoice ? sub.latest_invoice : null;
        if (inv && inv.status === 'paid') {
            const p = paymentFrom(inv, sub);
            if (p) events.push(p);
        }
        const end = base.periodEnd ?? 'none';
        const blank = { email: '', amount: null, currency: '' };
        if (sub.status === 'canceled') events.push({ ...base, ...blank, key: `stripe:rec:ended:${sub.id}`, kind: 'canceled', periodEnd: null });
        else if (scheduledEnd(sub)) events.push({ ...base, ...blank, key: `stripe:rec:canceled:${sub.id}:${end}`, kind: 'canceled', periodEnd: isoFromUnix(scheduledEnd(sub)) });
        // Not set to end: puts back a plan our records show as cancelled (a missed "don't cancel").
        // A no-op ('noted') for a plan that is already active.
        else if (sub.status === 'active' || sub.status === 'past_due') events.push({ ...base, ...blank, key: `stripe:rec:resumed:${sub.id}:${end}`, kind: 'resumed' });
    }

    s.seen = events.length;
    for (const a of events) {
        try {
            const r = await applyStripe(cfg, a);
            if (r.outcome === 'duplicate') s.already++;
            else if (r.outcome === 'unmatched') s.unmatched++;
            else {
                s.applied++;
                if (r.outcome === 'applied' && r.subscription_id) s.changed.push({ subscriptionId: r.subscription_id, kind: a.kind });
            }
        } catch (e) {
            s.error = String(e instanceof Error ? e.message : e).slice(0, 300);
            console.error('billing: stripe poll apply failed', s.error);
        }
    }
    return s;
}

/** The daily run makes a few dozen sequential calls; the 10 s default is too tight. */
export const config = { maxDuration: 60 };

export default async function handler(req: Req, res: Res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const job = url.searchParams.get('job');
    if (req.method === 'POST' && job === 'stripe') return stripeWebhook(req, res);
    if (req.method === 'POST' && job === 'stripe-checkout') return stripeCheckout(req, res);
    if (req.method === 'POST' && job === 'stripe-portal') return stripePortal(req, res);
    if (req.method === 'POST') return webhook(req, res, url);
    if (req.method === 'GET' && url.searchParams.get('job') === 'sync') return sync(req, res);
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}
