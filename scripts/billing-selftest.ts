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
import handler, { eventsFromGhl, inferPlan, normEmail, parseEvent, secretMatches, tagsFor, toE164 } from '../api/billing';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.GHL_PIT_MEDSOCIETY = 'pit';
process.env.GHL_PIT_READONLY = 'pit-read';
process.env.BILLING_WEBHOOK_SECRET = 'hook-secret';
process.env.CRON_SECRET = 'cron-secret';
process.env.RESEND_API_KEY = 'resend-key';
process.env.LEAD_NOTIFY_FROM = 'MedSociety <hi@example.com>';
process.env.LEAD_NOTIFY_TO = 'team@example.com';

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

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method: init?.method ?? 'GET', body });
    const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status });
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
    check('backstop: a refunded charge becomes only a refund event', refunded.length === 1 && refunded[0].kind === 'refunded' && refunded[0].key === 'refunded:ch_1', refunded);
    check('backstop: a partial refund changes nothing', eventsFromGhl([tx({ amountRefunded: 10 })] as never, [], now).filter((e) => e.kind !== 'payment').length === 0
        && eventsFromGhl([tx({ amountRefunded: 10 })] as never, [], now).length === 0);
    const sub = (o: Record<string, unknown>) => ({ liveMode: true, status: 'canceled', subscriptionId: 'sub_1', contactId: 'c1', contactEmail: 'owner@clinic.com', currency: 'usd', amount: 49, entitySourceName: 'MedSociety Promoted US', recurringProduct: { product: { name: 'MedSociety Promoted' } }, updatedAt: ago(3), ...o });
    const canceled = eventsFromGhl([], [sub({})] as never, now);
    check('backstop: a cancelled live subscription becomes a cancel event', canceled.length === 1 && canceled[0].kind === 'canceled' && canceled[0].key === 'canceled:sub_1' && canceled[0].plan === 'promoted', canceled);
    check('backstop: active, test-mode, incomplete and stale subscriptions are ignored',
        eventsFromGhl([], [sub({ status: 'active' }), sub({ liveMode: false }), sub({ status: 'incomplete_expired' }), sub({ updatedAt: ago(90) })] as never, now).length === 0);

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

    console.log(failures ? `\n${failures} failing` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
}

void main();
