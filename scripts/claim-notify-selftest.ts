/**
 * Checks for api/claim-notify.ts: rendering of every claim e-mail in both
 * languages, escaping, auth, and the whole drain with `fetch` stubbed, so
 * nothing reaches Supabase or GHL.
 *
 * The queueing itself lives in Postgres (0048_claim_emails.sql) and is not
 * covered here.
 *
 *   npx tsx scripts/claim-notify-selftest.ts
 */
import handler, { parseBand, renderEmail, renderReviewDigest, type NearBarItem, type QueuedEmail } from '../api/claim-notify';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
process.env.GHL_PIT_MEDSOCIETY = 'pit';
process.env.GHL_LOCATION_MEDSOCIETY = 'loc-1';
process.env.CLAIM_NOTIFY_TO = 'team@example.com, ops@example.com, not-an-email';
process.env.CRON_SECRET = 'cron-secret';
process.env.REVIEW_ALERT_TO = 'david@example.com';
process.env.PUBLIC_SITE_URL = 'https://medsociety.one';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

const base: QueuedEmail = {
    id: 'e-1', kind: 'claimant_received', claim_id: 'c-1', attempts: 1,
    claimant_email: 'Doc@Example.com', legal_name: 'María López', claimant_role: 'doctor', review_note: null,
    provider_id: 'p-1', provider_name: 'Clínica Dental López', provider_city: 'Ciudad Juárez', provider_country: 'MX',
};

// ── Rendering ───────────────────────────────────────────────────────────────
console.log('rendering');
for (const kind of ['claimant_received', 'claimant_needs_info', 'claimant_approved', 'claimant_rejected', 'team_new_claim'] as const) {
    const r = renderEmail({ ...base, kind, review_note: 'Need a clearer INE' }, 'https://medsociety.one');
    check(`${kind}: subject names the listing`, r.subject.includes('Clínica Dental López'), r.subject);
    check(`${kind}: no unescaped listing HTML`, !/<script/i.test(r.html));
}
const mx = renderEmail(base, 'https://medsociety.one');
check('MX listing: Spanish first in subject', mx.subject.startsWith('Recibimos'), mx.subject);
check('MX listing: Spanish first in body', mx.html.indexOf('Recibimos tu solicitud') < mx.html.indexOf('We received your claim'));
check('received: links to the claim page', mx.html.includes('https://medsociety.one/claim/p-1'));
check('received: says the clinic will be called', mx.html.includes('phone already on the listing'));
const us = renderEmail({ ...base, provider_country: 'US' }, 'https://medsociety.one');
check('US listing: English first', us.subject.startsWith('We received') && us.html.indexOf('We received your claim') < us.html.indexOf('Recibimos tu solicitud'));
const hostile = renderEmail({ ...base, kind: 'claimant_needs_info', review_note: '<img src=x onerror=alert(1)>', provider_name: '<b>X</b>' }, 'https://medsociety.one');
check('review note and listing name are escaped', !hostile.html.includes('<img src=x') && hostile.html.includes('&lt;img') && !hostile.html.includes('<b>X</b>'));
check('needs_info: shows the reviewer note', renderEmail({ ...base, kind: 'claimant_needs_info', review_note: 'Need a clearer INE' }, 'https://medsociety.one').html.includes('Need a clearer INE'));
check('rejected: mentions the 30-day wait', renderEmail({ ...base, kind: 'claimant_rejected', review_note: 'x' }, 'https://medsociety.one').html.includes('30'));
check('approved: links to the dashboard', renderEmail({ ...base, kind: 'claimant_approved' }, 'https://medsociety.one').html.includes('/dashboard'));
const team = renderEmail({ ...base, kind: 'team_new_claim' }, 'https://medsociety.one');
check('team: links to the admin queue', team.html.includes('/admin?tab=claims'));
check('no name: neutral greeting', renderEmail({ ...base, legal_name: null }, 'https://medsociety.one').html.includes('Hola:'));

