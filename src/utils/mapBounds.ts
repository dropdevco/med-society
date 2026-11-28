import type { MapBox, Provider } from '../types/provider';

/*
 * The boxes the map frames and limits itself with. Kept outside MapView so the
 * server-side search (docs/server-search-plan.md) and its parity check compute
 * the same boxes the map does.
 */

/** Bounding box of a provider set, or null when there is nothing to bound. */
export function boundsOf(list: readonly Provider[]): MapBox | null {
    const pts = list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length === 0) return null;

    let north = -90, south = 90, east = -180, west = 180;
    for (const p of pts) {
        north = Math.max(north, p.lat);
        south = Math.min(south, p.lat);
        east = Math.max(east, p.lng);
        west = Math.min(west, p.lng);
    }
    return { north, south, east, west };
}

/**
 * The box to *frame* a result set with: its bounds, minus the outermost 1% on
 * each side once there are enough results for that to mean outliers. A region
 * holds a few clinics far out (Rosarito, Ensenada, Tecate), and fitting the
 * camera to them shrank a whole city of results into a corner of the map. The
 * outliers are still drawn and still reachable — the pan limit uses the full
 * bounds — the camera just doesn't open on them.
 */
export function framingBoxOf(list: readonly Provider[]): MapBox | null {
    const pts = list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (pts.length < 50) return boundsOf(pts);
    const lats = pts.map((p) => p.lat).sort((a, b) => a - b);
    const lngs = pts.map((p) => p.lng).sort((a, b) => a - b);
    const lo = Math.floor(pts.length * 0.01);
    const hi = pts.length - 1 - lo;
    return { south: lats[lo], north: lats[hi], west: lngs[lo], east: lngs[hi] };
}
