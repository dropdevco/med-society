import type { Hotel } from '../types/hotel';

/**
 * Where "Check rates" goes. The one place the affiliate id is added, so a
 * second partner (Expedia) or a new id never needs more than this file.
 *
 * VITE_BOOKING_AFFILIATE_ID is the Booking.com Affiliate Partner id (`aid`).
 * Until it is set the link still works, just without commission.
 */
const BOOKING_AID = (import.meta.env.VITE_BOOKING_AFFILIATE_ID as string | undefined)?.trim() || '';

const isBookingCom = (host: string) => host === 'booking.com' || host.endsWith('.booking.com');

/** YYYY-MM-DD, or nothing for anything else. */
const isoDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

export function bookingHref(
    hotel: Pick<Hotel, 'booking_url' | 'website'>,
    opts: { lang?: string; checkin?: string; checkout?: string } = {},
): string | null {
    const raw = hotel.booking_url ?? hotel.website;
    if (!raw) return null;
    let url: URL;
    try { url = new URL(raw); } catch { return null; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

    if (isBookingCom(url.hostname)) {
        if (BOOKING_AID) url.searchParams.set('aid', BOOKING_AID);
        url.searchParams.set('lang', opts.lang?.startsWith('es') ? 'es' : 'en-us');
        const checkin = isoDate(opts.checkin);
        const checkout = isoDate(opts.checkout);
        if (checkin && checkout && checkout > checkin) {
            url.searchParams.set('checkin', checkin);
            url.searchParams.set('checkout', checkout);
        }
        // Tells our side (and Booking.com's reports) which page sent the visitor.
        url.searchParams.set('label', 'medsociety');
    }
    return url.toString();
}

/** Whether the link earns commission, so the UI can mark it as sponsored. */
export function isAffiliateLink(href: string | null): boolean {
    if (!href || !BOOKING_AID) return false;
    try { return isBookingCom(new URL(href).hostname); } catch { return false; }
}

/** "1.2 km" / "800 m", in the visitor's language. */
export function formatDistance(km: number, lang: string): string {
    if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
    return `${km.toLocaleString(lang, { maximumFractionDigits: 1 })} km`;
}
