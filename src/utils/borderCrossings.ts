/**
 * The land border crossings patients use between the two regions, so hotels on
 * the US side can be described by how far they are from the crossing. The
 * coordinates are approximate (the pedestrian entrance, to a few hundred
 * metres) and only used for straight-line distances.
 *
 * api/agent.ts keeps a copy of this list (it cannot import from src/); change
 * one, change the other. scripts/agent-selftest.ts checks that they match.
 */
import type { RegionId } from './region';

export interface BorderCrossing {
    id: string;
    region: RegionId;
    lat: number;
    lng: number;
    /** "the San Ysidro crossing", with the article, for running text. */
    label: { en: string; es: string };
    /** The bare name, for captions ("1.3 mi to San Ysidro"). */
    name: { en: string; es: string };
}

export const BORDER_CROSSINGS: BorderCrossing[] = [
    { id: 'san-ysidro', region: 'sandiego-tijuana', lat: 32.5430, lng: -117.0290, label: { en: 'the San Ysidro crossing', es: 'la garita de San Ysidro' }, name: { en: 'San Ysidro', es: 'San Ysidro' } },
    { id: 'otay-mesa', region: 'sandiego-tijuana', lat: 32.5524, lng: -116.9378, label: { en: 'the Otay Mesa crossing', es: 'la garita de Otay Mesa' }, name: { en: 'Otay Mesa', es: 'Otay Mesa' } },
    { id: 'paso-del-norte', region: 'elpaso-juarez', lat: 31.7495, lng: -106.4876, label: { en: 'the Paso del Norte bridge', es: 'el puente internacional Paso del Norte' }, name: { en: 'Paso del Norte', es: 'Paso del Norte' } },
    { id: 'bridge-of-the-americas', region: 'elpaso-juarez', lat: 31.7633, lng: -106.4505, label: { en: 'the Bridge of the Americas', es: 'el Puente de las Américas' }, name: { en: 'Bridge of the Americas', es: 'Puente de las Américas' } },
    { id: 'ysleta-zaragoza', region: 'elpaso-juarez', lat: 31.6700, lng: -106.3310, label: { en: 'the Ysleta–Zaragoza bridge', es: 'el puente Ysleta–Zaragoza' }, name: { en: 'Ysleta–Zaragoza', es: 'Ysleta–Zaragoza' } },
];

const toRad = (d: number) => (d * Math.PI) / 180;
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function crossingsOf(region: RegionId): BorderCrossing[] {
    return BORDER_CROSSINGS.filter((c) => c.region === region);
}

/** The closest crossing of a region to a point, with the straight-line distance in km. */
export function nearestCrossing(point: { lat: number; lng: number }, region: RegionId): { crossing: BorderCrossing; km: number } {
    let best: { crossing: BorderCrossing; km: number } | null = null;
    for (const crossing of crossingsOf(region)) {
        const km = kmBetween(point, crossing);
        if (!best || km < best.km) best = { crossing, km };
    }
    return best!;
}

/** "from the San Ysidro crossing" / "de la garita de San Ysidro" ("de el" becomes "del"). */
export function fromCrossing(c: BorderCrossing, lang: 'en' | 'es'): string {
    return lang === 'es' ? `de ${c.label.es}`.replace(/^de el /, 'del ') : `from ${c.label.en}`;
}

/** Straight-line distance for a caption: miles for English readers, km for Spanish. Never a travel time. */
export function formatCrossingDistance(km: number, lang: 'en' | 'es'): string {
    if (lang === 'en') return `${(Math.round(km * 0.621371 * 10) / 10).toLocaleString('en-US')} mi`;
    return `${(Math.round(km * 10) / 10).toLocaleString('es-MX')} km`;
}