// ── Scorer alert (job=review) ───────────────────────────────────────────────
const near = (over: Partial<NearBarItem>): NearBarItem => ({
    source_slug: 'baja-health-cluster-doctors', external_id: 'x', score: 82, verdict: 'approve', reason: 'Unique name.', scored_at: '2026-11-18T00:00:00Z',
    status: 'confirmed', tier: 3, name: 'Rosa Ejemplo Rio', label: 'Member doctor', region: 'sandiego-tijuana', candidate: 'Dra. Rosa Ejemplo Rio', linked: true, ...over,
});
const digest = renderReviewDigest([
    near({ external_id: 'a' }),
    near({ external_id: 'b', score: 74, linked: false, status: 'probable', verdict: 'needs_human', name: 'Pablo <b>Ejemplo</b>' }),
    near({ external_id: 'c', score: 40, tier: 1, linked: false, status: 'probable', verdict: 'reject', name: 'Lucia Prueba' }),
], 'https://medsociety.one', { low: 70, high: 89 });
check('review: subject counts the matches', digest.subject.includes('3 AI matches'), digest.subject);
check('review: cédula conflicts come first, then linked, then waiting',
    digest.html.indexOf('Cédula conflicts') < digest.html.indexOf('Linked, badge live') && digest.html.indexOf('Linked, badge live') < digest.html.indexOf('Waiting for a person'));
check('review: links to Verification', digest.html.includes('https://medsociety.one/admin?tab=verification'));
check('review: names are escaped', !digest.html.includes('<b>Ejemplo</b>') && digest.html.includes('&lt;b&gt;'));
check('review: says the band it used', digest.html.includes('70-89'));
const decided = renderReviewDigest([near({ external_id: 'a' }), near({ external_id: 'd', name: 'Decidido Por Persona', linked: false, status: 'confirmed', score: 75 })], 'https://medsociety.one', { low: 70, high: 89 });
check('review: a record a person already confirmed is left out', !decided.html.includes('Decidido Por Persona') && decided.subject.includes('1 AI match '), decided.subject);
check('review: band parses, and a bad one falls back to 70-89',
    JSON.stringify(parseBand('75-85')) === '{"low":75,"high":85}' && JSON.stringify(parseBand('90-10')) === '{"low":70,"high":89}' && JSON.stringify(parseBand(undefined)) === '{"low":70,"high":89}');

// ── Stubbed network ─────────────────────────────────────────────────────────
interface Call { url: string; body: Record<string, unknown> | null; headers: Record<string, string> }
let calls: Call[] = [];
let queue: QueuedEmail[] = [];
let userOk = true;
let failSendTo: string | null = null;
let nearBar: NearBarItem[] = [];

globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/auth/v1/user')) return userOk ? reply(200, { id: 'u-1' }) : reply(401, {});
    if (url.endsWith('/rpc/claim_emails_take')) { const q = queue; queue = []; return reply(200, q); }
    if (url.endsWith('/rpc/claim_emails_done')) return new Response(null, { status: 204 });
    if (url.endsWith('/rpc/review_near_bar')) return reply(200, nearBar);
    if (url.endsWith('/contacts/upsert')) return reply(200, { contact: { id: `ct-${String(body?.email)}` } });
    if (url.endsWith('/conversations/messages')) {
        const contact = String(body?.contactId ?? '');
        if (failSendTo && contact.includes(failSendTo)) return reply(422, { message: 'email service not set up' });
        return reply(200, { messageId: `m-${contact}` });
    }
    return reply(404, {});
}) as typeof fetch;

interface Out { code: number; body: unknown }
async function call(method: string, headers: Record<string, string>, query: Record<string, string> = {}): Promise<Out> {
    let code = 0; let out: unknown = null;
    const res = {
        statusCode: 200,
        setHeader: () => undefined,
        status(c: number) { code = c; return res; },
        json(b: unknown) { out = b; },
    };
    await handler({ method, headers, query } as never, res as never);
    return { code, body: out };
}
const dones = () => calls.filter((c) => c.url.endsWith('/rpc/claim_emails_done')).map((c) => c.body);

