import type { Provider, ProviderFilters, SortMode, Specialty } from '../types/provider';
import type { SearchDoc } from './search';
import { scoreDoc } from './search';
import { distanceKm, DEFAULT_RADIUS_KM } from './geo';
import { shrunkScore, isRated } from './rating';
import { DEFAULT_REGION, type RegionId } from './region';

export const defaultFilters: ProviderFilters = {
    region: DEFAULT_REGION,
    browse: false,
    search: '',
    smart: false,
    specialty: [],
    country: '',
    minRating: 0,
    insurances: [],
    languages: [],
    verifiedOnly: false,
    withPricing: false,
    maxPriceMxn: null,
    sort: 'relevance',
    postalCode: '',
    radiusKm: DEFAULT_RADIUS_KM,
    mapArea: null,
};

/**
 * Moving to another border region. The side, postal code and map box all
 * belong to the region being left — a Juárez postal code or a camera box over
 * El Paso means nothing in Tijuana — so they are released with it. Everything
 * else (specialty, insurers, sort…) carries over.
 */
export function regionPatch(region: RegionId): Partial<ProviderFilters> {
    return { region, country: '', postalCode: '', mapArea: null };
}

/**
 * How many filters are narrowing the list, ignoring the free-text search.
 *
 * Drives the count on the "Filters (2)" button and the badge on the mobile
 * sheet — with the rail closed, this is the only signal that results are being
 * filtered at all.
 *
 * `region` is not counted either: it is a scope, always set, and choosing one
 * alone keeps the browse rows (for that region) rather than opening results.
 *
 * `mapArea` is deliberately NOT counted, and this is not an oversight.
 * SearchPage derives `searching = filters.search !== '' || activeCount > 0`,
 * and `searching` is what decides whether the map mounts at all. If a map area
 * counted here, a URL carrying only `?area=…` would open the results view with
 * no query behind it — and the map that produced those bounds is unreachable
 * from the landing page by design, so the box could never have been drawn.
 * A bootstrapping paradox. The chip that makes a map area visible and
 * removable lives in FilterSummary, which gates on `filters.mapArea`
 * separately. Do not "fix" this omission.
 */
export function countActiveFilters(filters: ProviderFilters): number {
    let n = 0;
    n += filters.specialty.length;
    n += filters.insurances.length;
    n += filters.languages.length;
    if (filters.country) n++;
    if (filters.minRating > 0) n++;
    if (filters.postalCode) n++;
    if (filters.verifiedOnly) n++;
    if (filters.withPricing) n++;
    return n;
}

/**
 * Is this provider *about* `specialty`, rather than merely offering it?
 *
 * General hospitals carry up to thirteen specialty tags (Hospital Angeles
 * Tijuana is a dentist, a cardiologist, a paediatrician…), and with the
 * strongest review counts in the region they led every specialty list. A
 * provider is focused on a specialty when it is their primary one (listed
 * first) or when they list only a few.
 */
export const FOCUSED_MAX_SPECIALTIES = 3;

export function isFocusedOn(p: Provider, specialty: Specialty): boolean {
    if (!p.specialty.includes(specialty)) return false;
    return p.specialty[0] === specialty || p.specialty.length <= FOCUSED_MAX_SPECIALTIES;
}

/**
 * How far a generalist sinks in a specialty-filtered list: 0.05 of a star per
 * specialty beyond FOCUSED_MAX_SPECIALTIES, capped at half a star. Applied to
 * the confidence-weighted rating only (the default order and every tiebreak),
 * so an explicit "most reviews", "nearest" or "price" sort is untouched, and
 * a well-reviewed hospital still outranks a poorly-reviewed specialist.
 */
function generalistPenalty(p: Provider, selected: readonly Specialty[]): number {
    if (selected.length === 0 || selected.some((s) => isFocusedOn(p, s))) return 0;
    return Math.min(0.5, 0.05 * (p.specialty.length - FOCUSED_MAX_SPECIALTIES));
}

export interface FilterContext {
    /** Folded haystack per provider id, from buildSearchIndex(). */
    index: Map<string, SearchDoc>;
    /** Tokenised query. Empty means "no text query", not "match nothing". */
    terms: string[];
    /** Centre of the searched postal code, or null when we don't know the code. */
    centre: { lat: number; lng: number } | null;
    /**
     * Mean rating across the whole directory — the prior the confidence-weighted
     * sort shrinks toward. Passed in rather than derived here so the region-wide
     * average is computed once per directory load, not once per sort.
     */
    prior: number;
}

