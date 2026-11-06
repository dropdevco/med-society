/**
 * Lets the Supabase client talk to the sandbox's PostgREST: strips the
 * /rest/v1 prefix and the auth headers Supabase's gateway would consume.
 * Sandbox only.
 *   npx tsx scripts/sources/sandbox/proxy.ts      # http://127.0.0.1:54331
 */
import * as http from 'http';

const server = http.createServer((req, res) => {
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