console.log('handler');
(async () => {
    let r = await call('POST', {});
    check('POST without a token is refused', r.code === 401, r);
    userOk = false;
    r = await call('POST', { authorization: 'Bearer abc.def' });
    check('POST with a bad token is refused', r.code === 401, r);
    userOk = true;
    r = await call('GET', { authorization: 'Bearer wrong' });
    check('cron GET with the wrong secret is refused', r.code === 401, r);
    r = await call('PUT', {});
    check('other methods get 405', r.code === 405, r);

    calls = [];
    queue = [
        { ...base, id: 'e-1', kind: 'claimant_received' },
        { ...base, id: 'e-2', kind: 'team_new_claim' },
        { ...base, id: 'e-3', kind: 'claimant_approved', claimant_email: null },
    ];
    r = await call('POST', { authorization: 'Bearer abc.def' });
    check('drain reports sent / skipped', r.code === 200 && JSON.stringify(r.body) === JSON.stringify({ sent: 2, failed: 0, skipped: 1 }), r);
    const sends = calls.filter((c) => c.url.endsWith('/conversations/messages'));
    check('one claimant send + two team sends', sends.length === 3, sends.length);
    check('claimant address is lower-cased', calls.some((c) => c.url.endsWith('/contacts/upsert') && c.body?.email === 'doc@example.com'));
    check('invalid team address is ignored', !calls.some((c) => c.body?.email === 'not-an-email'));
    check('upsert never sends tags (billing tags stay intact)', calls.filter((c) => c.url.endsWith('/contacts/upsert')).every((c) => !('tags' in (c.body ?? {}))));
    check('upsert uses the location', calls.filter((c) => c.url.endsWith('/contacts/upsert')).every((c) => c.body?.locationId === 'loc-1'));
    check('messages use API version 2021-04-15', sends.every((c) => c.headers.Version === '2021-04-15'));
    check('messages are e-mails', sends.every((c) => c.body?.type === 'Email' && typeof c.body?.html === 'string'));
    const d = dones();
    check('both sent rows marked done', d.filter((x) => x?.p_ok === true).length === 2, d);
    check('row without an address recorded as failed', d.some((x) => x?.p_id === 'e-3' && x?.p_ok === false && String(x?.p_error).includes('no e-mail')), d);
    check('service role used for the database', calls.filter((c) => c.url.includes('/rest/v1/rpc/')).every((c) => c.headers.Authorization === 'Bearer service-key'));

    calls = [];
    failSendTo = 'doc@example.com';
    queue = [{ ...base, id: 'e-9', kind: 'claimant_needs_info', review_note: 'more please' }];
    r = await call('GET', { authorization: 'Bearer cron-secret' });
    check('cron drain counts a GHL failure', r.code === 200 && (r.body as { failed: number }).failed === 1, r);
    check('the failure is recorded with GHL\'s reason', dones().some((x) => x?.p_id === 'e-9' && x?.p_ok === false && String(x?.p_error).includes('422')), dones());
    failSendTo = null;

    // job=review: one digest to REVIEW_ALERT_TO, only when something is near the bar.
    calls = [];
    nearBar = [];
    r = await call('GET', { authorization: 'Bearer cron-secret' }, { job: 'review' });
    const nothing = calls.filter((c) => c.url.endsWith('/conversations/messages')).length;
    check('review: nothing near the bar sends nothing', r.code === 200 && (r.body as { items: number }).items === 0 && nothing === 0, r);
    calls = [];
    nearBar = [near({ linked: false, status: 'confirmed' })];
    r = await call('GET', { authorization: 'Bearer cron-secret' }, { job: 'review' });
    check('review: only already-decided records sends nothing', r.code === 200 && (r.body as { items: number }).items === 0 && !calls.some((c) => c.url.endsWith('/conversations/messages')), r);
    calls = [];
    nearBar = [near({}), near({ external_id: 'b', score: 75, linked: false })];
    r = await call('GET', { authorization: 'Bearer cron-secret' }, { job: 'review' });
    const reviewSends = calls.filter((c) => c.url.endsWith('/conversations/messages'));
    check('review: one e-mail to REVIEW_ALERT_TO', r.code === 200 && reviewSends.length === 1 && calls.some((c) => c.url.endsWith('/contacts/upsert') && c.body?.email === 'david@example.com'), r);
    const asked = calls.find((c) => c.url.endsWith('/rpc/review_near_bar'))?.body;
    check('review: asks for the last day, band 70-89', asked?.p_low === 70 && asked?.p_high === 89 && Date.now() - Date.parse(String(asked?.p_since)) > 23 * 3600_000, asked);
    check('review: the claim queue is not drained by it', !calls.some((c) => c.url.endsWith('/rpc/claim_emails_take')));
    r = await call('GET', { authorization: 'Bearer wrong' }, { job: 'review' });
    check('review: the wrong cron secret is refused', r.code === 401, r);
    r = await call('POST', { authorization: 'Bearer abc.def' }, { job: 'review' });
    check('review: a signed-in POST cannot trigger it', r.code === 405, r);

    delete process.env.GHL_PIT_MEDSOCIETY;
    r = await call('POST', { authorization: 'Bearer abc.def' });
    check('missing GHL token answers 503', r.code === 503, r);

    console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
})();
