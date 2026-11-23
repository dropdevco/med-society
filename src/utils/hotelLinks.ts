import type { Hotel } from '../types/hotel';

/**
 * Where "Check rates" goes, and the one place commission is added. How to get
 * the affiliate link: docs/booking-affiliate.md.
 *
 * Two ways, both set in Vercel and both optional:
 *   VITE_HOTEL_AFFILIATE_LINK   a network deep link with `{url}` where the
 *                               destination goes, e.g. a CJ link
 *                               "https://www.anrdoezrs.net/click-123-456?url={url}".
 *                               Booking.com now signs new affiliates up through
 *                               CJ, so this is the one to use.
 *   VITE_BOOKING_AFFILIATE_ID   the `aid` of the old direct programme, added to
 *                               booking.com URLs. Ignored when the template is set.
 * With neither, links work and earn nothing.
 */
export interface AffiliateConfig {
    template?: string;
    aid?: string;
}

/** Read from Vite's env, and safe where there is none (scripts/hotels-selftest.ts under tsx). */
function envConfig(): AffiliateConfig {
    const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {};
    return { template: env.VITE_HOTEL_AFFILIATE_LINK?.trim() || undefined, aid: env.VITE_BOOKING_AFFILIATE_ID?.trim() || undefined };
}
const CONFIG = envConfig();

const isBookingCom = (host: string) => host === 'booking.com' || host.endsWith('.booking.com');

/** A template is only used when it is an https link with exactly the `{url}` slot to fill. */
function usableTemplate(t?: string): string | undefined {
    if (!t || !t.includes('{url}') || t.split('{url}').length !== 2) return undefined;
    try { return new URL(t.replace('{url}', 'x')).protocol === 'https:' ? t : undefined; } catch { return undefined; }
}

/** YYYY-MM-DD for a real calendar day, or nothing for anything else. */
const isoDate = (d?: string | null) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return undefined;
    const t = new Date(`${d}T00:00:00Z`);
    return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== d ? undefined : d;
};

/** Today in the visitor's own calendar, YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
    const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** `iso` plus `days`, YYYY-MM-DD. */
export function addDays(iso: string, days: number): string {
    const t = new Date(`${iso}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + days);
    return t.toISOString().slice(0, 10);
}

/**
 * A usable stay from two strings (URL params, form fields): both real dates,
 * check-out after check-in, check-in not in the past. Anything else is no stay
 * at all, so a stale shared link never sends Booking.com yesterday's dates.
 */
export function validStay(checkin?: string | null, checkout?: string | null, today = todayIso()): { checkin: string; checkout: string } | null {
    const a = isoDate(checkin), b = isoDate(checkout);
    if (!a || !b || b <= a || a < today) return null;
    return { checkin: a, checkout: b };
}

export interface LinkOptions { lang?: string; checkin?: string; checkout?: string; today?: string }

/** The pure version of `bookingHref`, with the affiliate settings passed in (for the self-test). */
export function buildBookingHref(
    hotel: Pick<Hotel, 'booking_url' | 'website'>,
    opts: LinkOptions,
    cfg: AffiliateConfig,
): string | null {
    const raw = hotel.booking_url ?? hotel.website;
    if (!raw) return null;
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!isBookingCom(url.hostname)) return url.toString(); // a hotel's own site: passed through untouched

    url.searchParams.set('lang', opts.lang?.startsWith('es') ? 'es' : 'en-us');
    const stay = validStay(opts.checkin, opts.checkout, opts.today);
    if (stay) {
        url.searchParams.set('checkin', stay.checkin);
        url.searchParams.set('checkout', stay.checkout);
    }
    // Tells our side (and Booking.com's reports) which page sent the visitor.
    url.searchParams.set('label', 'medsociety');

    const template = usableTemplate(cfg.template);
    if (template) return template.replace('{url}', encodeURIComponent(url.toString()));
    if (cfg.aid) url.searchParams.set('aid', cfg.aid);
    return url.toString();
}

/** Where "Check rates" goes for this hotel, with commission when it is configured. */
export function bookingHref(hotel: Pick<Hotel, 'booking_url' | 'website'>, opts: LinkOptions = {}): string | null {
    return buildBookingHref(hotel, opts, CONFIG);
}

/** The pure version of `isAffiliateLink`. */
export function earnsCommission(href: string | null, cfg: AffiliateConfig): boolean {
    if (!href) return false;
    const template = usableTemplate(cfg.template);
    if (template) return href.startsWith(template.split('{url}')[0]);
    if (!cfg.aid) return false;
    try { const u = new URL(href); return isBookingCom(u.hostname) && u.searchParams.get('aid') === cfg.aid; } catch { return false; }
}

/** Whether the link earns commission, so the UI marks it rel="sponsored". */
export function isAffiliateLink(href: string | null): boolean {
    return earnsCommission(href, CONFIG);
}

/** "1.2 km" / "800 m", in the visitor's language. */
export function formatDistance(km: number, lang: string): string {
    if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
    return `${km.toLocaleString(lang, { maximumFractionDigits: 1 })} km`;
}
