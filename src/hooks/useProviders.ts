import { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MapBox, Provider, ProviderFilters, Specialty, SortMode } from '../types/provider';
import { SpecialtyLabels } from '../types/provider';
import { supabase } from '../lib/supabase';
import { mockProviders } from '../data/providers';
import { normalizeProvider } from '../utils/normalizeProvider';
import { readProviderCache, writeProviderCache } from '../utils/providerCache';
import { DEFAULT_RADIUS_KM, distanceKm } from '../utils/geo';
import { buildSearchIndex, tokenize } from '../utils/search';
import { buildVocabulary, buildFacets } from '../utils/facets';
import { applyFilters, defaultFilters, type FilterContext } from '../utils/filters';
import { priorMean } from '../utils/rating';
import { resolvePostal, type PostalHit } from '../utils/postalGeocode';
import {
    inRegion, isRegionId, postalFitsRegion, readLastRegion, regionOf, writeLastRegion, type RegionId,
} from '../utils/region';

const SPECIALTY_KEYS = new Set(Object.keys(SpecialtyLabels));
const SORT_MODES = new Set<SortMode>(['relevance', 'rating', 'reviews', 'distance', 'price']);
const EMPTY: Provider[] = [];

// ── Provider fetch ──────────────────────────────────────────────────────────

type RawProviderRow = Record<string, unknown>;

/** Distinguishes "no client configured" from a real fetch error, above. */
class NoSupabaseClientError extends Error {}

const PAGE_SIZE = 1000;

/**
 * The lean directory view (migration 0021): only what cards, the map, search
 * and facet counts read, with `services` reduced to `service_names`. The full
 * row still loads for a provider's own page (useProvider).
 */
const LIST_VIEW = 'provider_list';

/**
 * One border region of the directory, paged from Supabase.
 *
 * Page 0 asks for an exact count (`{ count: 'exact' }`), which lets every
 * remaining page be requested concurrently with `Promise.all` instead of one
 * after another. `.order('id')` is added to every page (page 0 included)
 * so the ranges stay stable across concurrent requests: without a stable
 * order Postgres is free to return a different row order per request, and
 * parallel `.range()` calls would then silently overlap or skip rows.
 *
 * Only the selected region is fetched. Loading every live provider used to
 * cost ~17 MB of `select=*` per visit; one region of the view is 3–6 MB.
 *
 * If Supabase ever declines to report a count (some proxies/mocks omit it),
 * this falls back to a sequential loop rather than guess a total.
 */
async function loadRegionFromNetwork(region: RegionId): Promise<RawProviderRow[]> {
    if (!supabase) {
        throw new NoSupabaseClientError('Supabase client not initialized');
    }
    const client = supabase;
    // The view only exposes live rows, so there is no status filter here.
    const page = (from: number, count?: 'exact') => client
        .from(LIST_VIEW)
        .select('*', count ? { count } : undefined)
        .eq('region', region)
        .order('id')
        .range(from, from + PAGE_SIZE - 1);

    const first = await page(0, 'exact');
    if (first.error) throw first.error;

    const data: RawProviderRow[] = [...(first.data ?? [])];
    const count = first.count;
    const firstLen = first.data?.length ?? 0;

    if (count == null) {
        // No count back from the server: page sequentially.
        for (let from = PAGE_SIZE; firstLen === PAGE_SIZE; from += PAGE_SIZE) {
            const next = await page(from);
            if (next.error) throw next.error;
            data.push(...(next.data ?? []));
            if (!next.data || next.data.length < PAGE_SIZE) break;
        }
    } else if (firstLen === PAGE_SIZE && count > PAGE_SIZE) {
        const starts: number[] = [];
        for (let from = PAGE_SIZE; from < count; from += PAGE_SIZE) starts.push(from);

        const pages = await Promise.all(starts.map((from) => page(from)));
        for (const next of pages) {
            if (next.error) throw next.error;
            data.push(...(next.data ?? []));
        }
    }

    return data;
}

/**
 * Memoized per region at module scope, so React StrictMode's dev-only double
 * mount awaits one in-flight request instead of firing the paged fetch twice,
 * and switching back to a region already visited costs nothing. A failed
 * fetch clears its entry so a later mount can try again rather than replay
 * the same rejection forever.
 */
