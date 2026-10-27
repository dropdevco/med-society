/**
 * Small, reversible edits to <head> for the page that is on screen.
 *
 * The site is a single-page app, so the document the server sent describes
 * only the first URL a visitor (or an agent) landed on. Every helper here
 * returns an undo function, so a page can borrow a tag while it is mounted and
 * give it back — the same contract as usePageMeta's title handling.
 */

/** Canonical origin. Not window.location: a preview or localhost must not canonicalise to itself. */
export const SITE_ORIGIN = 'https://www.medsociety.one';

/** Set a <meta> tag's content (creating the tag if needed); returns the undo. */
export function upsertMeta(attr: 'name' | 'property', key: string, content: string): () => void {
    let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
    const created = !el;
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    const previous = el.getAttribute('content');
    el.setAttribute('content', content);
    return () => {
        if (created) el?.remove();
        else if (previous !== null) el?.setAttribute('content', previous);
    };
}

/** Set <link rel=… href=…> (creating it if needed); returns the undo. */
export function upsertLink(rel: string, href: string): () => void {
    let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
    const created = !el;
    if (!el) {
        el = document.createElement('link');
        el.rel = rel;
        document.head.appendChild(el);
    }
    const previous = el.getAttribute('href');
    el.setAttribute('href', href);
    return () => {
        if (created) el?.remove();
        else if (previous !== null) el?.setAttribute('href', previous);
    };
}

/** Add a JSON-LD block with a stable id (replacing one from before); returns the undo. */
export function upsertJsonLd(id: string, data: unknown): () => void {
    document.getElementById(id)?.remove();
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = id;
    // `<` can never end the script early inside a JSON string once escaped.
    el.textContent = JSON.stringify(data).replace(/</g, '\u003c');
    document.head.appendChild(el);
    return () => { el.remove(); };
}
