import type { Provider } from '../types/provider';
import { track } from '../lib/posthog';

/**
 * Track a click on a provider in a list or on the map (the listing, not the
 * profile page itself, so a shared link does not count as search demand).
 */
export function trackProviderClick(
    provider: Provider,
    from: 'search' | 'map' = 'search',
    /** 1-based place in the result list when it was clicked, if it was in one. */
    position?: number,
): void {
    if (import.meta.env.DEV) {
        console.log(`[analytics] click: ${provider.id} — ${provider.name}`);
    }
    track('provider_clicked', providerProps(provider, {
        from,
        ...(position && position > 0 ? { position } : {}),
    }));
}

/** How many results from the top of a list count as "shown". */
export const IMPRESSION_DEPTH = 20;
/** The same listing is not counted as shown again to the same visitor inside this window. */
const IMPRESSION_WINDOW_MS = 30 * 60 * 1000;
const seenAt = new Map<string, number>();

/**
 * Record that these listings were put in front of a visitor by a search.
 *
 * One event per settled search, carrying `id:position` pairs, not one event per
 * listing: a page of results would otherwise be twenty events, and the monthly
 * event bill would be set by the length of the list rather than by anything a
 * doctor cares about. Panning the map re-runs the search, so a listing is only
 * counted again after half an hour; otherwise a visitor dragging the map back
 * and forth would give every clinic in view a hundred "impressions".
 */
export function trackImpressions(
    results: readonly Provider[],
    context: { surface: 'list' | 'map'; region: string; specialties: readonly string[]; mode: 'smart' | 'keyword' },
): void {
    const now = Date.now();
    const fresh: string[] = [];
    results.slice(0, IMPRESSION_DEPTH).forEach((p, i) => {
        const last = seenAt.get(p.id);
        if (last !== undefined && now - last < IMPRESSION_WINDOW_MS) return;
        seenAt.set(p.id, now);
        fresh.push(`${p.id}:${i + 1}`);
    });
    if (fresh.length === 0) return;
    track('provider_impressions', {
        ids: fresh.join(','),
        count: fresh.length,
        surface: context.surface,
        region: context.region,
        specialties: context.specialties,
        mode: context.mode,
    });
}

/** The parts of a profile whose reach is reported to the doctor. */
export type ProfileSection = 'photos' | 'insurance' | 'inquiry' | 'reviews' | 'contact' | 'services' | 'map';

/** One call per section per profile view; the caller guards against repeats. */
export function trackSectionView(provider: Provider, section: ProfileSection): void {
    track('provider_section_viewed', { provider_id: provider.id, section });
}

/**
 * Track one view of a provider's profile — the number shown to doctors as
 * "profile views". Unlike `provider_clicked`, this counts every way in: a
 * click from search or the map, a shared link, a bookmark, a search engine.
 * `via` says whether it opened as a modal over the directory or as its own
 * page. Count distinct people per `provider_id` for unique views.
 */
export function trackProviderView(provider: Provider, via: 'modal' | 'page'): void {
    track('provider_viewed', providerProps(provider, { via }));
}

/** The non-sensitive facts about a listing that every provider event carries. */
export function providerProps(p: Provider, extra?: Record<string, unknown>): Record<string, unknown> {
    return {
        provider_id: p.id,
        provider_name: p.name,
        specialty: p.specialty,
        country: p.country,
        city: p.city,
        tier: p.tier,
        promoted: p.promoted,
        source: p.source,
        ...extra,
    };
}

export type ContactMethod = 'phone' | 'email' | 'website' | 'directions' | 'whatsapp' | 'social';

/** What a link on a profile is, judged from its href; null for in-app links. */
export function contactMethodOf(href: string): ContactMethod | null {
    if (href.startsWith('tel:')) return 'phone';
    if (href.startsWith('mailto:')) return 'email';
    let u: URL;
    try { u = new URL(href, window.location.origin); } catch { return null; }
    if (u.origin === window.location.origin) return null;
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'wa.me' || host.endsWith('whatsapp.com')) return 'whatsapp';
    if (host.includes('google.') && u.pathname.startsWith('/maps')) return 'directions';
    if (/(facebook|instagram|tiktok|linkedin|youtube|x|twitter)\.com$|^youtu\.be$/.test(host)) return 'social';
    return 'website';
}
