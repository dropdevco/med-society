import type { Provider } from '../types/provider';
import { track } from '../lib/posthog';

/**
 * Track a click on a provider in a list or on the map (the listing, not the
 * profile page itself, so a shared link does not count as search demand).
 */
export function trackProviderClick(provider: Provider, from: 'search' | 'map' = 'search'): void {
    if (import.meta.env.DEV) {
        console.log(`[analytics] click: ${provider.id} — ${provider.name}`);
    }
    track('provider_clicked', providerProps(provider, { from }));
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