/**
 * One axis to release, or several. Callers that release a single facet pass a
 * bare key; callers that also hold an axis permanently released pass an array.
 */
export type SkipAxis = keyof ProviderFilters | (keyof ProviderFilters)[];

/**
 * Everything except the free-text query.
 *
 * Split out from `applyFilters` because the facet counts need to ask "how many
 * would survive if this one axis were released?" — see facets.ts.
 */
export function matchesFilters(
    p: Provider,
    filters: ProviderFilters,
    ctx: FilterContext,
    /**
     * Axis (or axes) to ignore, so a facet can count its own options without
     * excluding them. An array lets a caller release its own axis *and* hold a
     * second one permanently released — see the facet pass in useProviders,
     * which keeps chip counts describing the query rather than the camera.
     */
    skip?: SkipAxis,
): boolean {
    const skipped = (key: keyof ProviderFilters) =>
        Array.isArray(skip) ? skip.includes(key) : skip === key;

    // Only the selected region is loaded, so this rarely bites; it keeps mock
    // data (which is not split by region) and any stale paint honest.
    if (p.region && p.region !== filters.region) return false;

    if (filters.postalCode && !skipped('postalCode')) {
        // An unknown code yields no centre; returning false here is deliberate,
        // so the UI can say "no such code" rather than silently ignoring it.
        if (!ctx.centre) return false;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
        if (distanceKm(ctx.centre.lat, ctx.centre.lng, p.lat, p.lng) > filters.radiusKm) return false;
    }

    if (filters.mapArea && !skipped('mapArea')) {
        // A plain inclusive box test. No antimeridian wrapping is handled here
        // and none is needed: the map restricts panning to the border region,
        // so a box straddling ±180° is unreachable. Adding wrap handling would
        // be dead code guarding an impossible camera — please leave it out.
        const b = filters.mapArea;
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return false;
        if (p.lat < b.south || p.lat > b.north || p.lng < b.west || p.lng > b.east) return false;
    }

    if (!skipped('specialty') && filters.specialty.length) {
        if (!filters.specialty.some((s) => p.specialty.includes(s))) return false;
    }

    if (!skipped('country') && filters.country && p.country !== filters.country) return false;

    if (!skipped('minRating') && filters.minRating > 0) {
        // An unrated provider is excluded rather than compared. Nearly half the
        // directory stores "never rated" as a 0, and treating that as a score
        // made "4.5+ stars" mean "4.5+, and also everyone we know nothing
        // about is definitely worse than one star".
        if (!isRated(p) || p.rating < filters.minRating) return false;
    }

    if (!skipped('insurances') && filters.insurances.length) {
        const held = p.insurances ?? [];
        if (!filters.insurances.some((i) => held.includes(i))) return false;
    }

    if (!skipped('languages') && filters.languages.length) {
        const held = p.languages ?? [];
        if (!filters.languages.some((l) => held.includes(l))) return false;
    }

    /**
     * Filters on the licence, not on the plan.
     *
     * The chip has always been labelled "Verified credentials", and a licence
     * number scraped off the source profile is exactly that. What changed is
     * where that fact is stored: `verified` now means "is paying", which
     * nobody is yet, so pointing this axis at it would leave the chip
     * permanently at zero and the credential filter gone. The URL parameter
     * stays `verified=1` so existing links keep working.
     */
    if (!skipped('verifiedOnly') && filters.verifiedOnly && !p.licensed) return false;

    if (!skipped('withPricing') && filters.withPricing) {
        if (p.priceFromMxn == null) return false;
        if (filters.maxPriceMxn != null && p.priceFromMxn > filters.maxPriceMxn) return false;
    }

    return true;
}

/**
 * Which order actually applies.
 *
 * "Relevance" is meaningless without a query, so an empty search box falls
 * through to whatever signal is present: nearest when the user gave a location,
 * best-rated otherwise. Choosing here rather than in the UI keeps the sort
 * dropdown honest — it never displays an order that isn't in effect.
 */