const regionPromises = new Map<RegionId, Promise<RawProviderRow[]>>();

function fetchRegionOnce(region: RegionId): Promise<RawProviderRow[]> {
    let promise = regionPromises.get(region);
    if (!promise) {
        promise = loadRegionFromNetwork(region).catch((err) => {
            regionPromises.delete(region);
            throw err;
        });
        regionPromises.set(region, promise);
    }
    return promise;
}

/**
 * Normalised rows of every region fetched from the network this session.
 * Lets a switch back to a region paint synchronously, with no loading flash
 * and no second request.
 */
const loadedRegions = new Map<RegionId, Provider[]>();

/** Mock data is not split by region; keep the requested one. */
const mockFor = (region: RegionId) =>
    mockProviders.filter((p) => (p.region ?? regionOf(p.lng)) === region);

// ── URL ⇄ filters ───────────────────────────────────────────────────────────
//
// The URL is the single source of truth for the filter state. Keeping it there
// rather than in a useState means every search is shareable and bookmarkable,
// and the back button works, without a second copy to keep in sync.

function parseFilters(params: URLSearchParams): ProviderFilters {
    const num = (key: string, fallback: number) => {
        const v = Number(params.get(key));
        return Number.isFinite(v) && params.get(key) !== null ? v : fallback;
    };
    const sort = params.get('sort') as SortMode | null;

    const region = params.get('region');

    return {
        // No region in the URL means "wherever this visitor was last" — but
        // only for the first paint: useProviders immediately rewrites such a
        // URL to carry the region it resolved to, so no history entry is ever
        // left meaning "whatever localStorage says by the time you come back".
        region: isRegionId(region) ? region : readLastRegion(),
        browse: params.get('list') === '1',
        search: params.get('q') ?? '',
        smart: params.get('smart') === '1',
        specialty: params.getAll('spec').filter((s) => SPECIALTY_KEYS.has(s)) as Specialty[],
        country: params.get('country') === 'MX' || params.get('country') === 'US'
            ? (params.get('country') as 'MX' | 'US')
            : '',
        minRating: num('rating', 0),
        insurances: params.getAll('ins'),
        languages: params.getAll('lang'),
        verifiedOnly: params.get('verified') === '1',
        withPricing: params.get('priced') === '1',
        maxPriceMxn: params.has('max') ? num('max', 0) : null,
        sort: sort && SORT_MODES.has(sort) ? sort : 'relevance',
        postalCode: params.get('near') ?? '',
        radiusKm: num('r', DEFAULT_RADIUS_KM),
        mapArea: parseArea(params.get('area')),
    };
}

/** How many decimals survive into the URL. 4dp ≈ 11 m, finer than any pixel. */
const AREA_DP = 4;

/**
 * `area=south,west,north,east` — one param, four decimal degrees, in the same
 * order Google hands back a LatLngBounds (sw, ne).
 *
 * Parsed strictly: anything that is not exactly four finite numbers forming a
 * non-degenerate box is treated as absent. A hand-edited or truncated param
 * must never throw, and must never survive as a box that filters the whole
 * directory away — an empty result page with no visible cause is worse than
 * silently ignoring the param.
 */
function parseArea(raw: string | null): MapBox | null {
    if (!raw) return null;
    const parts = raw.split(',');
    if (parts.length !== 4) return null;

    const [south, west, north, east] = parts.map(Number);
    if (![south, west, north, east].every(Number.isFinite)) return null;
    if (south < -90 || north > 90 || west < -180 || east > 180) return null;
    // Strict: a zero-height or zero-width box, and any inverted box (which is
    // what a wrapped or scrambled param looks like), matches nothing.
    if (south >= north || west >= east) return null;

    return { north, south, east, west };
}

function serializeArea(b: MapBox): string {
    const r = (n: number) => Number(n.toFixed(AREA_DP));
    // Rounded on the way out, not on the way in: un-rounded floats churn the
    // URL on every sub-pixel camera settle, which defeats any identity check
    // built on the serialised string and floods the history stack.
    return [r(b.south), r(b.west), r(b.north), r(b.east)].join(',');
}

