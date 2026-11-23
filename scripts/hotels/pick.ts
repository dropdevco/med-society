/**
 * The pure part of the hotel finder (scripts/hotels/find.ts): which Google
 * results count as a hotel for patients, how they are ranked, and the
 * description each row gets. No network, no credentials, so
 * scripts/hotels-selftest.ts can check every rule with made-up places.
 */

import { kmBetween, fromCrossing, type BorderCrossing } from '../../src/utils/borderCrossings';

export interface Point { lat: number; lng: number }

/** What the finder keeps from a Google Places text-search result. */
export interface Candidate {
    placeId: string;
    name: string;
    lat: number;
    lng: number;
    address: string | null;
    rating: number | null;
    reviews: number;
    /**
 * US side: the hotel is chosen for how easy the crossing is, not for the
 * clinics (which are all in Mexico). Closeness to the nearest crossing first,
 * then rating × log(reviews), so a 4.6-star hotel 15 km out still loses to a
 * good one a few minutes from the line.
 */
export function scoreNearCrossing(c: Candidate, crossings: BorderCrossing[]): Scored {
    let crossing = crossings[0];
    let km = Infinity;
    for (const x of crossings) {
        const d = kmBetween(c, x);
        if (d < km) { km = d; crossing = x; }
    }
    const quality = (c.rating ?? 0) * Math.log10(Math.max(c.reviews, 1));
    return { ...c, clinicsWithin1Km: 0, nearestClinicKm: Infinity, crossing, crossingKm: km, score: quality - Math.min(km, 15) * 0.8 };
}

/** Google's 0–4 price level, when it has one. */
    priceLevel: number | null;
    businessStatus: string | null;
    types: string[];
}

export interface Scored extends Candidate {
    /** Live listings in this city within 1 km. */
    clinicsWithin1Km: number;
    /** Distance to the closest live listing, km. */
    nearestClinicKm: number;
    score: number;
    /** US-side hotels only: the closest border crossing and the straight-line km to it. */
    crossing?: BorderCrossing;
    crossingKm?: number;
}

export const MIN_RATING = 4.0;
export const MIN_REVIEWS = 100;

/**
 * In Mexico "motel" and "auto hotel" usually mean hourly rooms with a private
 * garage, which are no place to recover from surgery. Hostels and campsites
 * are out for the same reason.
 */
const UNSUITABLE_NAME = /\b(auto\s?-?hotel|autohotel|motel|hostal|hostel|love|campamento|camping|rv\s?park)\b/i;
const UNSUITABLE_TYPE = new Set(['campground', 'rv_park']);

export function isUnsuitableName(name: string): boolean {
    return UNSUITABLE_NAME.test(name);
}

/** Why a candidate is dropped, or null when it is kept. */
export function rejectReason(c: Candidate): string | null {
    if (c.businessStatus && c.businessStatus !== 'OPERATIONAL') return `not operational (${c.businessStatus})`;
    if (isUnsuitableName(c.name)) return 'motel, auto hotel or hostel';
    if (c.types.some((t) => UNSUITABLE_TYPE.has(t))) return 'campground';
    if (c.rating === null || c.rating < MIN_RATING) return `rating below ${MIN_RATING}`;
    if (c.reviews < MIN_REVIEWS) return `fewer than ${MIN_REVIEWS} reviews`;
    return null;
}

