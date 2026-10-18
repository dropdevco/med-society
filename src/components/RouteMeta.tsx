import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SITE_ORIGIN, upsertLink, upsertMeta } from '../utils/headTags';

/** Pages with nothing for a search engine or an agent to read: accounts and internal tools. */
const PRIVATE = /^\/(login|dashboard|claim|admin)(\/|$)/;

/**
 * Renders nothing. Keeps two head tags truthful as the visitor moves around
 * the app: the canonical URL of the page on screen (so a shared or crawled
 * address always names one document), and `noindex` on the private areas.
 *
 * The server-rendered document (api/agent.ts) sets the same tags for the first
 * load; this covers every navigation after it.
 */
export function RouteMeta() {
    const { pathname, search } = useLocation();

    useEffect(() => {
        // The home page's search is the same document at many addresses; only the
        // region, the one thing that changes which directory it is, is canonical.
        const region = pathname === '/' ? new URLSearchParams(search).get('region') : null;
        const canonical = `${SITE_ORIGIN}${pathname === '/' ? '/' : pathname.replace(/\/$/, '')}${region ? `?region=${encodeURIComponent(region)}` : ''}`;
        const undo = [upsertLink('canonical', canonical), upsertMeta('property', 'og:url', canonical)];
        if (PRIVATE.test(pathname)) undo.push(upsertMeta('name', 'robots', 'noindex, nofollow'));
        return () => { undo.forEach((fn) => fn()); };
    }, [pathname, search]);

    return null;
}