function serializeFilters(f: ProviderFilters): URLSearchParams {
    // The region always leads, even when it is the visitor's last one. A URL
    // that omits it means "whatever localStorage says", which changes under a
    // history entry (Back to `/` opened the region you left, not the one that
    // entry showed) and differs per person (a shared `/?spec=dentist` opened
    // El Paso for whoever received it).
    const p = new URLSearchParams({ region: f.region });
    if (f.browse) p.set('list', '1');
    if (f.search) p.set('q', f.search);
    if (f.search && f.smart) p.set('smart', '1');
    for (const s of f.specialty) p.append('spec', s);
    for (const i of f.insurances) p.append('ins', i);
    for (const l of f.languages) p.append('lang', l);
    if (f.country) p.set('country', f.country);
    if (f.minRating > 0) p.set('rating', String(f.minRating));
    if (f.verifiedOnly) p.set('verified', '1');
    if (f.withPricing) p.set('priced', '1');
    if (f.withPricing && f.maxPriceMxn != null) p.set('max', String(f.maxPriceMxn));
    if (f.sort !== 'relevance') p.set('sort', f.sort);
    if (f.postalCode) {
        p.set('near', f.postalCode);
        if (f.radiusKm !== DEFAULT_RADIUS_KM) p.set('r', String(f.radiusKm));
    }
    if (f.mapArea) p.set('area', serializeArea(f.mapArea));
    return p;
}

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
function postalCentroidsOf(
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

export function useProviders() {
    const { t } = useTranslation();
    const [searchParams, setSearchParams] = useSearchParams();
    const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
    const region = filters.region;

    /**
     * A URL without a (valid) region — a bare `/`, an old link, the logo — is
     * resolved once, to the visitor's last region, and then rewritten in place
     * to say so. From then on every history entry names its region, so Back
     * and Forward restore the region each entry showed, and a copied link
     * opens the same region for whoever receives it.
     */
    const urlHasRegion = isRegionId(searchParams.get('region'));
    useEffect(() => {
        if (urlHasRegion) return;
        setSearchParams(serializeFilters(filters), { replace: true });
    }, [urlHasRegion, filters, setSearchParams]);

    /**
     * Rows for one region, tagged with it, so a region switch never shows the
     * previous region's rows (or their settled state) as the new one's.
     */
    const [loaded, setLoaded] = useState<{ region: RegionId; providers: Provider[] } | null>(null);

    useEffect(() => {
        writeLastRegion(region);
    }, [region]);

    useEffect(() => {
        // Already fetched this session: painted synchronously below.
        if (loadedRegions.has(region)) return;

        let mounted = true;
        // Flips once the network settles (success or failure), so a slower
        // cache read can't clobber fresh data, or a mock fallback, that
        // already landed.
        let networkSettled = false;

        // Stale-while-revalidate: an IndexedDB cache read races the network.
        // If it wins and has usable rows, paint immediately; the network
        // response replaces it for real once it arrives, and never the other
        // way around.
        readProviderCache(region).then((cached) => {
            if (!mounted || networkSettled || !cached || cached.length === 0) return;
            setLoaded({ region, providers: cached.map(normalizeProvider) });
        });

        fetchRegionOnce(region)
            .then((data) => {
                networkSettled = true;
                const providers = data.map(normalizeProvider);
                // An empty region is a real answer (a region with no sweep
                // yet); mock data only stands in when the directory itself
                // is unreachable.
                loadedRegions.set(region, providers);
                // Cache the raw rows (pre-normalize), never mock data.
                if (data.length > 0) void writeProviderCache(region, data);
                if (mounted) setLoaded({ region, providers });
            })
            .catch((err) => {
                networkSettled = true;
                if (err instanceof NoSupabaseClientError) {
                    console.warn('[Supabase] client not initialized. Falling back to mock providers.');
                } else {
                    console.error('[Supabase] Error fetching providers:', err);
                }
                if (mounted) setLoaded({ region, providers: mockFor(region) });
            });

        return () => {
            mounted = false;
        };
    }, [region]);

    const allProviders = useMemo(
        () => loadedRegions.get(region)
            ?? (loaded?.region === region ? loaded.providers : EMPTY),
        // `loaded` is the trigger: loadedRegions is filled in the same tick
        // that sets it.
        [region, loaded],
    );
    const loading = !loadedRegions.has(region) && loaded?.region !== region;

    const setFilters = useCallback(
        (next: ProviderFilters, replace: boolean) => {
            setSearchParams(serializeFilters(next), { replace });
        },
        [setSearchParams],
    );

    const updateFilter = useCallback(
        <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => {
            // Typing replaces the history entry; picking a filter pushes one, so
            // Back steps through deliberate choices rather than through keystrokes.
            setFilters({ ...filters, [key]: value }, key === 'search');
        },
        [filters, setFilters],
    );

    /** Several axes at once, as one history entry — e.g. a postal search. */
    const patchFilters = useCallback(
        (patch: Partial<ProviderFilters>, replace = false) => {
            setFilters({ ...filters, ...patch }, replace);
        },
        [filters, setFilters],
    );

    // Clearing filters keeps the region: it is where the visitor is browsing,
    // not one of the things narrowing the list.
    const resetFilters = useCallback(
        () => setFilters({ ...defaultFilters, region: filters.region }, false),
        [filters.region, setFilters],
    );

    /**
     * The folded haystack. Rebuilt only when the directory or the UI language
     * changes — not per keystroke, which is what makes scoring a region's
     * 4–7k rows on every character viable.
     */
    const labelOf = useCallback(
        (s: Specialty) => t(`specialties.${s}`, { defaultValue: s }),
        [t],
    );

    const searchIndex = useMemo(
        () => buildSearchIndex(allProviders, labelOf),
        [allProviders, labelOf],
    );

    const rawVocabulary = useMemo(
        () => buildVocabulary(allProviders, labelOf, region),
        [allProviders, labelOf, region],
    );

    /**
     * Centre point of each postal code, averaged from the providers that sit in
     * it. Derived from data we already hold, so "near this ZIP" costs no
     * geocoding call and stays correct as the directory grows.
     */
    const postalCentroids = useMemo(
        () => postalCentroidsOf(allProviders, region),
        [allProviders, region],
    );

    /**
     * A code we hold resolves instantly from our own rows; anything else goes
     * to the geocoder.
     *
     * Keeping the derived centroid in front is not just a cost saving — for a
     * code we have providers in, the average of those providers is a better
     * centre for a radius search than the postal district's geometric middle.
     * The geocoder exists for the other 99.9% of codes on both sides of the
     * border, which is every code a patient is likely to type.
     */
    // Only the geocoder's answer lives in state (set asynchronously). The
    // "no lookup needed" and "still resolving" states are derived from the
    // current filters below, rather than written from inside the effect —
    // which also means a stale answer for a previous code/country can never
    // be mistaken for the current one.
    const [resolvedPostal, setResolvedPostal] = useState<{
        code: string;
        country: ProviderFilters['country'];
        region: RegionId;
        hits: PostalHit[];
    } | null>(null);

    /**
     * The suggester offers only postal codes with a trusted in-region centre:
     * suggesting a code the region does not contain (a mislabelled row's
     * 22000 while browsing El Paso) invites a search that cannot mean
     * anything here.
     */
    const vocabulary = useMemo(
        () => ({
            ...rawVocabulary,
            postals: rawVocabulary.postals.filter((p) => postalCentroids.has(p.label)),
        }),
        [rawVocabulary, postalCentroids],
    );

    const localCentre = useMemo(
        () => (filters.postalCode ? postalCentroids.get(filters.postalCode) ?? null : null),
        [filters.postalCode, postalCentroids],
    );

    const needsRemote = Boolean(filters.postalCode) && !localCentre;

    useEffect(() => {
        if (!needsRemote) return;
        const code = filters.postalCode;
        const country = filters.country;

        let live = true;
        resolvePostal(code, country, region).then((hits) => {
            if (live) setResolvedPostal({ code, country, region, hits });
        });
        return () => { live = false; };
    }, [filters.postalCode, filters.country, region, needsRemote]);

    const remote = useMemo((): {
        code: string;
        state: 'resolving' | 'resolved';
        hits: PostalHit[];
    } | null => {
        if (!needsRemote) return null;
        const code = filters.postalCode;
        if (
            resolvedPostal && resolvedPostal.code === code
            && resolvedPostal.country === filters.country && resolvedPostal.region === region
        ) {
            return { code, state: 'resolved', hits: resolvedPostal.hits };
        }
        return { code, state: 'resolving', hits: [] };
    }, [needsRemote, filters.postalCode, filters.country, region, resolvedPostal]);

    /**
     * The code means two places and the user has not said which side they are
     * on. Offered as a choice rather than guessed — picking the wrong country
     * silently returns an empty page for a code that plainly exists.
     */
    const postalChoices = useMemo(
        () => (remote?.state === 'resolved' && remote.hits.length > 1 ? remote.hits : []),
        [remote],
    );

    /** True while a code is in flight, so the UI can say so instead of "0 results". */
    const postalPending = remote?.state === 'resolving';

    /** Null when no code is active, and also when the code resolves nowhere. */
    const centre = useMemo(() => {
        if (!filters.postalCode) return null;
        if (localCentre) return localCentre;
        if (remote?.state !== 'resolved' || remote.code !== filters.postalCode) return null;
        // With two candidates and no stated side, filtering to either one would
        // be a guess. Hold the results until the user picks.
        if (remote.hits.length !== 1) return null;
        return { lat: remote.hits[0].lat, lng: remote.hits[0].lng };
    }, [filters.postalCode, localCentre, remote]);

    /**
     * The directory's own mean rating, computed once per load. It is the prior
     * the confidence-weighted sort shrinks toward, so it has to describe this
     * directory rather than a constant someone guessed.
     */
    const prior = useMemo(() => priorMean(allProviders), [allProviders]);

    const ctx: FilterContext = useMemo(
        // A smart search is a description, not keywords: ANDing every word of
        // "me duele el oído desde ayer" against names and services matches
        // nothing. SearchPage narrows the list from the AI answer instead.
        () => ({ index: searchIndex, terms: filters.smart ? [] : tokenize(filters.search), centre, prior }),
        [searchIndex, filters.search, filters.smart, centre, prior],
    );

    const filtered = useMemo(
        () => applyFilters(allProviders, filters, ctx),
        [allProviders, filters, ctx],
    );

    /**
     * Facet counts describe the *filters*, not the text query — they answer
     * "how many would I get if I ticked this box", which is a question about
     * the other axes. Excluding the query from the dependency list also keeps
     * this region-wide pass off the per-keystroke path.
     */
    const facetCtx: FilterContext = useMemo(
        () => ({ index: searchIndex, terms: [], centre, prior }),
        [searchIndex, centre, prior],
    );

    /**
     * The map viewport is released for the whole facet pass, permanently.
     *
     * buildFacets calls matchesFilters once per axis, so with `mapArea` still
     * applied every chip count would become viewport-relative — and
     * FilterChipRow picks its four specialty shortcuts from `facets.specialty`
     * sorted by count, so those chips would reshuffle under the cursor as the
     * user pans. Chip counts should describe the query, not the camera.
     *
     * Done by nulling the axis in the filters handed to buildFacets rather than
     * by threading an extra skip through facets.ts; matchesFilters' widened
     * `skip` supports either, and this keeps the facet module untouched.
     */
    const facetFilters = useMemo(() => ({ ...filters, mapArea: null }), [filters]);

    const facets = useMemo(
        () => buildFacets(allProviders, facetFilters, facetCtx),
        [allProviders, facetFilters, facetCtx],
    );

    return {
        providers: filtered,
        /** The selected region's providers: everything the directory holds right now. */
        allProviders,
        filters,
        region,
        updateFilter,
        patchFilters,
        resetFilters,
        facets,
        vocabulary,
        loading,
        /** Lets the UI tell "no providers near 32300" apart from "no such code". */
        knownPostalCodes: postalCentroids,
        /** True while a typed code is being geocoded. */
        postalPending,
        /** Two countries claim this code; the user has to say which. */
        postalChoices,
        /** Distance from the searched postal centre, for the result cards. */
        centre,
    };
}
