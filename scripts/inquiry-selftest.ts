/**
 * Checks for api/inquiry.ts: a patient needs an account to message a clinic.
 * Runs the real handler with `fetch` stubbed, so nothing reaches Supabase,
 * Resend or the network.
 *
 *   npx tsx scripts/inquiry-selftest.ts
 */
import handler, { bearerToken, getAuthUser } from '../api/inquiry';

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.VITE_SUPABASE_ANON_KEY = 'anon-key';
process.env.RESEND_API_KEY = 'resend-key';
process.env.LEAD_NOTIFY_FROM = 'MedSociety <hi@example.com>';
process.env.LEAD_NOTIFY_TO = 'team@example.com';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

// ── stubbed network ─────────────────────────────────────────────────────────
interface Call { url: string; init?: RequestInit }
let calls: Call[] = [];
let authReply: { status: number; body: unknown } = { status: 200, body: {} };
let authThrows = false;

const USER_ID = '3f2b8c1e-5a47-4d0b-9c63-1e2d4f6a8b90';
const goodUser = { id: USER_ID, email: 'patient@example.com', email_confirmed_at: '2026-10-01T00:00:00Z', is_anonymous: false };

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/auth/v1/user')) {
        if (authThrows) throw new Error('network down');
        return new Response(JSON.stringify(authReply.body), { status: authReply.status });
    }
    if (url.includes('/rest/v1/patient_inquiries')) return new Response('', { status: 201 });
    if (url.includes('api.resend.com')) return new Response('{}', { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
}) as typeof fetch;

const reset = (reply = { status: 200, body: goodUser as unknown }) => {
    calls = [];
    authReply = reply;
    authThrows = false;
};
const called = (needle: string) => calls.filter((c) => c.url.includes(needle));

