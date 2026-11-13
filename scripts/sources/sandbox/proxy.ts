/**
 * Lets the Supabase client talk to the sandbox's PostgREST: strips the
 * /rest/v1 prefix and the auth headers Supabase's gateway would consume, and
 * answers sign-in for one made-up reviewer so /admin can be walked in a
 * browser. Sandbox only: it listens on this machine and knows nothing real.
 *   npx tsx scripts/sources/sandbox/proxy.ts      # http://127.0.0.1:54331
 *   sign in at /admin with reviewer@sandbox.test / sandbox-only
 */
import * as http from 'http';

const REVIEWER = {
    id: '00000000-0000-4000-8000-00000000aaaa', aud: 'authenticated', role: 'authenticated', email: 'reviewer@sandbox.test',
    app_metadata: { provider: 'email' }, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
};
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function session() {
    const expires_at = Math.floor(Date.now() / 1000) + 3600;
    const access_token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: REVIEWER.id, role: 'authenticated', exp: expires_at, email: REVIEWER.email })}.sandbox`;
    return { access_token, token_type: 'bearer', expires_in: 3600, expires_at, refresh_token: 'sandbox', user: REVIEWER };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

function send(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'content-type': 'application/json', ...CORS });
    res.end(JSON.stringify(body));
}

/** True when the request was for the sign-in service. */
function answerAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const url = req.url ?? '/';
    if (!url.startsWith('/auth/v1')) return false;
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
    if (url.startsWith('/auth/v1/user')) { send(res, 200, REVIEWER); return true; }
    if (url.startsWith('/auth/v1/logout')) { res.writeHead(204, CORS); res.end(); return true; }
    if (url.startsWith('/auth/v1/token')) {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const body = JSON.parse(raw || '{}') as { email?: string; password?: string; refresh_token?: string };
            const ok = url.includes('grant_type=refresh_token') ? body.refresh_token === 'sandbox' : body.email === REVIEWER.email && body.password === 'sandbox-only';
            if (ok) send(res, 200, session());
            else send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
        });
        return true;
    }
    send(res, 404, { msg: 'not available in the sandbox' });
    return true;
}

const server = http.createServer((req, res) => {
    if (answerAuth(req, res)) return;
    const headers = { ...req.headers };
    delete headers.authorization;
    delete headers.apikey;
    delete headers.host;
    const upstream = http.request({
        host: '127.0.0.1', port: 54330, method: req.method, headers,
        path: (req.url ?? '/').replace(/^\/rest\/v1/, ''),
    }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    upstream.on('error', (err) => { res.writeHead(502); res.end(err.message); });
    req.pipe(upstream);
});
server.listen(54331, '127.0.0.1', () => console.log('sandbox proxy on http://127.0.0.1:54331'));
