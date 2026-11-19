import type { Provider } from '../types/provider';
import { distanceKm } from './geo';
import { inRegion, postalFitsRegion, type RegionId } from './region';

/** Postal rows further than this from their code's median are typos, not neighbours. */
const POSTAL_OUTLIER_KM = 25;

function median(xs: number[]): number {
    const sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Centre point of each postal code, averaged from the providers that sit in
 * it — but only from rows that can be trusted to.
 *
 * A row's postal code is copied from its source profile, and some are wrong:
 * a Juárez clinic carrying Tijuana's 22000, a Tijuana one carrying Juárez's
 * 32300. Their coordinates are right (they sit in the loaded region), so a
 * naive average put "22000" in the middle of Juárez and `near=22000` while
 * browsing El Paso listed 387 clinics. So a row counts only if
 *  - its code is in one of the region's own ranges (postalFitsRegion),
 *  - its coordinates are inside the region,
 *  - it lies within POSTAL_OUTLIER_KM of the code's median point (one
 *    mistyped row must not drag a real code's centre across town),
 * and the resulting centre must itself be inside the region. A code that
 * fails falls through to the geocoder, which answers region-scoped and
 * reports "no providers in …" for a code from somewhere else.
 */
export function postalCentroidsOf(
    providers: readonly Provider[],
    region: RegionId,
): Map<string, { lat: number; lng: number }> {
    const byCode = new Map<string, Provider[]>();
    for (const p of providers) {
        if (!p.postalCode || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
        if (!postalFitsRegion(p.postalCode, region)) continue;
        if (!inRegion(p.lat, p.lng, region)) continue;
        const list = byCode.get(p.postalCode);
        if (list) list.push(p);
        else byCode.set(p.postalCode, [p]);
    }

    const centroids = new Map<string, { lat: number; lng: number }>();
    for (const [code, rows] of byCode) {
        const mLat = median(rows.map((p) => p.lat));
        const mLng = median(rows.map((p) => p.lng));
        const kept = rows.filter((p) => distanceKm(mLat, mLng, p.lat, p.lng) <= POSTAL_OUTLIER_KM);
        if (kept.length === 0) continue;
        const lat = kept.reduce((sum, p) => sum + p.lat, 0) / kept.length;
        const lng = kept.reduce((sum, p) => sum + p.lng, 0) / kept.length;
        if (!inRegion(lat, lng, region, 0)) continue;
        centroids.set(code, { lat, lng });
    }
    return centroids;
}
