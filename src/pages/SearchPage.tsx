import { useState, useCallback, useMemo, useRef, lazy, Suspense, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { useProviders } from '../hooks/useProviders';
import { useAiSearch, specialtiesOf } from '../hooks/useAiSearch';
import { SearchHero, type HeroWhere } from '../components/search/SearchHero';
import { SearchPill } from '../components/search/SearchPill';
import { CategoryRail } from '../components/search/CategoryRail';
import { FilterChipRow } from '../components/search/FilterChipRow';
import { FilterModal } from '../components/search/FilterModal';
import { FilterSummary } from '../components/search/FilterSummary';
import { AiMatches } from '../components/search/AiMatches';
import { SmartSearchBar } from '../components/search/SmartSearchBar';
import { SearchModeToggle, type SearchMode } from '../components/search/SearchModeToggle';
import { ProviderCard } from '../components/provider/ProviderCard';
import { Discover } from '../components/discover/Discover';
import { LogoMark } from '../components/brand/Logo';
import { IconSearch, IconMapPin, IconList } from '../components/icons/Icons';
import { trackProviderClick } from '../utils/analytics';
import { distanceKm } from '../utils/geo';
import { tokenize } from '../utils/search';
import { countActiveFilters, defaultFilters } from '../utils/filters';
import type { PostalHit } from '../utils/postalGeocode';
import { buildDiscoverRows } from '../utils/discover';
import type { MapBox, Provider, ProviderFilters, Specialty } from '../types/provider';

/**
 * The map is the heaviest thing this app can load — the Google Maps SDK and
 * an 800-line view. It is unreachable until a search has been run, so
 * splitting it out is no longer just a nice-to-have: the landing page
 * genuinely never pays for it.
 */
const MapView = lazy(() =>
    import('../components/map/MapView').then((m) => ({ default: m.MapView })),
);

const NAV_HEIGHT = 68;
/** First-paint guess for the sticky toolbar; it measures itself once mounted. */
const BAND_HEIGHT = 176;
/** First-paint guess only — rows measure themselves once mounted. */
const ROW_HEIGHT = 164;
const ROW_GAP = 12;

/**
 * The directory, in two states.
 *
 * **Before a search** it is a search box over rows of providers, and there is
 * no map at all. Someone opening a healthcare directory already knows they want
 * a dentist; showing them a viewport full of pins asks them to answer a
 * question they never had.
 *
 * **After a search** the map earns its place, because now it is answering
 * "which of these is near me" about a set the user chose. Which state applies
 * is read off the filters, so the URL alone decides — a shared link to a search
 * opens on results, a shared link to `/` opens on the browse rows.
 */
const AUTO_SEARCH_KEY = 'ms-map-follow';

/**
 * Default on. Read defensively: a browser with site data blocked throws on the
 * accessor itself, and the page must still render with the default rather than
 * fail on a preference.
 */
function readAutoSearch(): boolean {
    try {
        return localStorage.getItem(AUTO_SEARCH_KEY) !== '0';
    } catch {
        return true;
    }
}

export function SearchPage() {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const {
        providers: matched, allProviders, region, filters, updateFilter, patchFilters, resetFilters,
        facets, vocabulary, loading,
        knownPostalCodes, centre, postalPending, postalChoices,
    } = useProviders();

    /**
     * Symptom search runs beside the keyword search, not instead of it.
     *
     * From the smart bar it always runs. From the ordinary box it fires for
     * anything that reads like a description ("me duele el oído desde ayer"),
     * and for any shorter query the keyword engine found nothing for. Names and
     * specialty words come back from the server as "not a concern" and render
     * nothing, so a false trigger costs one request.
     */
    const termCount = tokenize(filters.search).length;
    const aiQuery = filters.smart
        ? (filters.search.trim().length >= 3 ? filters.search.trim() : null)
        : !loading && (termCount >= 3 || (termCount >= 1 && matched.length === 0))
            ? filters.search.trim()
            : null;
    // Answers are drawn from the selected region's reviews, so the matches it
    // returns are providers this page actually holds.
    const ai = useAiSearch(aiQuery, i18n.language?.slice(0, 2) === 'es' ? 'es' : 'en', region);
    const aiHasAnswer = ai.loading || !!ai.result?.isConcern;
    const aiSpecialties = useMemo(() => specialtiesOf(ai.result), [ai.result]);

    /**
     * What the list and the map show. A smart search ignores the text (see
     * useProviders), so on its own it would list the whole directory; it lists
     * the specialties the answer pointed to instead (any of them), and nothing
     * until it has some.
     */
    const providers = useMemo(() => {
        if (!filters.smart) return matched;
        return aiSpecialties.length
            ? matched.filter((p) => p.specialty.some((s) => aiSpecialties.includes(s)))
            : [];
    }, [filters.smart, matched, aiSpecialties]);

    const providerById = useMemo(() => new Map(allProviders.map((p) => [p.id, p])), [allProviders]);

    const activeCount = countActiveFilters(filters);
    // `browse` is the Filters dialog saying "show me the list" with nothing
    // else narrowing it (see ProviderFilters.browse).
    const searching = filters.search !== '' || activeCount > 0 || filters.browse;

    const [view, setView] = useState<'list' | 'map'>('list');
    /**
     * Whether the results follow the map on their own.
     *
     * On by default — the whole point of a split view is that the two panels
     * describe the same place, and a list that ignores where the map is
     * pointing is just a list next to a picture. Persisted, because it is a
     * working style rather than a per-search choice, and someone who turns it
     * off to browse the whole directory should not have to turn it off again
     * on the next search.
     */
    const [autoSearch, setAutoSearch] = useState(readAutoSearch);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [heroOpen, setHeroOpen] = useState(false);
    /**
     * Which box the results toolbar shows. Follows the search that is running
     * (a smart search opens on the smart bar), and the toggle can flip it
     * without running anything.
     */
    const [barMode, setBarMode] = useState<SearchMode>(filters.smart ? 'smart' : 'regular');
    /** Set when the toggle, not a page load, chose the mode: only then is focus moved. */
    const [barToggled, setBarToggled] = useState(false);
    const [seenSmart, setSeenSmart] = useState(filters.smart);
    if (filters.smart !== seenSmart) {
        setSeenSmart(filters.smart);
        setBarMode(filters.smart ? 'smart' : 'regular');
        setBarToggled(false);
    }
    /** The card under the cursor. Forwarded to the map, which lights its pin. */
    const [hoveredId, setHoveredId] = useState<string | null>(null);
    /** The pin under the cursor. The return leg: lights the matching card. */
    const [focusedId, setFocusedId] = useState<string | null>(null);
    /**
     * How many pins the map is actually drawing, against how many results the
     * list holds. The map caps what it renders, so these disagree on any broad
     * search — and a map showing 150 of 807 with nothing saying so reads as a
     * map that lost most of the results.
     */
    const [pinCount, setPinCount] = useState<
        { shown: number; total: number; capped: boolean } | null
    >(null);

    /**
     * The sticky toolbar's real height. The map column parks directly under it,
     * and the toolbar grows by a row whenever the search box is expanded or the
     * chip row wraps — a hardcoded offset leaves the map either overlapped or
     * floating below a gap on exactly the screens where it matters.
     */
    const [bandHeight, setBandHeight] = useState(BAND_HEIGHT);
    const attachBand = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;
        // Set-if-changed: an observer that writes the same number back on every
        // layout pass is one dependency away from an update loop.
        const measure = () => setBandHeight((prev) =>
            prev === node.offsetHeight ? prev : node.offsetHeight);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    /**
     * Above the split breakpoint the list and the map are both on screen, so
     * "map view" is not a state that can exist there. Forcing it back also
     * rescues anyone who toggled to the map on a phone and then widened the
     * window — otherwise the list stays unmounted with no button to bring it
     * back, because the toggle itself is hidden at that width.
     */
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1181px)');
        const sync = () => { if (mq.matches) setView('list'); };
        sync();
        mq.addEventListener('change', sync);
        return () => mq.removeEventListener('change', sync);
    }, []);

    /**
     * Four states, not two. A code we hold is instant; anything else is a
     * geocode, which can still be in flight ('pending'), can come back with a
     * place on each side of the border ('ambiguous'), or can come back with
     * nothing ('unknown'). Collapsing the first three into "unknown" is what
     * made a valid El Paso ZIP read as a typo.
     */
    const postalStatus: 'ok' | 'pending' | 'unknown' | 'ambiguous' =
        !filters.postalCode || knownPostalCodes.has(filters.postalCode) ? 'ok'
            : postalPending ? 'pending'
                : postalChoices.length > 1 ? 'ambiguous'
                    : centre ? 'ok' : 'unknown';

    /** Picking a side both resolves the code and records where they are searching from. */
    const choosePostal = useCallback((hit: PostalHit) => {
        patchFilters({ country: hit.country });
    }, [patchFilters]);

    /** Specialties in directory order — the rail should lead with what we have. */
    const specialtyOrder = useMemo(
        () => vocabulary.specialties.map((s) => s.key),
        [vocabulary],
    );

    /** Every insurer, most common first. Stable across filtering, unlike facets. */
    const insurers = useMemo(
        () => vocabulary.insurers.map((i) => i.label),
        [vocabulary],
    );

    const discoverRows = useMemo(
        () => (searching ? [] : buildDiscoverRows(allProviders, region)),
        [searching, allProviders, region],
    );

    /**
     * Distance from the top of the document to the first result — the window
     * virtualizer converts its offsets into page coordinates with it. A ref
     * read during render is null on the first pass, which would pin the margin
     * at 0 and misplace every row by the height of the toolbar.
     */
    const [listTop, setListTop] = useState(0);
    const attachList = useCallback((node: HTMLDivElement | null) => {
        if (!node) return;
        const measure = () => setListTop((prev) =>
            prev === node.offsetTop ? prev : node.offsetTop);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(document.body);
        return () => observer.disconnect();
    }, []);

    const rowVirtualizer = useWindowVirtualizer({
        count: providers.length,
        estimateSize: () => ROW_HEIGHT + ROW_GAP,
        overscan: 6,
        scrollMargin: listTop,
        // Without this, a card scrolled to from the map parks underneath the
        // nav and the sticky toolbar, which is the one place you cannot read it.
        scrollPaddingStart: NAV_HEIGHT + bandHeight,
    });

    /**
     * Every filter EXCEPT the map viewport, as a comparable string.
     *
     * Two effects key on it rather than on `filters`, and both would misbehave
     * otherwise. The map refits its camera to the results; if a map-driven
     * search re-triggered that refit, the padded fit would land on a tighter
     * box than the one that produced it, filter again, and ratchet inward
     * until a couple of pins are left. And the scroll-to-top below would yank
     * the list back to row one every time the user searched an area.
     */
    const fitKey = useMemo(
        () => JSON.stringify({ ...filters, mapArea: null }),
        [filters],
    );


    // A filter change can shorten the list under a scrolled-down window, which
    // otherwise leaves the user staring at blank space below the last result.
    useEffect(() => {
        if (view === 'list') window.scrollTo({ top: 0 });
    }, [fitKey, view]);

    const runSearch = useCallback((patch: Partial<ProviderFilters>) => {
        setHeroOpen(false);
        patchFilters(patch);
    }, [patchFilters]);

    /**
     * Opening a result now means leaving the search page for the provider's
     * own URL — a dedicated page, not a piece of page state, so it can be
     * bookmarked, shared, and survives a refresh. `trackProviderClick` still
     * fires here rather than on the provider page itself: it is the click on
     * the *listing* that we count, and the destination page doesn't need to
     * know it came from a search result versus, say, a shared link.
     */
    const handleSelect = useCallback((p: Provider) => {
        trackProviderClick(p);
        // `backgroundLocation` opens the profile as a modal over this page
        // (which stays mounted) instead of replacing it; see App.tsx.
        navigate(`/providers/${p.id}`, { state: { backgroundLocation: location } });
    }, [navigate, location]);

    /**
     * A pin's "full details" was clicked. Same navigation as any other result:
     * the pin carries the whole Provider, so it doesn't need to be in the
     * current list to open its page.
     */
    const handleProviderFromMap = useCallback((p: Provider) => {
        handleSelect(p);
    }, [handleSelect]);

    /**
     * Release the viewport whenever a non-spatial filter changes.
     *
     * The map refits to the results, but only while no `mapArea` is set — and
     * with auto-follow on, one is always set. Without this the camera would
     * stay welded wherever it last idled, so searching a clinic two
     * neighbourhoods over, or picking a specialty with a handful of results,
     * would return "nothing in this area" for results that plainly exist.
     *
     * Dropping the area lets the refit run; the next camera settle re-publishes
     * the new box. `fitKey` already excludes `mapArea`, so this cannot re-fire
     * on its own output.
     */
    const lastFitKey = useRef(fitKey);
    useEffect(() => {
        if (lastFitKey.current === fitKey) return;
        lastFitKey.current = fitKey;
        if (autoSearch && filters.mapArea) patchFilters({ mapArea: null }, true);
    }, [fitKey, autoSearch, filters.mapArea, patchFilters]);

    const handleAutoSearchChange = useCallback((next: boolean) => {
        setAutoSearch(next);
        try {
            localStorage.setItem(AUTO_SEARCH_KEY, next ? '1' : '0');
        } catch {
            // Private mode, or site data blocked. The toggle still works for
            // this session; only the memory of it is lost.
        }
        // Turning it off releases the viewport — otherwise the last camera box
        // stays welded to the results with nothing on screen still claiming
        // responsibility for it.
        if (!next) patchFilters({ mapArea: null }, true);
    }, [patchFilters]);

    /** "Search this area" — narrow the results to the current camera box. */
    const handleSearchArea = useCallback((box: MapBox) => {
        // Replace rather than push: panning should not turn Back into a
        // re-enactment of every camera move the user made.
        patchFilters({ mapArea: box }, true);
    }, [patchFilters]);

    const handleVisibleCount = useCallback((shown: number, total: number, capped: boolean) => {
        setPinCount((prev) => (
            prev && prev.shown === shown && prev.total === total && prev.capped === capped
                ? prev
                : { shown, total, capped }
        ));
    }, []);

    const handleProviderSuggestion = useCallback((id: string) => {
        const p = allProviders.find((x) => x.id === id);
        if (p) handleSelect(p);
    }, [allProviders, handleSelect]);

    const toggleSpecialty = useCallback((s: Specialty) => {
        updateFilter(
            'specialty',
            filters.specialty.includes(s)
                ? filters.specialty.filter((x) => x !== s)
                : [...filters.specialty, s],
        );
    }, [filters.specialty, updateFilter]);

    /** Undefined outside a location search, or when a provider has no coordinates. */
    const distanceOf = useCallback((p: Provider) => {
        if (!centre || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return undefined;
        return distanceKm(centre.lat, centre.lng, p.lat, p.lng);
    }, [centre]);

    const handleAiSpecialty = useCallback((s: Specialty) => {
        patchFilters({ search: '', smart: false, specialty: [s] });
    }, [patchFilters]);

    /**
     * The hero's WHERE, as currently shown — possibly changed but not yet
     * committed. A ref: it only matters at the moment a smart search runs.
     */
    const heroWhereRef = useRef<HeroWhere | null>(null);
    const handleHeroWhere = useCallback((where: HeroWhere | null) => {
        heroWhereRef.current = where;
    }, []);

    /**
     * On the home page the smart bar sits under the segmented box, and a
     * visitor who switched WHERE to San Diego – Tijuana and then described
     * their problem expects Tijuana's reviews — the same place the Search
     * button would have searched. So the box's draft WHERE goes with it, the
     * way the Search button commits it. With no box on screen (the results
     * toolbar's smart mode) the committed WHERE stands.
     */
    const runSmartSearch = useCallback((text: string) => {
        const where = heroWhereRef.current;
        runSearch({
            search: text, smart: true, specialty: [],
            ...(where ? {
                region: where.region,
                country: where.country,
                postalCode: where.postalCode,
                // A camera box over the old region means nothing in the new one.
                ...(where.region !== filters.region ? { mapArea: null } : {}),
            } : {}),
        });
    }, [runSearch, filters.region]);

    /**
     * The Filters dialog changes the URL as you tick, so its edits go through
     * here: every one also sets `browse`, which keeps the results list up
     * when the only thing chosen is a region (or everything was cleared) —
     * "Show 4,067 results" has to show them, not the landing rows.
     */
    const updateFilterFromDialog = useCallback(
        <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => {
            patchFilters({ [key]: value, browse: true } as Partial<ProviderFilters>);
        },
        [patchFilters],
    );
    const patchFiltersFromDialog = useCallback(
        (patch: Partial<ProviderFilters>) => patchFilters({ ...patch, browse: true }),
        [patchFilters],
    );
    const resetFiltersFromDialog = useCallback(
        () => patchFilters({ ...defaultFilters, region, browse: true }),
        [patchFilters, region],
    );

    /**
     * A smart search's text is a description, not keywords, so the regular box
     * opens empty rather than pre-filled with it. Memoised: SearchHero resets
     * its draft whenever it is handed a new filters object.
     */
    const heroFilters = useMemo(
        () => (filters.smart ? { ...filters, search: '' } : filters),
        [filters],
    );

    const hero = (
        <SearchHero
            filters={heroFilters}
            vocabulary={vocabulary}
            insurers={insurers}
            // The segmented box always means keywords, even when it is
            // refining a search that started in the smart bar.
            onSubmit={(patch) => runSearch({ ...patch, smart: false })}
            onProvider={handleProviderSuggestion}
            autoFocus={heroOpen}
            onWhereChange={handleHeroWhere}
            // The region is the page's scope; switching it must not wait for Search.
            onRegionChange={patchFilters}
        />
    );

    return (
        <div className="ms-page" style={{ paddingTop: NAV_HEIGHT }}>
            {searching ? (
                <>
                    {/* ── Results toolbar ── */}
                    <div ref={attachBand} className="ms-band" style={{ top: NAV_HEIGHT }}>
                        <div className="ms-band-inner">
                            <SearchModeToggle
                                mode={barMode}
                                onChange={(mode) => {
                                    setBarMode(mode);
                                    setBarToggled(true);
                                    // Switching to the regular search opens the full box, ready to
                                    // type in; the collapsed pill would need a second tap.
                                    setHeroOpen(mode === 'regular');
                                }}
                            />

                            {barMode === 'smart' ? (
                                <div className="ms-band-pill">
                                    <SmartSearchBar
                                        compact
                                        autoFocus={barToggled}
                                        initial={filters.smart ? filters.search : ''}
                                        onSubmit={runSmartSearch}
                                    />
                                </div>
                            ) : heroOpen ? hero : (
                                <div className="ms-band-pill">
                                    <SearchPill filters={heroFilters} onExpand={() => setHeroOpen(true)} />
                                </div>
                            )}

                            <CategoryRail
                                order={specialtyOrder}
                                active={filters.specialty}
                                onToggle={toggleSpecialty}
                            />

                            <FilterChipRow
                                filters={filters}
                                updateFilter={updateFilter}
                                patchFilters={patchFilters}
                                facets={facets}
                                activeCount={activeCount}
                                onOpenFilters={() => setFiltersOpen(true)}
                            />
                        </div>
                    </div>

                    <div className={`ms-results${view === 'map' ? ' is-map' : ''}`}>
                        {/* ── List ──
                            Rendered, not merely hidden, when the map has the
                            screen to itself: a display:none list still reports
                            zero-height rows to the virtualizer, which resizes
                            the body, which re-fires the observer that measures
                            the list. That loop is a hard crash, not a flicker. */}
                        {view === 'list' && (
                        <div className="ms-results-list">
                            <FilterSummary
                                filters={filters}
                                updateFilter={updateFilter}
                                patchFilters={patchFilters}
                                resetFilters={resetFilters}
                                count={providers.length}
                                countLabel={!loading && (filters.smart || providers.length === 0) && aiHasAnswer
                                    ? (ai.loading ? t('ai.countLoading') : t('ai.countLabel'))
                                    : undefined}
                                activeCount={activeCount}
                                postalStatus={postalStatus}
                                postalChoices={postalChoices}
                                onChoosePostal={choosePostal}
                            />

                            <AiMatches
                                result={ai.result}
                                loading={ai.loading}
                                providerById={providerById}
                                region={region}
                                onSelect={handleSelect}
                                onSpecialty={handleAiSpecialty}
                                distanceOf={distanceOf}
                            />

                            {filters.smart && aiSpecialties.length > 0 && providers.length > 0 && (
                                <p style={{ margin: '1.25rem 0 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--white)' }}>
                                    {t('ai.moreIn', {
                                        specialty: aiSpecialties
                                            .map((s) => t(`specialties.${s}`, { defaultValue: s }))
                                            .join(' · '),
                                        formatted: providers.length.toLocaleString(),
                                    })}
                                </p>
                            )}

                            {loading ? (
                                <div style={{
                                    display: 'flex', flexDirection: 'column',
                                    gap: `${ROW_GAP}px`, marginTop: '0.9rem',
                                }}>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <div
                                            key={i}
                                            className="skeleton"
                                            style={{
                                                width: '100%', height: ROW_HEIGHT,
                                                borderRadius: 'var(--radius)',
                                                border: '1px solid var(--border)',
                                            }}
                                        />
                                    ))}
                                </div>
                            ) : providers.length === 0 ? (
                                // The AI panel above is the answer; a "no clinics" box under it reads as a contradiction.
                                aiHasAnswer ? null : <EmptyState onClear={resetFilters} />
                            ) : (
                                <div ref={attachList} style={{ marginTop: '0.9rem' }}>
                                    <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                                        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                                            const p = providers[virtualRow.index];
                                            return (
                                                <div
                                                    key={p.id}
                                                    data-index={virtualRow.index}
                                                    ref={rowVirtualizer.measureElement}
                                                    style={{
                                                        position: 'absolute', top: 0, left: 0, width: '100%',
                                                        transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                                                        paddingBottom: ROW_GAP,
                                                    }}
                                                >
                                                    <ProviderCard
                                                        provider={p}
                                                        selected={false}
                                                        onClick={handleSelect}
                                                        onHover={setHoveredId}
                                                        focused={focusedId === p.id}
                                                        distance={distanceOf(p)}
                                                        // Only the first few rows are above the fold when
                                                        // the list first paints; the virtualizer recycles
                                                        // this component past that so index alone is a
                                                        // safe, cheap check (no scroll-position tracking).
                                                        priority={virtualRow.index < 4}
                                                    />
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                        )}

                        {/* ── Map ── */}
                        <div
                            className="ms-results-map"
                            style={{
                                top: NAV_HEIGHT + bandHeight,
                                height: `calc(100dvh - ${NAV_HEIGHT + bandHeight}px)`,
                            }}
                        >
                            {/* The map draws a capped subset of the results.
                                Saying so is what keeps a map showing 150 of 807
                                from reading as a map that lost 657 clinics.
                                The note itself is rendered inside MapView's
                                top overlay stack (alongside the "search as I
                                move" toggle) so the two pills can never
                                overlap — we just hand down the text. */}
                            <Suspense fallback={<MapPlaceholder label={t('map.loading')} />}>
                                <MapView
                                    providers={providers}
                                    allProviders={allProviders}
                                    region={region}
                                    onProviderSelect={handleProviderFromMap}
                                    hoveredId={hoveredId}
                                    onProviderFocus={setFocusedId}
                                    onSearchArea={handleSearchArea}
                                    onBoundsChange={handleSearchArea}
                                    autoSearch={autoSearch}
                                    onAutoSearchChange={handleAutoSearchChange}
                                    mapArea={filters.mapArea}
                                    fitKey={fitKey}
                                    onVisibleCountChange={handleVisibleCount}
                                    topNote={pinCount && pinCount.shown < pinCount.total
                                        ? t(pinCount.capped ? 'map.showingCapped' : 'map.showingInView', {
                                            shown: pinCount.shown,
                                            total: pinCount.total,
                                        })
                                        : undefined}
                                />
                            </Suspense>
                        </div>
                    </div>

                    {/* The split is a desktop luxury; on a phone the two views
                        take turns, and this is how you switch. */}
                    <button
                        onClick={() => setView(view === 'map' ? 'list' : 'map')}
                        className="ms-view-fab press"
                    >
                        {view === 'map' ? <IconList size={16} /> : <IconMapPin size={16} />}
                        {view === 'map' ? t('map.listShort') : t('map.mapShort')}
                    </button>
                </>
            ) : (
                <>
                    {/* ── Discover ── */}
                    <section className="ms-hero-section">
                        <div className="ms-hero-copy">
                            <h1 className="display ms-hero-title">
                                {t('discover.heroTitle')}
                            </h1>
                            <p className="ms-hero-sub">{t('discover.heroSubtitle')}</p>
                        </div>
                        {hero}
                        <SmartSearchBar onSubmit={runSmartSearch} />
                    </section>

                    <div className="ms-cats-band">
                        <div className="ms-band-inner">
                            <CategoryRail
                                order={specialtyOrder}
                                active={filters.specialty}
                                onToggle={toggleSpecialty}
                            />
                        </div>
                    </div>

                    <div className="ms-discover">
                        <Discover
                            rows={discoverRows}
                            loading={loading}
                            onSelect={handleSelect}
                            onSeeAll={runSearch}
                        />
                    </div>
                </>
            )}

            {filtersOpen && (
                <FilterModal
                    filters={filters}
                    updateFilter={updateFilterFromDialog}
                    patchFilters={patchFiltersFromDialog}
                    resetFilters={resetFiltersFromDialog}
                    facets={facets}
                    count={providers.length}
                    onClose={() => setFiltersOpen(false)}
                />
            )}
        </div>
    );
}

