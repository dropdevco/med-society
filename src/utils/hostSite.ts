/**
 * Which stand-alone site this host serves, if any.
 *
 * acerbac.medsociety.one is rewritten to index.html by middleware.ts; the app
 * then renders only the ACERBAC page, whatever the path. acerbac.localhost
 * does the same in development (browsers resolve *.localhost to 127.0.0.1).
 */
export type HostSite = 'acerbac';

/** Keep in step with APP_SITES in middleware.ts. */
const APP_SITE_HOSTS: Record<string, HostSite> = { acerbac: 'acerbac' };

export function hostSite(hostname: string = typeof window === 'undefined' ? '' : window.location.hostname): HostSite | null {
    const first = hostname.toLowerCase().split('.')[0];
    const rest = hostname.toLowerCase().slice(first.length + 1);
    if (rest !== 'medsociety.one' && rest !== 'localhost') return null;
    return APP_SITE_HOSTS[first] ?? null;
}

/** The main directory, absolute when we are on a stand-alone site's host. */
export function directoryUrl(path = '/'): string {
    // www, not the apex: medsociety.one redirects to www, so this skips a hop.
    return hostSite() ? `https://www.medsociety.one${path}` : path;
}