const toRad = (d: number) => (d * Math.PI) / 180;
export function distanceKm(a: Point, b: Point): number {
    const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * The densest 0.01° cells (about 1.1 km) of listings, at least `minApartKm`
 * apart, so three centres do not all land in the same neighbourhood.
 */
export function clusterCentres(clinics: Point[], count = 3, minApartKm = 1.5): (Point & { n: number })[] {
    const cells = new Map<string, { lat: number; lng: number; n: number }>();
    for (const p of clinics) {
        const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
        const cell = cells.get(key) ?? { lat: Number(p.lat.toFixed(2)), lng: Number(p.lng.toFixed(2)), n: 0 };
        cell.n++;
        cells.set(key, cell);
    }
    const out: (Point & { n: number })[] = [];
    for (const cell of [...cells.values()].sort((a, b) => b.n - a.n)) {
        if (out.every((c) => distanceKm(c, cell) >= minApartKm)) out.push(cell);
        if (out.length === count) break;
    }
    return out;
}

/** Closeness to clinics first, then how well and how often it is rated. */
export function score(c: Candidate, clinics: Point[]): Scored {
    let within = 0;
    let nearest = Infinity;
    for (const p of clinics) {
        const d = distanceKm(c, p);
        if (d <= 1) within++;
        if (d < nearest) nearest = d;
    }
    const quality = (c.rating ?? 0) * Math.log10(Math.max(c.reviews, 1));
    const closeness = Math.min(within, 300) / 60 - Math.min(nearest, 10);
    return { ...c, clinicsWithin1Km: within, nearestClinicKm: nearest, score: quality + closeness };
}

/**
 * The best `perCity`, deduplicated by place ID, with no more than half from
 * one Google price level, so the list is not all budget or all luxury.
 */
export function pick(
    candidates: Candidate[], clinics: Point[], perCity = 12,
    scorer: (c: Candidate) => Scored = (c) => score(c, clinics),
): Scored[] {
    const unique = new Map<string, Candidate>();
    for (const c of candidates) if (!unique.has(c.placeId)) unique.set(c.placeId, c);
    const ranked = [...unique.values()].filter((c) => rejectReason(c) === null)
        .map(scorer).sort((a, b) => b.score - a.score);
    const cap = Math.ceil(perCity / 2);
    const perLevel = new Map<string, number>();
    const chosen: Scored[] = [];
    for (const c of ranked) {
        const level = String(c.priceLevel ?? 'unknown');
        if ((perLevel.get(level) ?? 0) >= cap) continue;
        perLevel.set(level, (perLevel.get(level) ?? 0) + 1);
        chosen.push(c);
        if (chosen.length === perCity) break;
    }
    // Still short (a city where most hotels share a price level): fill with the rest, in order.
    for (const c of ranked) {
        if (chosen.length === perCity) break;
        if (!chosen.includes(c)) chosen.push(c);
    }
    return chosen;
}

/** Google's 0–4 price level → our 1–4 band. 0 (free) and 1 (inexpensive) are both "$". */
export function priceBand(level: number | null): number | null {
    if (level === null || !Number.isFinite(level)) return null;
    return Math.min(4, Math.max(1, Math.round(level)));
}

function fmtDistance(km: number, lang: 'en' | 'es'): string {
    if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m`;
    return `${km.toLocaleString(lang === 'es' ? 'es-MX' : 'en-US', { maximumFractionDigits: 1 })} km`;
}

/** A factual line from our own listings, in both languages. Nothing about the hotel itself is claimed. */
export function describe(s: Pick<Scored, 'clinicsWithin1Km' | 'nearestClinicKm'>): { en: string; es: string } {
    const near = { en: fmtDistance(s.nearestClinicKm, 'en'), es: fmtDistance(s.nearestClinicKm, 'es') };
    if (s.clinicsWithin1Km >= 2) {
        const n = { en: s.clinicsWithin1Km.toLocaleString('en-US'), es: s.clinicsWithin1Km.toLocaleString('es-MX') };
        return {
            en: `${n.en} doctors and clinics listed within 1 km. The nearest is ${near.en} away.`,
            es: `${n.es} médicos y clínicas a menos de 1 km. El más cercano está a ${near.es}.`,
        };
    }
    return {
        en: `The nearest listed doctor or clinic is ${near.en} away.`,
        es: `El médico o clínica más cercano está a ${near.es}.`,
    };
}

/** Booking.com's own search for this hotel, so "Check rates" works without a scraped hotel page URL. */
export function bookingSearchUrl(name: string, city: string): string {
    return `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(`${name}, ${city}`)}`;
}

/**
 * What a US-side hotel's row says: only the straight-line distance to the
 * crossing, in miles and km for English readers. Nothing about waits or
 * safety, which this data cannot know.
 */
export function describeCrossing(s: { crossing: BorderCrossing; crossingKm: number }): { en: string; es: string } {
    const km = Math.round(s.crossingKm * 10) / 10;
    const mi = Math.round(s.crossingKm * 0.621371 * 10) / 10;
    return {
        en: `${mi} mi (${km} km) in a straight line ${fromCrossing(s.crossing, 'en')}.`,
        es: `A ${km.toLocaleString('es-MX')} km en línea recta ${fromCrossing(s.crossing, 'es')}.`,
    };
}
