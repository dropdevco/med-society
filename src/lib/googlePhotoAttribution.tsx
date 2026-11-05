/**
 * Renders the photographer credit the Google Places SDK supplies with each
 * photo, which the Maps Platform terms require us to display.
 *
 * Google hands it over as pre-built anchor markup (`photo.html_attributions`),
 * so the obvious move is `dangerouslySetInnerHTML`. That works, and it is not
 * user input — it comes from the Places response, not from a provider or a
 * visitor. But it does mean every provider page renders third-party HTML
 * verbatim, and the only thing standing between that and script execution is
 * Google's own escaping. Nothing in our code would notice if that field ever
 * carried something else, and a provider profile is the last place we want to
 * find out.
 *
 * So we don't render HTML at all. The markup is parsed, the links are pulled
 * out, and real React elements are emitted. Anything that is not a link or
 * text is reduced to its text, which means there is no path from the response
 * into the DOM as markup — the vector is removed rather than filtered, and no
 * sanitizer dependency has to be kept current.
 */

import type { ReactNode } from 'react';

/** Strips tags when there is no DOM to parse with (SSR, tests, prerender). */
function textOnly(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Only absolute https URLs survive. This rejects `javascript:` and `data:`
 * hrefs, which are the reason an anchor is worth validating at all.
 */
function safeHref(raw: string | null): string | null {
    if (!raw) return null;
    try {
        const url = new URL(raw, 'https://maps.google.com');
        return url.protocol === 'https:' ? url.toString() : null;
    } catch {
        return null;
    }
}

/**
 * Turns Google's attribution markup into React nodes.
 *
 * Attributions for several photos arrive already joined with a separator, so
 * the input is a short run of anchors and plain text. Both are preserved; an
 * anchor whose href does not survive {@link safeHref} keeps its text and loses
 * the link, so the credit is still shown.
 */
export function googlePhotoAttribution(html: string | undefined): ReactNode[] {
    if (!html) return [];
    if (typeof DOMParser === 'undefined') {
        const text = textOnly(html);
        return text ? [text] : [];
    }

    // parseFromString builds an inert document: no scripts run, no subresources
    // are fetched, and nothing is attached to the live DOM.
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const nodes: ReactNode[] = [];
    let key = 0;

    for (const node of Array.from(parsed.body.childNodes)) {
        if (node.nodeType === 3) {
            if (node.textContent) nodes.push(node.textContent);
            continue;
        }

        const text = node.textContent?.trim();
        if (!text) continue;

        if (node.nodeName === 'A') {
            const href = safeHref((node as Element).getAttribute('href'));
            nodes.push(
                href
                    ? (
                        <a
                            key={key++}
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                        >
                            {text}
                        </a>
                    )
                    : text,
            );
            continue;
        }

        // Any other element contributes its text and nothing else.
        nodes.push(text);
    }

    return nodes;
}