// ── fake request / response ─────────────────────────────────────────────────
let ipCounter = 0;
async function post(opts: { token?: string | null; body?: unknown; ip?: string; method?: string } = {}) {
    const headers: Record<string, string> = {};
    if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? 'valid.jwt.token'}`;
    const req = {
        method: opts.method ?? 'POST',
        headers,
        body: opts.body ?? validBody(),
        socket: { remoteAddress: opts.ip ?? `10.0.0.${++ipCounter}` },
    };
    const out: { code: number; json: { ok?: boolean; error?: string } | null } = { code: 0, json: null };
    const res = {
        setHeader() {},
        status(code: number) { out.code = code; return res; },
        json(b: unknown) { out.json = b as typeof out.json; },
    };
    await handler(req as unknown as Parameters<typeof handler>[0], res as unknown as Parameters<typeof handler>[1]);
    return out;
}

function validBody(over: Record<string, unknown> = {}) {
    return {
        providerId: '4ab36f31-0e06-4bf7-9ea5-9c2564c4270b',
        providerName: 'Grupo IMAGINEM',
        name: 'Ana López',
        contact: 'ana@example.com',
        message: 'How much does a first visit cost?',
        preferredTime: 'morning',
        language: 'en',
        sourceUrl: 'https://medsociety.one/providers/4ab36f31',
        website: '',
        ...over,
    };
}

async function main() {
    console.log('\nbearerToken');
    check('plain token', bearerToken('Bearer abc.def.ghi') === 'abc.def.ghi');
    check('case-insensitive scheme is NOT accepted (Bearer only)', bearerToken('bearer abc') === null);
    check('missing header', bearerToken(undefined) === null);
    check('empty token', bearerToken('Bearer ') === null);
    check('no scheme', bearerToken('abc.def.ghi') === null);
    check('injection-y value', bearerToken('Bearer abc def') === null && bearerToken('Bearer a;b') === null);
    check('array header uses the first', bearerToken(['Bearer one', 'Bearer two']) === 'one');

    console.log('\ngetAuthUser');
    reset();
    check('good user', (await getAuthUser('t', 'https://x.co', 'k'))?.email === 'patient@example.com');
    check('asks /auth/v1/user with the user token and the apikey', (() => {
        const c = called('/auth/v1/user')[0];
        const h = (c.init?.headers ?? {}) as Record<string, string>;
        return c.url === 'https://x.co/auth/v1/user' && h.Authorization === 'Bearer t' && h.apikey === 'k';
    })());
    reset({ status: 401, body: { msg: 'bad jwt' } });
    check('rejected token → null', (await getAuthUser('t', 'https://x.co', 'k')) === null);
    reset({ status: 200, body: { ...goodUser, is_anonymous: true } });
    check('anonymous sign-in → null', (await getAuthUser('t', 'https://x.co', 'k')) === null);
    reset({ status: 200, body: { ...goodUser, email_confirmed_at: null } });
    check('unconfirmed email → null', (await getAuthUser('t', 'https://x.co', 'k')) === null);
    reset({ status: 200, body: { ...goodUser, email: undefined } });
    check('no email → null', (await getAuthUser('t', 'https://x.co', 'k')) === null);
    reset({ status: 200, body: { ...goodUser, id: 'not-a-uuid' } });
    check('malformed id → null', (await getAuthUser('t', 'https://x.co', 'k')) === null);
    reset();
    authThrows = true;
    check('auth service unreachable → null (fails closed)', (await getAuthUser('t', 'https://x.co', 'k')) === null);

    console.log('\nhandler: the account gate');
    reset();
    let r = await post({ token: null });
    check('no Authorization header → 401', r.code === 401 && r.json?.error === 'auth_required', r);
    check('…and nothing was called (no auth lookup, no insert, no email)', calls.length === 0, calls.map((c) => c.url));

    reset();
    r = await post({ token: 'bad token with spaces' });
    check('malformed header → 401', r.code === 401, r);
    check('…without calling anything', calls.length === 0);

    reset({ status: 401, body: { msg: 'invalid JWT' } });
    r = await post();
    check('token Supabase rejects → 401', r.code === 401 && r.json?.error === 'auth_required', r);
    check('…and nothing was stored or emailed', called('/rest/v1/').length === 0 && called('resend').length === 0);

    reset({ status: 200, body: { ...goodUser, is_anonymous: true } });
    r = await post();
    check('anonymous sign-in → 401', r.code === 401 && called('/rest/v1/').length === 0, r);

    reset({ status: 200, body: { ...goodUser, email_confirmed_at: null } });
    r = await post();
    check('unconfirmed account → 401', r.code === 401 && called('/rest/v1/').length === 0, r);

    reset();
    authThrows = true;
    r = await post();
    check('auth service down → 401, nothing stored', r.code === 401 && called('/rest/v1/').length === 0, r);

    console.log('\nhandler: a signed-in patient');
    reset();
    r = await post();
    check('valid token + valid body → 200', r.code === 200 && r.json?.ok === true, r);
    const ins = called('/rest/v1/patient_inquiries')[0];
    const stored = ins ? JSON.parse(String(ins.init?.body)) : null;
    check('row is stored with the account id', stored?.user_id === USER_ID, stored);
    check('row keeps the question and who to answer', stored?.message === 'How much does a first visit cost?' && stored?.contact === 'ana@example.com' && stored?.patient_name === 'Ana López', stored);
    check('insert uses the service role, not the patient token', (ins.init?.headers as Record<string, string>).Authorization === 'Bearer service-key');
    const auth = called('/auth/v1/user')[0];
    check('token is verified with the anon key', (auth.init?.headers as Record<string, string>).apikey === 'anon-key');
    const mail = called('resend')[0];
    const mailBody = mail ? JSON.parse(String(mail.init?.body)) : null;
    check('team email shows the verified account', mailBody?.text.includes('Account: patient@example.com'), mailBody?.text);
    check('reply-to is the chosen contact when it is an email', mailBody?.reply_to === 'ana@example.com', mailBody?.reply_to);

    reset();
    r = await post({ body: validBody({ contact: '(619) 555-0123' }) });
    const mail2 = called('resend')[0];
    check('phone contact → reply-to falls back to the account email', r.code === 200 && JSON.parse(String(mail2.init?.body)).reply_to === 'patient@example.com');

    reset();
    r = await post({ body: validBody({ website: 'http://spam.example' }) });
    check('honeypot filled → looks like success, stores nothing', r.code === 200 && called('/rest/v1/').length === 0 && called('/auth/v1/').length === 0, r);

    reset();
    r = await post({ body: validBody({ contact: 'nope' }) });
    check('invalid body → 400', r.code === 400 && r.json?.error === 'bad_contact', r);
    check('…rejected before any auth round trip', called('/auth/v1/').length === 0);

    reset();
    r = await post({ method: 'GET' });
    check('GET → 405', r.code === 405, r);

    console.log('\nhandler: one account, one allowance');
    // A fresh account: the allowance is shared state, and USER_ID has already sent a few above.
    reset({ status: 200, body: { ...goodUser, id: '11111111-2222-4333-8444-555555555555', email: 'fresh@example.com' } });
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post({ ip: `192.0.2.${i + 1}` })).code); // a new IP every time
    check('5 messages go through, then 429 for the same account from fresh IPs', codes.slice(0, 5).every((c) => c === 200) && codes.slice(5).every((c) => c === 429), codes);

    reset({ status: 200, body: { ...goodUser, id: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d', email: 'other@example.com' } });
    r = await post({ ip: '198.51.100.9' });
    check('a different account is not affected', r.code === 200, r);

    console.log(failures ? `\n${failures} failing` : '\nall checks passed');
    process.exit(failures ? 1 : 0);
}

main();
