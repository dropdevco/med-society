/**
 * Serves the built `dist/` with the real headers from `vercel.json`, so the
 * Content-Security-Policy can be exercised in a browser before it ships.
 *
 * The CSP is enforcing in production: a missing origin blocks the request
 * rather than warning, so breakage reaches visitors rather than a report. This
 * is the cheap way to find that out first. It caught two such breakages when
 * the policy was introduced — see docs/security-headers.md.
 *
 *   npm run build
 *   node scripts/csp-preview.mjs
 *
 * Then open the printed URL and read the console. Any "violates the following
 * Content Security Policy directive" error is something that will be broken in
 * production, with one known exception: `c.bing.com` is blocked on purpose
 * (docs/security-headers.md explains why).
 *
 * Caveats — this serves static files only, so it does not run the `vercel.json`
 * rewrites. `/api/*` and the `/ingest/*` PostHog proxy will 404, and the
 * prerendered agent routes are not exercised. Neither is a CSP failure.
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4199);

if (!existsSync(DIST)) {
    console.error(`No build found at ${DIST}\nRun \`npm run build\` first.`);
    process.exit(1);
}

const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
const globalHeaders = (vercel.headers ?? [])
    .filter((entry) => entry.source === '/(.*)')
    .flatMap((entry) => entry.headers);

if (!globalHeaders.length) {
    console.error('No global headers found in vercel.json under source "/(.*)".');
    process.exit(1);
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
};

createServer((req, res) => {
    for (const header of globalHeaders) res.setHeader(header.key, header.value);

    // No caching, so a restart with an edited policy is picked up immediately
    // rather than served from the browser's cache with the old header.
    res.setHeader('Cache-Control', 'no-store');

    const { pathname } = new URL(req.url, 'http://localhost');
    const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');

    if (relative.includes('..')) {
        res.writeHead(400).end('bad path');
        return;
    }

    const requested = join(DIST, relative);
    const isFile = existsSync(requested) && statSync(requested).isFile();
    // SPA fallback, mirroring the `/((?!api/).*) -> /index.html` rewrite.
    const file = isFile ? requested : join(DIST, 'index.html');

    if (!existsSync(file)) {
        res.writeHead(404).end('not found');
        return;
    }

    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
    res.writeHead(200).end(readFileSync(file));
}).listen(PORT, () => {
    console.log('Serving dist/ with vercel.json headers:\n');
    for (const header of globalHeaders) {
        console.log(`  ${header.key}`);
    }
    console.log(`\n  http://localhost:${PORT}/\n`);
    console.log('Open it and read the console. Expect exactly one blocked');
    console.log('image: c.bing.com (deliberate — docs/security-headers.md).');
});