function MapPlaceholder({ label }: { label: string }) {
    return (
        <div style={{
            position: 'absolute', inset: 0, background: 'var(--surface)',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '1.1rem',
        }}>
            <LogoMark size={48} idle />
            <p style={{
                color: 'var(--gray-400)', fontWeight: 700,
                letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: '0.72rem',
            }}>
                {label}
            </p>
        </div>
    );
}

function EmptyState({ onClear }: { onClear: () => void }) {
    const { t } = useTranslation();
    return (
        <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--gray-400)' }}>
            <div style={{
                width: 64, height: 64, margin: '0 auto 1.25rem', borderRadius: '50%',
                background: 'var(--surface)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--gray-600)',
            }}>
                <IconSearch size={28} />
            </div>
            <p style={{ marginBottom: '0.6rem', fontSize: '1rem', color: 'var(--white)', fontWeight: 600 }}>
                {t('map.noResults')}
            </p>
            <button
                onClick={onClear}
                style={{ color: 'var(--gold)', background: 'none', fontSize: '0.9rem', marginBottom: '2rem', fontWeight: 700 }}
            >
                {t('filters.clearFilters')}
            </button>
            <div style={{ paddingTop: '1.75rem', borderTop: '1px solid var(--border)', maxWidth: 420, margin: '0 auto' }}>
                <p style={{ marginBottom: '0.9rem', fontSize: '0.9rem' }}>{t('map.suggestClinic')}</p>
                <a
                    href="mailto:hello@medsociety.one?subject=Suggest%20a%20Clinic"
                    className="press"
                    style={{
                        display: 'inline-flex', padding: '0.65rem 1.25rem',
                        borderRadius: 'var(--radius-pill)',
                        background: 'var(--surface)', border: '1px solid var(--border)',
                        color: 'var(--white)', fontWeight: 700, fontSize: '0.9rem',
                    }}
                >
                    {t('map.suggestBtn')}
                </a>
            </div>
        </div>
    );
}