// `mapArea` is deliberately absent below: a bounding box carries no centre, so
// it cannot imply a distance sort. A viewport narrows the list; it does not
// reorder it.
function effectiveSort(filters: ProviderFilters, ctx: FilterContext): SortMode {
    if (filters.sort !== 'relevance') return filters.sort;
    if (ctx.terms.length) return 'relevance';
    return ctx.centre ? 'distance' : 'rating';
}

/** Filter, score and sort in one pass. Returns a new array; inputs are untouched. */
export function applyFilters(
    providers: readonly Provider[],
    filters: ProviderFilters,
    ctx: FilterContext,
): Provider[] {
    const scores = new Map<string, number>();
    const distances = new Map<string, number>();
    const sort = effectiveSort(filters, ctx);

    const kept: Provider[] = [];

    for (const p of providers) {
        if (!matchesFilters(p, filters, ctx)) continue;

        if (ctx.terms.length) {
            const doc = ctx.index.get(p.id);
            const score = doc ? scoreDoc(doc, ctx.terms) : 0;
            if (score === 0) continue;
            scores.set(p.id, score);
        }

        if (ctx.centre) {
            distances.set(p.id, distanceKm(ctx.centre.lat, ctx.centre.lng, p.lat, p.lng));
        }

        kept.push(p);
    }

    const byDistance = (a: Provider, b: Provider) =>
        (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity);

    /**
     * Hand-curated rows, above everything, on the default browse only.
     *
     * The directory's first screen is its shop window, and until clinics start
     * supplying their own photography the only listings that look like a
     * product are the ones the team has looked at. `featuredRank` is how they
     * say so without a deploy.
     *
     * Deliberately inert the moment the user expresses an intent — an explicit
     * sort or a text query means they asked for a specific order, and quietly
     * holding twelve curated rows above it would be a worse lie than an ugly
     * first screen.
     */
    const curated = filters.sort === 'relevance' && ctx.terms.length === 0;

    // Precomputed: the comparator runs O(n log n) times.
    const penalties = new Map<string, number>();
    if (filters.specialty.length) {
        for (const p of kept) {
            const pen = generalistPenalty(p, filters.specialty);
            if (pen > 0) penalties.set(p.id, pen);
        }
    }

    kept.sort((a, b) => {
        if (curated) {
            const ra = a.featuredRank ?? Infinity;
            const rb = b.featuredRank ?? Infinity;
            if (ra !== rb) return ra - rb;
        }

        // Promoted listings hold the top tier in every order. That is the deal
        // they paid for, and it is why it sits above the sort choice.
        // Featured is "first position in your category", so it sits above Promoted.
        const placement = (p: Provider) => (p.tier === 'featured' ? 2 : p.promoted ? 1 : 0);
        if (placement(a) !== placement(b)) return placement(b) - placement(a);

        switch (sort) {
            case 'relevance': {
                const d = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
                if (Math.abs(d) > 0.001) return d;
                break;
            }
            case 'reviews': {
                const d = (b.reviewCount || 0) - (a.reviewCount || 0);
                if (d !== 0) return d;
                break;
            }
            case 'distance': {
                const d = byDistance(a, b);
                // Sub-10m differences are noise from averaged postal centroids.
                if (Math.abs(d) > 0.01) return d;
                break;
            }
            case 'price': {
                // Unpriced providers sort last rather than as free.
                const pa = a.priceFromMxn ?? Infinity;
                const pb = b.priceFromMxn ?? Infinity;
                if (pa !== pb) return pa - pb;
                break;
            }
            case 'rating':
                break;
        }

        /**
         * Rating is the universal tiebreak — but the confidence-weighted one,
         * not the raw value.
         *
         * Doctoralia quantises to whole stars and 94% of its rated profiles
         * are exactly 5.0, so a raw comparison is a coin flip resolved by
         * review count, and the top of every list was a wall of indistinguish-
         * able five-star entries. The shrunk score pulls a rating toward the
         * directory mean in proportion to how little evidence stands behind
         * it, so 4.7 across eight hundred reviews outranks 5.0 across two.
         *
         * Unrated providers score below every rated one. They are not bad;
         * they are unknown, and unknown belongs after known in a ranking.
         */
        const d = (shrunkScore(b, ctx.prior) - (penalties.get(b.id) ?? 0))
            - (shrunkScore(a, ctx.prior) - (penalties.get(a.id) ?? 0));
        if (Math.abs(d) > 0.0001) return d;
        return (b.reviewCount || 0) - (a.reviewCount || 0);
    });

    return kept;
}
