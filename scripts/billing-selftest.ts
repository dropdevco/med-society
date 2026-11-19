/**
 * Checks for api/billing.ts: the GHL webhook edge. Payload parsing, phone and
 * email normalisation, tag computation, auth, and the whole POST path with
 * `fetch` stubbed, so nothing reaches Supabase, GHL or Resend.
 *
 * The matching and plan arithmetic live in Postgres (0029_plan_billing.sql) and
 * are not covered here.
 *
 *   npx tsx scripts/billing-selftest.ts
 */
import handler, { ensureSite, eventsFromGhl, formEncode, planFromLookupKey, returnBase, siteSubdomain, inferPlan, isSyncPing, normEmail, parseEvent, secretMatches, stripeToApply, tagsFor, toE164 } from '../api/billing';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.GHL_PIT_MEDSOCIETY = 'pit';
process.env.GHL_PIT_READONLY = 'pit-read';
process.env.BILLING_WEBHOOK_SECRET = 'hook-secret';
process.env.CRON_SECRET = 'cron-secret';
process.env.RESEND_API_KEY = 'resend-key';
process.env.LEAD_NOTIFY_FROM = 'MedSociety <hi@example.com>';
process.env.LEAD_NOTIFY_TO = 'team@example.com';
process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

// ── stubbed network ─────────────────────────────────────────────────────────
interface Call { url: string; method: string; body: unknown }
let calls: Call[] = [];
let applyReply: unknown = { outcome: 'applied', tier: 'promoted', subscription_id: 'sub-1', provider_id: 'p-1' };
let pendingRows: unknown[] = [];
let ghlTagStatus = 200;
let ghlTransactions: unknown[] = [];
let ghlSubscriptions: unknown[] = [];
let ghlReadFails = false;
let siteRows: { provider_id: string; subdomain: string }[] = [];
let vercelAdd = 200;
let vercelGet = 200;
const USER_ID = '00000000-0000-4000-8000-00000000000a';
const PROVIDER_ID = '10000000-0000-4000-8000-00000000000a';
let stripeEvents: Record<string, unknown> = {};
let stripeSubs: Record<string, unknown> = {};
let stripeInvoices: Record<string, unknown> = {};
let stripeSubList: unknown[] = [];
let stripeCustomerSearch: unknown[] = [];
let stripePriceMissing = false;
let ownerRows: unknown[] = [{ role: 'owner' }];
let subRows: unknown[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null;
    calls.push({ url, method: init?.method ?? 'GET', body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
    if (url.includes('api.stripe.com')) {
        const path = url.replace('https://api.stripe.com/v1', '').split('?')[0];
        const hit = (m: Record<string, unknown>, id: string) => (m[id] ? json(200, m[id]) : json(404, { error: { message: 'No such object' } }));
        if (path.startsWith('/events/')) return hit(stripeEvents, path.slice(8));
        if (path === '/subscriptions') return json(200, { data: stripeSubList, has_more: false });
        if (path.startsWith('/subscriptions/')) return hit(stripeSubs, path.slice(15));
        if (path.startsWith('/invoices/')) return hit(stripeInvoices, path.slice(10));
        if (path === '/prices') return json(200, { data: stripePriceMissing ? [] : [{ id: `price_for_${decodeURIComponent(url).match(/lookup_keys\[0\]=([a-z_]+)/)?.[1]}` }] });
        if (path === '/customers/search') return json(200, { data: stripeCustomerSearch });
        if (path === '/customers') return json(200, { id: 'cus_new' });
        if (path === '/checkout/sessions') return json(200, { url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
        if (path === '/billing_portal/sessions') return json(200, { url: 'https://billing.stripe.com/p/session/x' });
        return json(404, {});
    }
    if (url.includes('/auth/v1/user')) {
        return new Headers(init?.headers).get('Authorization') === 'Bearer good-token' ? json(200, { id: USER_ID, email: 'owner@clinic.com' }) : json(401, {});
    }
    if (url.includes('/rest/v1/provider_owners')) return json(200, ownerRows);
    if (url.includes('/rest/v1/provider_subscriptions')) return json(200, subRows);
    if (url.includes('/rest/v1/providers?')) return json(200, [{ name: 'Clinica Uno' }]);
    if (url.includes('/rpc/apply_stripe_event')) return json(200, applyReply);
    if (url.includes('/rest/v1/doctor_sites')) {
        if (init?.method === 'POST') {
            const b = body as { provider_id: string; subdomain: string };
            if (siteRows.some((r) => r.subdomain === b.subdomain || r.provider_id === b.provider_id)) return json(409, { code: '23505' });
            siteRows.push(b);
            return json(201, [b]);
        }
        const pid = decodeURIComponent(/provider_id=eq\.([^&]+)/.exec(url)?.[1] ?? '');
        return json(200, siteRows.filter((r) => r.provider_id === pid));
    }
    if (url.includes('api.vercel.com') && init?.method === 'POST') return json(vercelAdd, { error: { message: 'x' } });
    if (url.includes('api.vercel.com')) return json(vercelGet, {});
    if (url.includes('/contacts/?locationId')) return json(200, { contacts: [{ id: 'c-found', email: 'Owner@Clinic.com' }] });
    if (ghlReadFails && url.includes('/payments/')) return json(500, {});
    if (url.includes('/payments/transactions')) return json(200, { data: ghlTransactions, totalCount: ghlTransactions.length });
    if (url.includes('/payments/subscriptions')) return json(200, { data: ghlSubscriptions, totalCount: ghlSubscriptions.length });
    if (url.includes('/rpc/apply_billing_event')) return json(200, applyReply);
    if (url.includes('/rpc/billing_pending_ghl')) return json(200, pendingRows);
    if (url.includes('/rpc/billing_expire')) return json(200, [{ provider_id: 'p-9', plan: 'promoted' }]);
    if (url.includes('/rpc/billing_mark_synced')) return json(200, null);
    if (url.includes('/contacts/upsert')) return json(200, { contact: { id: 'ghl-new' } });
    if (url.includes('/tags') && init?.method === 'POST') return json(ghlTagStatus, {});
    if (url.includes('/tags') && init?.method === 'DELETE') return json(200, {});
    if (url.includes('/notes')) return json(200, {});
    if (url.includes('api.resend.com')) return json(200, {});
    return json(404, {});
}) as typeof fetch;

function reset() {
    calls = [];
    applyReply = { outcome: 'applied', tier: 'promoted', subscription_id: 'sub-1', provider_id: 'p-1' };
    pendingRows = [];
    ghlTagStatus = 200;
    ghlTransactions = [];
    ghlSubscriptions = [];
    ghlReadFails = false;
    siteRows = [];
    vercelAdd = 200;
    vercelGet = 200;
    stripeEvents = {};
    stripeSubs = {};
    stripeInvoices = {};
    stripeSubList = [];
    stripeCustomerSearch = [];
    stripePriceMissing = false;
    ownerRows = [{ role: 'owner' }];
    subRows = [];
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
    delete process.env.BILLING_ACCEPT_TEST_MODE;
}

interface Reply { code: number; body: Record<string, unknown> }
async function run(opts: { method?: string; url?: string; headers?: Record<string, string>; body?: unknown }): Promise<Reply> {
    let code = 200;
    let out: Record<string, unknown> = {};
    const res = {
        setHeader() { /* not needed */ },
        status(c: number) { code = c; return res; },
        json(b: unknown) { out = b as Record<string, unknown>; },
    };
    const req = {
        method: opts.method ?? 'POST',
        url: opts.url ?? '/api/billing',
        headers: opts.headers ?? { 'x-webhook-secret': 'hook-secret' },
        body: opts.body,
    };
    await handler(req as never, res as never);
    return { code, body: out };
}

async function main() {
    // ── normalisation ───────────────────────────────────────────────────────
    check('email: trimmed and lower-cased', normEmail('  Dr.Ana@Gmail.COM ') === 'dr.ana@gmail.com');
    check('email: junk becomes empty', normEmail('not an email') === '' && normEmail(null) === '');
    check('phone: +52 spaced stays E.164', toE164('+52 664 123 4567', 'mx') === '+526641234567');
    check('phone: bare 10 digits take the market country (mx)', toE164('664-123-4567', 'mx') === '+526641234567');
    check('phone: bare 10 digits take the market country (us)', toE164('(619) 446-1575', 'us') === '+16194461575');
    check('phone: 1 + 10 digits is a US number', toE164('1 619 446 1575', null) === '+16194461575');
    check('phone: 52 + 10 digits without a plus', toE164('52 664 123 4567', null) === '+526641234567');
    check('phone: old +52 1 mobile format collapses to +52', toE164('+52 1 664 123 4567', 'mx') === '+526641234567');
    check('phone: unreadable numbers are not guessed', toE164('12345', 'us') === '' && toE164('', 'us') === '');
    check('plan: read from English and Spanish product names',
        inferPlan('MedSociety Featured – monthly') === 'featured' && inferPlan('Plan Promocionado mensual') === 'promoted'
        && inferPlan('Destacado') === 'featured' && inferPlan('Something else') === null);
    check('secret: equal strings match, others do not',
        secretMatches('abc', 'abc') && !secretMatches('abd', 'abc') && !secretMatches('', 'abc') && !secretMatches('abc', ''));

    // ── payload parsing ─────────────────────────────────────────────────────
    const day = new Date('2026-10-16T12:00:00Z');
    const flat = parseEvent({ event: 'payment', plan: 'featured', market: 'mx', contact_id: 'c1', email: 'A@B.com', phone: '6641234567', transaction_id: 'tx-9', amount: '1700', currency: 'mxn' }, day);
    check('parses a flat payload', flat.ok && flat.ev.kind === 'payment' && flat.ev.plan === 'featured' && flat.ev.market === 'mx'
        && flat.ev.email === 'a@b.com' && flat.ev.contactId === 'c1' && flat.ev.key === 'payment:tx-9' && flat.ev.amount === 1700 && flat.ev.currency === 'MXN', flat);
    const nested = parseEvent({ contact: { id: 'c2', email: 'x@y.com' }, customData: { Plan: 'promoted', Event: 'subscription_canceled' }, full_name: 'X' }, day);
    check('parses GHL-style nesting and any key casing', nested.ok && nested.ev.plan === 'promoted' && nested.ev.kind === 'canceled'
        && nested.ev.contactId === 'c2' && nested.ev.email === 'x@y.com', nested);
    const noId = parseEvent({ plan: 'promoted', email: 'x@y.com' }, day);
    const noId2 = parseEvent({ plan: 'promoted', email: 'x@y.com' }, new Date('2026-10-16T20:00:00Z'));
    const noId3 = parseEvent({ plan: 'promoted', email: 'x@y.com' }, new Date('2026-10-17T01:00:00Z'));
    check('no transaction id: same payer, plan and day dedupe; next day does not',
        noId.ok && noId2.ok && noId3.ok && noId.ev.key === noId2.ev.key && noId.ev.key !== noId3.ev.key);
    const inferred = parseEvent({ product_name: 'Medsociety Promoted', currency: 'USD', email: 'x@y.com' }, day);
    check('plan and market inferred when not sent', inferred.ok && inferred.ev.plan === 'promoted' && inferred.ev.market === 'us', inferred);
    check('refund and failure events map', (() => {
        const r = parseEvent({ event: 'Refunded', email: 'x@y.com' }, day);
        const f = parseEvent({ event: 'payment_failed', email: 'x@y.com' }, day);
        return r.ok && r.ev.kind === 'refunded' && f.ok && f.ev.kind === 'failed';
    })());
    check('a payload naming nobody is rejected', !parseEvent({ plan: 'promoted' }, day).ok && !parseEvent(null, day).ok);

    // ── tags ────────────────────────────────────────────────────────────────
    const t1 = tagsFor(['promoted'], 'us');
    check('tags: promoted holder gets promoted + active, loses featured + lapsed',
        t1.add.includes('tier-promoted') && t1.add.includes('medsociety-plan-active') && t1.add.includes('medsociety-market-us')
        && t1.remove.includes('tier-featured') && t1.remove.includes('medsociety-plan-lapsed'), t1);
    const t2 = tagsFor([], 'mx');
    check('tags: lapsed contact loses both plan tags and gains lapsed',
        t2.remove.includes('tier-promoted') && t2.remove.includes('tier-featured') && t2.add.includes('medsociety-plan-lapsed')
        && t2.remove.includes('medsociety-plan-active'), t2);
    const t3 = tagsFor(['promoted', 'featured'], null);
    check('tags: a contact with two plans keeps both', t3.add.includes('tier-promoted') && t3.add.includes('tier-featured') && t3.remove.length === 1, t3);

    // ── POST /api/billing ───────────────────────────────────────────────────
    const good = { event: 'payment', plan: 'promoted', market: 'us', contact_id: 'c1', email: 'owner@clinic.com', transaction_id: 'tx-1' };
    reset();
    let r = await run({ headers: {}, body: good });
    check('no secret → 401, database untouched', r.code === 401 && calls.length === 0, r);
    r = await run({ headers: { 'x-webhook-secret': 'wrong' }, body: good });
    check('wrong secret → 401', r.code === 401, r);
    r = await run({ method: 'GET', headers: {} });
    check('GET without a job → 405', r.code === 405, r);

    reset();
    r = await run({ url: '/api/billing?secret=hook-secret', headers: {}, body: good });
    check('secret in the query string is accepted as a fallback', r.code === 200, r);

    reset();
    r = await run({ body: { plan: 'promoted' } });
    check('a payload with no payer → 400, nothing stored', r.code === 400 && calls.length === 0, r);

    reset();
    pendingRows = [{ id: 'sub-1', provider_id: 'p-1', provider_name: 'Clinica Uno', plan: 'promoted', market: 'us', status: 'active',
        paid_through: '2026-11-16T00:00:00Z', payer_email: 'owner@clinic.com', payer_phone: null, ghl_contact_id: 'c1', active_plans: ['promoted'] }];
    r = await run({ body: good });
    const apply = calls.find((c) => c.url.includes('/rpc/apply_billing_event'));
    const tagCall = calls.find((c) => c.url.includes('/contacts/c1/tags') && c.method === 'POST');
    const untag = calls.find((c) => c.url.includes('/contacts/c1/tags') && c.method === 'DELETE');
    const marked = calls.find((c) => c.url.includes('/rpc/billing_mark_synced'));
    check('payment: stored, tagged in GHL, marked synced',
        r.code === 200 && r.body.outcome === 'applied' && r.body.ghl_synced === true
        && (apply?.body as Record<string, unknown>)?.p_email === 'owner@clinic.com'
        && (tagCall?.body as { tags: string[] })?.tags.includes('tier-promoted')
        && (untag?.body as { tags: string[] })?.tags.includes('tier-featured')
        && (marked?.body as Record<string, unknown>)?.ok === true, { r, calls: calls.map((c) => c.method + ' ' + c.url) });

    reset();
    applyReply = { outcome: 'duplicate' };
    r = await run({ body: good });
    check('a replayed event is acknowledged without touching GHL',
        r.code === 200 && r.body.outcome === 'duplicate' && !calls.some((c) => c.url.includes('leadconnectorhq')), r);

    reset();
    applyReply = { outcome: 'unmatched', detail: 'no listing matches the payer email or phone' };
    r = await run({ body: good });
    check('unmatched: flagged on the GHL contact and the team is emailed',
        r.code === 200 && r.body.outcome === 'unmatched'
        && calls.some((c) => c.url.includes('/contacts/c1/tags') && JSON.stringify(c.body).includes('medsociety-payment-unmatched'))
        && calls.some((c) => c.url.includes('api.resend.com')), calls.map((c) => c.method + ' ' + c.url));

    reset();
    pendingRows = [{ id: 'sub-1', provider_id: 'p-1', provider_name: 'Clinica Uno', plan: 'promoted', market: 'mx', status: 'active',
        paid_through: '2026-11-16T00:00:00Z', payer_email: 'owner@clinic.com', payer_phone: '664 123 4567', ghl_contact_id: null, active_plans: ['promoted'] }];
    r = await run({ body: { ...good, contact_id: undefined } });
    const up = calls.find((c) => c.url.includes('/contacts/upsert'));
    check('no contact id from GHL: finds the person by email, phone sent as E.164',
        r.body.ghl_synced === true && (up?.body as Record<string, unknown>)?.phone === '+526641234567'
        && calls.some((c) => c.url.includes('/contacts/ghl-new/tags')), { r, up: up?.body });

    reset();
    pendingRows = [{ id: 'sub-1', provider_id: 'p-1', provider_name: 'Clinica Uno', plan: 'promoted', market: 'us', status: 'active',
        paid_through: '2026-11-16T00:00:00Z', payer_email: 'owner@clinic.com', payer_phone: null, ghl_contact_id: 'stale', active_plans: ['promoted'] }];
    ghlTagStatus = 404;
    r = await run({ body: { ...good, contact_id: 'stale' } });
    check('stale GHL contact id: re-resolved by email, then retried',
        calls.some((c) => c.url.includes('/contacts/upsert')) && calls.some((c) => c.url.includes('/contacts/ghl-new/tags')), calls.map((c) => c.method + ' ' + c.url));

    // ── GHL backstop: payment records → events ─────────────────────────────
    const now = new Date('2026-10-20T12:00:00Z');
    const ago = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    const tx = (o: Record<string, unknown>) => ({ liveMode: true, status: 'succeeded', amount: 49, currency: 'usd', entitySourceName: 'MedSociety Promoted US', contactId: 'c1', contactEmail: 'Owner@Clinic.com', subscriptionId: 'sub_1', chargeId: 'ch_1', createdAt: ago(1), amountRefunded: 0, ...o });
    const live = eventsFromGhl([tx({})] as never, [], now);
    check('backstop: a live promoted-US charge becomes a payment event keyed by the charge',
        live.length === 1 && live[0].key === 'payment:ch_1' && live[0].kind === 'payment' && live[0].plan === 'promoted'
        && live[0].market === 'us' && live[0].email === 'owner@clinic.com' && live[0].subscriptionId === 'sub_1', live);
    const es = eventsFromGhl([tx({ chargeId: 'ch_2', amount: 899, currency: 'mxn', entitySourceName: 'MedSociety Destacado MX' })] as never, [], now);
    check('backstop: Spanish product on MXN is featured / mx', es.length === 1 && es[0].plan === 'featured' && es[0].market === 'mx', es);
    check('backstop: test-mode charges are ignored', eventsFromGhl([tx({ liveMode: false })] as never, [], now).length === 0);
    check('backstop: failed and pending charges are ignored', eventsFromGhl([tx({ status: 'failed' }), tx({ chargeId: 'x', status: 'pending' })] as never, [], now).length === 0);
    check('backstop: other products are ignored', eventsFromGhl([tx({ entitySourceName: 'TEST trigger sub' })] as never, [], now).length === 0);
    check('backstop: a 20-day-old charge is not applied as a new payment', eventsFromGhl([tx({ createdAt: ago(20) })] as never, [], now).length === 0);
    const refunded = eventsFromGhl([tx({ createdAt: ago(20), amountRefunded: 49 })] as never, [], now);
    check('backstop: a refunded charge only flags the refund', refunded.length === 1 && refunded[0].kind === 'refund_seen' && refunded[0].key === 'refund_seen:ch_1', refunded);
    const ghlRefund = eventsFromGhl([tx({ status: 'refunded', amountRefunded: 49 })] as never, [], now);
    check('backstop: GHL\'s real `refunded` status is seen, and is not a payment', ghlRefund.length === 1 && ghlRefund[0].kind === 'refund_seen', ghlRefund);
    check('backstop: a partial refund changes nothing', eventsFromGhl([tx({ amountRefunded: 10 })] as never, [], now).filter((e) => e.kind !== 'payment').length === 0
        && eventsFromGhl([tx({ amountRefunded: 10 })] as never, [], now).length === 0);
    const sub = (o: Record<string, unknown>) => ({ liveMode: true, status: 'canceled', subscriptionId: 'sub_1', contactId: 'c1', contactEmail: 'owner@clinic.com', currency: 'usd', amount: 49, entitySourceName: 'MedSociety Promoted US', recurringProduct: { product: { name: 'MedSociety Promoted' } }, updatedAt: ago(3), ...o });
    const canceled = eventsFromGhl([], [sub({})] as never, now);
    check('backstop: a cancelled live subscription becomes a cancel event', canceled.length === 1 && canceled[0].kind === 'canceled' && canceled[0].key === 'canceled:sub_1' && canceled[0].plan === 'promoted', canceled);
    check('backstop: active, test-mode, incomplete and stale subscriptions are ignored',
        eventsFromGhl([], [sub({ status: 'active' }), sub({ liveMode: false }), sub({ status: 'incomplete_expired' }), sub({ updatedAt: ago(90) })] as never, now).length === 0);

    // ── sync ping: a tag change or payment names a contact; the site verifies with GHL ──
    check('ping: tag and sync events are recognised, payments are not',
        isSyncPing({ event: 'tag_added' }) && isSyncPing({ customData: { Event: 'sync' } }) && isSyncPing({ event: 'Tag Removed' })
        && !isSyncPing({ event: 'payment' }) && !isSyncPing({ plan: 'promoted' }));

    const liveCharge = { liveMode: true, status: 'succeeded', amount: 49, currency: 'usd', entitySourceName: 'MedSociety Promoted US', contactId: 'c1', contactEmail: 'owner@clinic.com', subscriptionId: 'sub_7', chargeId: 'ch_7', createdAt: new Date().toISOString(), amountRefunded: 0 };
    const pendingRow = { id: 'sub-1', provider_id: 'p-1', provider_name: 'Clinica Uno', plan: 'promoted', market: 'us', status: 'active', paid_through: '2026-11-16T00:00:00Z', payer_email: 'owner@clinic.com', payer_phone: null, ghl_contact_id: 'c1', active_plans: ['promoted'] };

    reset();
    ghlTransactions = [liveCharge];
    pendingRows = [pendingRow];
    r = await run({ body: { event: 'tag_added', contact_id: 'c1' } });
    const read = calls.find((c) => c.url.includes('/payments/transactions'));
    const applied = calls.find((c) => c.url.includes('/rpc/apply_billing_event'));
    const mail = calls.find((c) => c.url.includes('api.resend.com'));
    check('ping: reads that contact\'s payments from GHL, applies them, tags, and emails the team',
        r.code === 200 && r.body.mode === 'sync' && r.body.applied === 1 && r.body.ghl_synced === 1
        && Boolean(read?.url.includes('contactId=c1'))
        && (applied?.body as Record<string, unknown>)?.p_event_key === 'payment:ch_7'
        && calls.some((c) => c.url.includes('/contacts/c1/tags') && c.method === 'POST')
        && JSON.stringify(mail?.body).includes('Promoted plan activated for Clinica Uno'), { r, mail: mail?.body });

    reset();
    ghlTransactions = [liveCharge];
    pendingRows = [pendingRow];
    r = await run({ body: { event: 'sync', email: ' OWNER@clinic.com ' } });
    check('ping: with only an email, finds the GHL contact first',
        r.code === 200 && r.body.applied === 1 && calls.some((c) => c.url.includes('/contacts/?locationId'))
        && Boolean(calls.find((c) => c.url.includes('/payments/transactions'))?.url.includes('contactId=c-found')), r);

    reset();
    r = await run({ body: { event: 'tag_added' } });
    check('ping: naming no contact → 400', r.code === 400 && r.body.error === 'no_contact', r);

    reset();
    ghlTransactions = [{ ...liveCharge, liveMode: false }];
    r = await run({ body: { event: 'tag_added', contact_id: 'c1' } });
    check('ping: a test-mode charge changes nothing', r.code === 200 && r.body.seen === 0 && !calls.some((c) => c.url.includes('/rpc/apply_billing_event')), r);

    reset();
    process.env.BILLING_ACCEPT_TEST_MODE = '1';
    ghlTransactions = [{ ...liveCharge, liveMode: false }];
    pendingRows = [pendingRow];
    r = await run({ body: { event: 'tag_added', contact_id: 'c1' } });
    check('ping: with BILLING_ACCEPT_TEST_MODE=1 the test charge is applied (rehearsal)', r.code === 200 && r.body.applied === 1, r);

    reset();
    ghlReadFails = true;
    r = await run({ body: { event: 'tag_added', contact_id: 'c1' } });
    check('ping: GHL unreadable → 502 so GHL retries', r.code === 502, r);

    reset();
    ghlTransactions = [liveCharge];
    applyReply = { outcome: 'duplicate' };
    r = await run({ body: { event: 'tag_added', contact_id: 'c1' } });
    check('ping: a charge already recorded is a no-op and sends no email',
        r.code === 200 && r.body.applied === 0 && r.body.already === 1 && !calls.some((c) => c.url.includes('api.resend.com')), r);

    reset();
    pendingRows = [pendingRow];
    r = await run({ body: good });
    check('webhook payment: the team is told the plan switched on',
        r.code === 200 && JSON.stringify(calls.find((c) => c.url.includes('api.resend.com'))?.body).includes('plan activated for Clinica Uno'), calls.map((c) => c.url));

    // ── cron ────────────────────────────────────────────────────────────────
    reset();
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: {} });
    check('cron without the bearer secret → 401', r.code === 401 && calls.length === 0, r);

    reset();
    pendingRows = [{ id: 'sub-2', provider_id: 'p-9', provider_name: 'Clinica Nueve', plan: 'promoted', market: 'us', status: 'lapsed',
        paid_through: '2026-09-01T00:00:00Z', payer_email: 'x@y.com', payer_phone: null, ghl_contact_id: 'c9', active_plans: [] }];
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    const lapseTags = calls.filter((c) => c.url.includes('/contacts/c9/tags'));
    check('cron: lapses plans, strips the plan tags in GHL, adds lapsed',
        r.code === 200 && r.body.lapsed === 1 && r.body.ghl_synced === 1
        && lapseTags.some((c) => c.method === 'DELETE' && JSON.stringify(c.body).includes('tier-promoted'))
        && lapseTags.some((c) => c.method === 'POST' && JSON.stringify(c.body).includes('medsociety-plan-lapsed')), { r, lapseTags });

    reset();
    ghlTransactions = [{ liveMode: true, status: 'succeeded', amount: 49, currency: 'usd', entitySourceName: 'MedSociety Promoted US', contactId: 'c1', contactEmail: 'owner@clinic.com', subscriptionId: 'sub_9', chargeId: 'ch_9', createdAt: new Date().toISOString(), amountRefunded: 0 }];
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    const polled = calls.find((c) => c.url.includes('/rpc/apply_billing_event'));
    check('cron: payments found in GHL are applied with GHL ids',
        r.code === 200 && (polled?.body as Record<string, unknown>)?.p_event_key === 'payment:ch_9'
        && (polled?.body as Record<string, unknown>)?.p_subscription_id === 'sub_9', { r, body: polled?.body });

    reset();
    ghlTransactions = [{ liveMode: true, status: 'succeeded', amount: 49, currency: 'usd', entitySourceName: 'MedSociety Promoted US', contactId: 'c1', contactEmail: 'owner@clinic.com', subscriptionId: 'sub_9', chargeId: 'ch_9', createdAt: new Date().toISOString(), amountRefunded: 0 }];
    applyReply = { outcome: 'unmatched', detail: 'no listing matches the payer email or phone' };
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    check('cron: a polled payment nobody can be matched to emails the team once',
        (r.body.poll as { unmatched: number }).unmatched === 1 && calls.filter((c) => c.url.includes('api.resend.com')).length === 1, r);

    // ── Featured → website ──────────────────────────────────────────────────
    check('subdomain: accents, ampersand, punctuation', siteSubdomain('Clínica Dental & Más, S.A.') === 'clinica-dental-and-mas-s-a', siteSubdomain('Clínica Dental & Más, S.A.'));
    check('subdomain: long names are cut at a word, max 30', siteSubdomain('Better Than Ever the Recovery Center Tijuana').length <= 30 && !siteSubdomain('Better Than Ever the Recovery Center Tijuana').endsWith('-'), siteSubdomain('Better Than Ever the Recovery Center Tijuana'));
    check('subdomain: tiny and retry names', siteSubdomain('Dr', 0).length >= 3 && siteSubdomain('Clinica Uno', 1) === 'clinica-uno-2', [siteSubdomain('Dr'), siteSubdomain('Clinica Uno', 1)]);

    const featured = { id: 'sub-f', provider_id: 'p-f', provider_name: 'Clínica Feliz', plan: 'featured', market: 'us', status: 'active',
        paid_through: '2026-12-01T00:00:00Z', payer_email: 'o@c.com', payer_phone: null, ghl_contact_id: 'cf', active_plans: ['featured'] };

    reset();
    delete process.env.VERCEL_TOKEN;
    pendingRows = [featured];
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    check('site: without VERCEL_TOKEN nothing is created', r.body.ghl_synced === 1 && siteRows.length === 0 && !calls.some((c) => c.url.includes('api.vercel.com')), r);

    process.env.VERCEL_TOKEN = 'vt';
    reset();
    pendingRows = [featured];
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    const vAdd = calls.find((c) => c.url.includes('api.vercel.com') && c.method === 'POST');
    check('site: Featured payment → private row, Vercel domain, invite tag, synced',
        r.body.ghl_synced === 1 && siteRows[0]?.subdomain === 'clinica-feliz'
        && (vAdd?.body as Record<string, unknown>)?.name === 'clinica-feliz.medsociety.one' && vAdd?.url.includes('teamId=')
        && calls.some((c) => c.url.includes('/contacts/cf/tags') && c.method === 'POST' && JSON.stringify(c.body).includes('site-brief-invite'))
        && (calls.find((c) => c.url.includes('/rpc/billing_mark_synced'))?.body as Record<string, unknown>)?.ok === true,
        { r, siteRows, calls: calls.map((c) => c.method + ' ' + c.url) });

    reset();
    pendingRows = [{ ...featured, plan: 'promoted', active_plans: ['promoted'] }];
    await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    check('site: a Promoted plan gets no site', siteRows.length === 0 && !calls.some((c) => c.url.includes('api.vercel.com')));

    reset();
    pendingRows = [{ ...featured, status: 'lapsed' }];
    await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    check('site: a lapsed Featured plan creates nothing', siteRows.length === 0 && !calls.some((c) => c.url.includes('api.vercel.com')));

    const cfg = { supaUrl: 'https://example.supabase.co', supaKey: 'service-key', pit: 'pit', readPit: 'pit-read' } as unknown as Parameters<typeof ensureSite>[0];
    reset();
    siteRows = [{ provider_id: 'p-f', subdomain: 'clinica-feliz' }];
    vercelAdd = 409;
    let o = await ensureSite(cfg, featured, 'cf');
    check('site: rerun with row and domain already there changes nothing, sends no second invite',
        o?.rowCreated === false && o.domain === 'exists' && o.tagged === false && !calls.some((c) => c.url.includes('/tags')), { o });

    reset();
    siteRows = [{ provider_id: 'p-other', subdomain: 'clinica-feliz' }];
    o = await ensureSite(cfg, featured, 'cf');
    check('site: a taken name falls to the next free one', o?.subdomain === 'clinica-feliz-2' && siteRows.length === 2, { o, siteRows });

    reset();
    vercelAdd = 409; vercelGet = 404;
    let threw = '';
    try { await ensureSite(cfg, featured, 'cf'); } catch (e) { threw = String(e); }
    check('site: domain owned by another Vercel project → error so the sync retries', /in use elsewhere/.test(threw) && !calls.some((c) => c.url.includes('/tags')), threw);

    reset();
    vercelAdd = 500;
    pendingRows = [featured];
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    const failMark = calls.find((c) => c.url.includes('/rpc/billing_mark_synced'));
    check('site: a Vercel failure leaves the row unsynced for tomorrow, no invite sent',
        (failMark?.body as Record<string, unknown>)?.ok === false && !calls.some((c) => c.url.includes('/contacts/cf/tags') && JSON.stringify(c.body).includes('site-brief-invite')), { r, body: failMark?.body });

    reset();
    process.env.SITE_AUTOCREATE = '0';
    o = await ensureSite(cfg, featured, 'cf');
    check('site: SITE_AUTOCREATE=0 switches it off', o === null && calls.length === 0);
    delete process.env.SITE_AUTOCREATE;
    delete process.env.VERCEL_TOKEN;


    {
    // ── Stripe ──────────────────────────────────────────────────────────────
    check('stripe: price keys map to plan and market',
        planFromLookupKey('featured_mx_monthly')?.plan === 'featured' && planFromLookupKey('featured_mx_monthly')?.market === 'mx'
        && planFromLookupKey('promoted_us_monthly')?.market === 'us' && planFromLookupKey('basic_us_monthly') === null && planFromLookupKey(null) === null);
    check('stripe: form encoding nests objects and lists',
        formEncode({ mode: 'subscription', line_items: [{ price: 'p', quantity: 1 }], subscription_data: { metadata: { a: 'b' } }, skip: undefined })
        === 'mode=subscription&line_items%5B0%5D%5Bprice%5D=p&line_items%5B0%5D%5Bquantity%5D=1&subscription_data%5Bmetadata%5D%5Ba%5D=b');

    const sub = (over: Record<string, unknown> = {}) => ({
        id: 'sub_1', status: 'active', customer: 'cus_1', cancel_at_period_end: false, current_period_end: 1_800_000_000,
        metadata: { provider_id: PROVIDER_ID, plan: 'promoted', market: 'us' },
        items: { data: [{ price: { id: 'price_p', lookup_key: 'promoted_us_monthly' } }] }, ...over,
    });
    const evt = (type: string, object: unknown, extra: Record<string, unknown> = {}) =>
        ({ id: 'evt_test_1', type, livemode: false, data: { object, ...extra } });
    const sk = { key: 'sk_test_abc123', live: false };

    reset();
    stripeSubs = { sub_1: sub() };
    let ap = await stripeToApply(sk, evt('invoice.paid', { id: 'in_1', subscription: 'sub_1', customer_email: 'Owner@Clinic.com', amount_paid: 4900, currency: 'usd' }));
    check('stripe: a paid invoice becomes a payment with the plan from the subscription, the listing from its metadata and Stripe\'s period end',
        ap?.kind === 'payment' && ap.plan === 'promoted' && ap.market === 'us' && ap.providerId === PROVIDER_ID && ap.key === 'stripe:invoice:in_1'
        && ap.amount === 49 && ap.currency === 'USD' && ap.email === 'owner@clinic.com' && ap.periodEnd === new Date(1_800_000_000_000).toISOString(), ap);

    stripeSubs = { sub_1: sub({ items: { data: [{ price: { id: 'price_f', lookup_key: 'featured_us_monthly' } }] } }) };
    ap = await stripeToApply(sk, evt('invoice.paid', { id: 'in_2', parent: { subscription_details: { subscription: 'sub_1' } }, amount_paid: 2500, currency: 'usd' }));
    check('stripe: after an upgrade the plan is the subscription\'s CURRENT price, and the newer invoice shape is read', ap?.plan === 'featured' && ap.amount === 25, ap);

    stripeSubs = { sub_1: sub({ items: { data: [{ price: { id: 'x', lookup_key: 'something_else' } }] } }) };
    ap = await stripeToApply(sk, evt('invoice.paid', { id: 'in_3', subscription: 'sub_1' }));
    check('stripe: a price that is not one of ours is ignored', ap === null);
    check('stripe: an invoice with no subscription is ignored', (await stripeToApply(sk, evt('invoice.paid', { id: 'in_4' }))) === null);

    stripeSubs = { sub_1: sub({ items: { data: [{ current_period_end: 1_900_000_000, price: { id: 'price_p', lookup_key: 'promoted_us_monthly' } }] }, current_period_end: undefined }) };
    ap = await stripeToApply(sk, evt('invoice.paid', { id: 'in_5', subscription: 'sub_1' }));
    check('stripe: the period end is also read from the subscription item', ap?.periodEnd === new Date(1_900_000_000_000).toISOString(), ap);

    ap = await stripeToApply(sk, evt('customer.subscription.updated', sub({ cancel_at_period_end: true })));
    check('stripe: cancel at period end → canceled, keeping the period end', ap?.kind === 'canceled' && ap.periodEnd !== null && ap.plan === 'promoted', ap);
    ap = await stripeToApply(sk, evt('customer.subscription.updated', sub({ cancel_at_period_end: false }), { previous_attributes: { cancel_at_period_end: true } }));
    check('stripe: undoing a cancel → resumed', ap?.kind === 'resumed', ap);
    ap = await stripeToApply(sk, evt('customer.subscription.updated', sub(), { previous_attributes: { items: {} } }));
    check('stripe: a plain price change is not applied until its invoice is paid', ap === null);
    ap = await stripeToApply(sk, evt('customer.subscription.updated', sub({ status: 'canceled', cancel_at_period_end: true })));
    check('stripe: an already-ended subscription update is left to the deleted event', ap === null);
    ap = await stripeToApply(sk, evt('customer.subscription.deleted', sub({ status: 'canceled' })));
    check('stripe: a deleted subscription → canceled with the paid time kept (no period end)', ap?.kind === 'canceled' && ap.periodEnd === null, ap);
    ap = await stripeToApply(sk, evt('invoice.payment_failed', { id: 'in_6', subscription: 'sub_1' }));
    check('stripe: a failed renewal → failed, found through the subscription id', ap?.kind === 'failed' && ap.subscriptionId === 'sub_1' && ap.providerId === null, ap);

    stripeInvoices = { in_7: { id: 'in_7', subscription: 'sub_1' } };
    ap = await stripeToApply(sk, evt('charge.refunded', { id: 'ch_1', amount: 4900, amount_refunded: 4900, currency: 'usd', invoice: 'in_7' }));
    check('stripe: a full refund is flagged through its invoice\'s subscription', ap?.kind === 'refund_seen' && ap.subscriptionId === 'sub_1' && ap.amount === 49, ap);
    ap = await stripeToApply(sk, evt('charge.refunded', { id: 'ch_2', amount: 4900, amount_refunded: 1000, invoice: 'in_7' }));
    check('stripe: a partial refund is not the plan\'s end', ap === null);
    check('stripe: other event types are ignored', (await stripeToApply(sk, evt('customer.created', { id: 'cus_1' }))) === null);

    // webhook
    reset();
    stripeSubs = { sub_1: sub() };
    stripeEvents = { evt_test_1: evt('invoice.paid', { id: 'in_1', subscription: 'sub_1', amount_paid: 4900, currency: 'usd' }) };
    pendingRows = [{ id: 'sub-1', provider_id: 'p-1', provider_name: 'Clinica Uno', plan: 'promoted', market: 'us', status: 'active', paid_through: '2027-01-15T00:00:00Z', payer_email: 'o@c.com', payer_phone: null, ghl_contact_id: 'cg', active_plans: ['promoted'] }];
    let r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_test_1' } });
    const applied = calls.find((c) => c.url.includes('/rpc/apply_stripe_event'))?.body as Record<string, unknown> | undefined;
    check('webhook: fetches the event from Stripe, applies it with the listing and period end, then mirrors into GHL',
        r.code === 200 && r.body.outcome === 'applied' && calls.some((c) => c.url.includes('/v1/events/evt_test_1'))
        && applied?.p_provider === PROVIDER_ID && applied?.p_plan === 'promoted' && applied?.p_event_key === 'stripe:invoice:in_1'
        && calls.some((c) => c.url.includes('/contacts/cg/tags')) && calls.some((c) => c.url.includes('/rpc/billing_mark_synced')), { r, applied });

    reset();
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_does_not_exist' } });
    check('webhook: an event id Stripe does not know is rejected and nothing is applied', r.code === 401 && !calls.some((c) => c.url.includes('/rpc/')), r);
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'not-an-event' } });
    check('webhook: a body without an event id is rejected', r.code === 400);
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: {} });
    check('webhook: an empty body is rejected', r.code === 400);

    reset();
    stripeEvents = { evt_live_1: { ...(evt('invoice.paid', { id: 'in_9', subscription: 'sub_1' }) as object), id: 'evt_live_1', livemode: true } };
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_live_1' } });
    check('webhook: a live-mode event is ignored by a test key', r.code === 200 && r.body.ignored === 'other_mode' && !calls.some((c) => c.url.includes('/rpc/')), r);

    reset();
    stripeEvents = { evt_test_2: evt('customer.created', { id: 'cus_1' }) };
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_test_2' } });
    check('webhook: an event type we do not use is acknowledged and not applied', r.code === 200 && r.body.ignored === 'customer.created' && !calls.some((c) => c.url.includes('/rpc/')), r);

    reset();
    stripeSubs = { sub_1: sub() };
    stripeEvents = { evt_test_1: evt('invoice.paid', { id: 'in_1', subscription: 'sub_1', amount_paid: 4900, currency: 'usd' }) };
    applyReply = { outcome: 'duplicate' };
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_test_1' } });
    check('webhook: a duplicate is acknowledged with no mirroring', r.code === 200 && r.body.outcome === 'duplicate' && !calls.some((c) => c.url.includes('/contacts/')), r);

    reset();
    stripeSubs = { sub_1: sub() };
    stripeEvents = { evt_test_1: evt('invoice.paid', { id: 'in_1', subscription: 'sub_1', amount_paid: 4900, currency: 'usd', customer_email: 'x@y.com' }) };
    applyReply = { outcome: 'unmatched', detail: 'no listing' };
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_test_1' } });
    check('webhook: an unmatched payment alerts the team', r.code === 200 && calls.some((c) => c.url.includes('api.resend.com')), r);
    stripeEvents = { evt_test_3: evt('invoice.payment_failed', { id: 'in_6', subscription: 'sub_1' }) };
    calls = [];
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_test_3' } });
    check('webhook: an unmatched failure or cancel does not alert (only payments do)', r.code === 200 && !calls.some((c) => c.url.includes('api.resend.com')), r);

    reset();
    delete process.env.STRIPE_SECRET_KEY;
    r = await run({ url: '/api/billing?job=stripe', headers: {}, body: { id: 'evt_test_1' } });
    check('webhook: no Stripe key configured → 500', r.code === 500);
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';


    check('return: our own origins are kept, anything else falls back to production',
        returnBase('https://medsociety-marketplace-git-feat-stripe-billing-dropdevs-projects-25301cf7.vercel.app') === 'https://medsociety-marketplace-git-feat-stripe-billing-dropdevs-projects-25301cf7.vercel.app'
        && returnBase('https://www.medsociety.one') === 'https://www.medsociety.one' && returnBase('http://localhost:5174') === 'http://localhost:5174'
        && returnBase('https://evil.example.com') === 'https://medsociety.one' && returnBase('https://medsociety-marketplace-x-dropdevs-projects-25301cf7.vercel.app.evil.com') === 'https://medsociety.one'
        && returnBase('http://medsociety.one') === 'https://medsociety.one' && returnBase(undefined) === 'https://medsociety.one');
    // checkout
    const auth = { authorization: 'Bearer good-token' };
    const checkoutBody = { provider_id: PROVIDER_ID, plan: 'featured', market: 'mx' };
    reset();
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: checkoutBody });
    const session = calls.find((c) => c.url.includes('/checkout/sessions'))?.body as string | undefined;
    const customerCall = calls.find((c) => c.url.endsWith('/customers') && c.method === 'POST')?.body as string | undefined;
    check('checkout: an owner gets a Checkout URL for the plan price, with the listing in the metadata, a new customer and the plan-tab return',
        r.code === 200 && r.body.url === 'https://checkout.stripe.com/c/pay/cs_test_1'
        && !!session && session.includes('line_items%5B0%5D%5Bprice%5D=price_for_featured_mx_monthly') && session.includes(`client_reference_id=${PROVIDER_ID}`)
        && session.includes('subscription_data%5Bmetadata%5D%5Bprovider_id%5D=' + PROVIDER_ID) && session.includes('customer=cus_new')
        && session.includes(encodeURIComponent('/dashboard?tab=plan&paid=featured')) && !!customerCall && customerCall.includes('email=owner%40clinic.com'), { r, session });

    reset();
    subRows = [{ plan: 'promoted', status: 'lapsed', paid_through: '2026-01-01T00:00:00Z', stripe_customer_id: 'cus_old', stripe_subscription_id: 'sub_old' }];
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: checkoutBody });
    check('checkout: the listing\'s existing Stripe customer is reused, no second customer is created',
        r.code === 200 && (calls.find((c) => c.url.includes('/checkout/sessions'))?.body as string).includes('customer=cus_old') && !calls.some((c) => c.url.endsWith('/customers') && c.method === 'POST'), r);

    reset();
    stripeCustomerSearch = [{ id: 'cus_found' }];
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: checkoutBody });
    check('checkout: a customer already created for this listing is found, not duplicated',
        r.code === 200 && (calls.find((c) => c.url.includes('/checkout/sessions'))?.body as string).includes('customer=cus_found') && !calls.some((c) => c.url.endsWith('/customers') && c.method === 'POST'), r);

    reset();
    subRows = [{ plan: 'promoted', status: 'active', paid_through: '2999-01-01T00:00:00Z', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }];
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: checkoutBody });
    check('checkout: a listing that already pays is told to use the portal (no second subscription)', r.code === 409 && r.body.error === 'already_subscribed' && !calls.some((c) => c.url.includes('/checkout/sessions')), r);

    reset();
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: {}, body: checkoutBody });
    check('checkout: no session → 401, Stripe never called', r.code === 401 && !calls.some((c) => c.url.includes('api.stripe.com')), r);
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: { authorization: 'Bearer bad' }, body: checkoutBody });
    check('checkout: an invalid session → 401', r.code === 401);
    ownerRows = [];
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: checkoutBody });
    check('checkout: someone who does not own the listing → 403, Stripe never called', r.code === 403 && !calls.some((c) => c.url.includes('api.stripe.com')), r);
    ownerRows = [{ role: 'owner' }];
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: { ...checkoutBody, plan: 'basic' } });
    check('checkout: only the two paid plans can be bought', r.code === 400 && r.body.error === 'bad_plan', r);
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: { ...checkoutBody, provider_id: 'nope' } });
    check('checkout: a malformed listing id → 400', r.code === 400 && r.body.error === 'bad_provider', r);
    stripePriceMissing = true;
    r = await run({ url: '/api/billing?job=stripe-checkout', headers: auth, body: checkoutBody });
    check('checkout: a missing Stripe price is reported, not guessed', r.code === 500 && r.body.error === 'price_missing', r);

    // portal
    reset();
    subRows = [{ plan: 'promoted', status: 'active', paid_through: '2999-01-01T00:00:00Z', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }];
    r = await run({ url: '/api/billing?job=stripe-portal', headers: auth, body: { provider_id: PROVIDER_ID } });
    const portal = calls.find((c) => c.url.includes('/billing_portal/sessions'))?.body as string | undefined;
    check('portal: an owner gets the portal for the listing\'s own customer, returning to the Plan tab',
        r.code === 200 && r.body.url === 'https://billing.stripe.com/p/session/x' && !!portal && portal.includes('customer=cus_1') && portal.includes(encodeURIComponent('/dashboard?tab=plan&portal=1')), { r, portal });
    process.env.STRIPE_PORTAL_CONFIG = 'bpc_123';
    calls = [];
    await run({ url: '/api/billing?job=stripe-portal', headers: auth, body: { provider_id: PROVIDER_ID } });
    check('portal: a configured portal configuration is passed on', (calls.find((c) => c.url.includes('/billing_portal/sessions'))?.body as string).includes('configuration=bpc_123'));
    delete process.env.STRIPE_PORTAL_CONFIG;
    reset();
    r = await run({ url: '/api/billing?job=stripe-portal', headers: auth, body: { provider_id: PROVIDER_ID } });
    check('portal: a listing with no Stripe customer yet → 404', r.code === 404 && r.body.error === 'no_billing_account', r);
    ownerRows = [];
    subRows = [{ plan: 'promoted', status: 'active', paid_through: '2999-01-01T00:00:00Z', stripe_customer_id: 'cus_other', stripe_subscription_id: 'sub_o' }];
    r = await run({ url: '/api/billing?job=stripe-portal', headers: auth, body: { provider_id: PROVIDER_ID } });
    check('portal: not the owner → 403, never another clinic\'s portal', r.code === 403 && !calls.some((c) => c.url.includes('/billing_portal/')), r);

    // daily cross-check
    reset();
    stripeSubList = [
        { ...sub(), latest_invoice: { id: 'in_10', status: 'paid', customer_email: 'o@c.com', amount_paid: 4900, currency: 'usd' } },
        { ...sub({ id: 'sub_2', cancel_at_period_end: true }), latest_invoice: { id: 'in_11', status: 'paid', amount_paid: 4900, currency: 'usd' } },
        { ...sub({ id: 'sub_3', status: 'canceled' }), latest_invoice: { id: 'in_12', status: 'open' } },
        { ...sub({ id: 'sub_4', metadata: {} }), latest_invoice: { id: 'in_13', status: 'paid' } },
    ];
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    const keys = calls.filter((c) => c.url.includes('/rpc/apply_stripe_event')).map((c) => (c.body as Record<string, unknown>).p_event_key);
    check('sync: the daily run applies paid invoices, scheduled cancels and ended subscriptions, and skips ones not made through our checkout',
        keys.includes('stripe:invoice:in_10') && keys.includes('stripe:invoice:in_11') && keys.some((k) => String(k).startsWith('stripe:rec:canceled:sub_2'))
        && keys.includes('stripe:rec:ended:sub_3') && !keys.some((k) => String(k).includes('sub_4') || String(k).includes('in_13') || String(k).includes('in_12')), { keys, r });

    reset();
    delete process.env.STRIPE_SECRET_KEY;
    r = await run({ method: 'GET', url: '/api/billing?job=sync', headers: { authorization: 'Bearer cron-secret' } });
    check('sync: without a Stripe key the daily run still works (GHL only)', r.code === 200 && !calls.some((c) => c.url.includes('api.stripe.com')), r);
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123';
    }

    console.log(failures ? `\n${failures} failing` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
}

void main();
