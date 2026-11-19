/**
 * Sends <subdomain>.medsociety.one to the doctor-website renderer in api/agent.ts.
 *
 * This has to be middleware rather than a `has: host` rewrite in vercel.json:
 * rewrites run after the filesystem, so on a subdomain `/` would be answered by
 * the app's index.html before any rewrite was looked at.
 *
 * Everything that is not a doctor's subdomain (the apex, www, *.vercel.app
 * previews) falls through untouched.
 *
 * APP_SITES are subdomains served by the React app itself (src/utils/hostSite.ts
 * picks the page from the host). They are checked before doctor sites, so a
 * doctor_sites row with the same subdomain can never take one over. Each has its
 * own static files in public/ and its own HTML entry at the repo root:
 *   /<sub>.html          page entry, with the head crawlers read (title, canonical, JSON-LD)
 *   /<sub>-robots.txt    served as /robots.txt on that host
 *   /<sub>-sitemap.xml   served as /sitemap.xml on that host
 */
import { rewrite } from '@vercel/functions';

export const config = {
    matcher: '/((?!api/|ingest/).*)',
};

const ROOT = '.medsociety.one';

/** Keep in step with APP_SITE_HOSTS in src/utils/hostSite.ts. */
const APP_SITES = new Set(['acerbac']);

/** Built files (/assets/…, /fonts/…, /favicon.svg) are served as they are. */
const isFile = (path: string) => /\.[a-z0-9]{2,8}$/i.test(path);

export default function middleware(request: Request): Response | undefined {
    const host = (request.headers.get('host') ?? '').split(':')[0].toLowerCase();
    if (!host.endsWith(ROOT)) return undefined;
    const sub = host.slice(0, -ROOT.length);
    if (!sub || sub === 'www' || sub.includes('.')) return undefined;

    const url = new URL(request.url);

    if (APP_SITES.has(sub)) {
        if (url.pathname === '/robots.txt') return rewrite(new URL(`/${sub}-robots.txt`, url));
        if (url.pathname === '/sitemap.xml') return rewrite(new URL(`/${sub}-sitemap.xml`, url));
        if (isFile(url.pathname)) return undefined;
        // Any page path gets the site's own HTML entry; the app reads the host.
        // Going straight to the file also skips vercel.json's crawler prerender of
        // "/", which would otherwise show bots the MedSociety home page.
        return rewrite(new URL(`/${sub}.html`, url));
    }

    const target = new URL('/api/agent', url);
    target.searchParams.set('route', 'site');
    target.searchParams.set('sub', sub);
    target.searchParams.set('path', url.pathname);
    const lang = url.searchParams.get('lang');
    if (lang) target.searchParams.set('lang', lang);
    return rewrite(target);
}
