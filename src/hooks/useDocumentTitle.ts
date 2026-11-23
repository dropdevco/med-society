import { useEffect } from 'react';
import { upsertMeta } from '../utils/headTags';

/**
 * The browser tab title (and optionally the meta description and `noindex`)
 * for a page while it is on screen, given back when it unmounts.
 *
 * Browsers get the app shell, whose title is the home page's; the server sets a
 * page's own title only for crawlers and agents (api/agent.ts, route=page). So a
 * page without this wears the home title in the tab, in history and in
 * bookmarks.
 */
export function useDocumentTitle(title: string, opts: { description?: string; noindex?: boolean } = {}) {
    const { description, noindex } = opts;
    useEffect(() => {
        const previous = document.title;
        document.title = title;
        const undo: (() => void)[] = [];
        if (description) undo.push(upsertMeta('name', 'description', description));
        if (noindex) undo.push(upsertMeta('name', 'robots', 'noindex, nofollow'));
        return () => {
            document.title = previous;
            undo.forEach((fn) => fn());
        };
    }, [title, description, noindex]);
}
