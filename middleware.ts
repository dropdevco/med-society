/**
 * Sends <subdomain>.medsociety.one to the doctor-website renderer in api/agent.ts.
 *
 * This has to be middleware rather than a `has: host` rewrite in vercel.json:
 * rewrites run after the filesystem, so on a subdomain `/` would be answered by
 * the app's index.html before any rewrite was looked at.
 *
 * Everything that is not a doctor's subdomain (the apex, www, *.vercel.app
 * previews) falls through untouched.
 */
import { rewrite } from '@vercel/functions';

export const config = {
    matcher: '/((?!api/|ingest/).*)',
};

const ROOT = '.medsociety.one';

export default function middleware(request: Request): Response | undefined {
    const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
    if (!host.endsWith(ROOT)) return undefined;
    const sub = host.slice(0, -ROOT.length);
    if (!sub || sub === 'www' || sub.includes('.')) return undefined;

    const url = new URL(request.url);
    const target = new URL('/api/agent', url);
    target.searchParams.set('route', 'site');
    target.searchParams.set('sub', sub);
    target.searchParams.set('path', url.pathname);
    const lang = url.searchParams.get('lang');
    if (lang) target.searchParams.set('lang', lang);
    return rewrite(target);
}
