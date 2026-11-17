/**
 * The browser's answer: what the directory page computes today for a search,
 * from a region's `provider_list` rows. Mirrors src/hooks/useProviders.ts and
 * the smart-search narrowing in src/pages/SearchPage.tsx step by step, using
 * the same modules, so it is the specification a server engine is held to.
 *
 * If useProviders or SearchPage change how results are derived, change this
 * file with them (docs/server-search-plan.md, section 9).
 */
import type { MapBox, Provider, ProviderFilters, Specialty } from '../../src/types/provider';
import { normalizeProvider } from '../../src/utils/normalizeProvider';
import { buildSearchIndex, tokenize } from '../../src/utils/search';
import { applyFilters, defaultFilters, effectiveSort, type FilterContext } from '../../src/utils/filters';
import { buildFacets, buildVocabulary, suggest, type SuggestVocabulary } from '../../src/utils/facets';
import { buildDiscoverRows } from '../../src/utils/discover';
import { priorMean } from '../../src/utils/rating';
import { postalCentroidsOf } from '../../src/utils/postalCentroids';
import { boundsOf, framingBoxOf } from '../../src/utils/mapBounds';
import type { RegionId } from '../../src/utils/region';
import en from '../../src/i18n/locales/en.json';
import es from '../../src/i18n/locales/es.json';
import type { Answer, Case, Lang, RegionAnswer } from './types';

/** How many pins the results response carries (plan section 5.7). */
export const PIN_LIMIT = 400;

const LOCALES = { en, es } as const;

/** `t('specialties.<key>', { defaultValue: key })`, as useProviders' labelOf. */
export function labelOfFor(lang: Lang): (s: Specialty) => string {
    const table = (LOCALES[lang] as { specialties?: Record<string, string> }).specialties ?? {};
    return (s) => table[s] ?? s;
}

/** Everything useProviders derives once per [rows, language]. */
export interface Prepared {
    region: RegionId;
    lang: Lang;
    providers: Provider[];
    index: ReturnType<typeof buildSearchIndex>;
    /** The vocabulary the suggester sees, postals already narrowed to trusted centres. */
    vocabulary: SuggestVocabulary;
    centroids: Map<string, { lat: number; lng: number }>;
    prior: number;
}

export function prepare(rows: readonly Record<string, unknown>[], region: RegionId, lang: Lang): Prepared {
    const providers = rows.map(normalizeProvider);
    const labelOf = labelOfFor(lang);
    const index = buildSearchIndex(providers, labelOf);
    const raw = buildVocabulary(providers, labelOf, region);
    const centroids = postalCentroidsOf(providers, region);
    const vocabulary = { ...raw, postals: raw.postals.filter((p) => centroids.has(p.label)) };
    return { region, lang, providers, index, vocabulary, centroids, prior: priorMean(providers) };
}

const sortedCounts = <K extends string>(m: Map<K, number>): [K, number][] =>
    [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

/** One search, as the page would show it. */
export function answer(prep: Prepared, c: Case): Answer {
    const filters: ProviderFilters = { ...defaultFilters, region: prep.region, ...c.filters };

    // Centre: a code we hold resolves from our own rows; a geocoded one is
    // given by the case (the page asks the geocoder for it).
    let centre: { lat: number; lng: number } | null = null;
    if (filters.postalCode) {
        centre = prep.centroids.get(filters.postalCode) ?? c.geocoded ?? null;
    }

    const ctx: FilterContext = {
        index: prep.index,
        terms: filters.smart ? [] : tokenize(filters.search),
        centre,
        prior: prep.prior,
    };
    const matched = applyFilters(prep.providers, filters, ctx);
    const ai = c.aiSpecialties ?? [];
    const shown = !filters.smart
        ? matched
        : ai.length ? matched.filter((p) => p.specialty.some((s) => ai.includes(s))) : [];

    const facets = buildFacets(prep.providers, { ...filters, mapArea: null }, { ...ctx, terms: [] });

    return {
        case: c.name,
        total: shown.length,
        ids: shown.map((p) => p.id),
        sortApplied: effectiveSort(filters, ctx),
        centre,
        frame: filters.mapArea ? null : roundBox(framingBoxOf(shown)),
        pins: shown.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)).slice(0, PIN_LIMIT).map((p) => p.id),
        facets: {
            specialty: sortedCounts(facets.specialty),
            insurance: sortedCounts(facets.insurance),
            language: sortedCounts(facets.language),
            verified: facets.verified,
            withPricing: facets.withPricing,
        },
    };
}

/** Prefixes typed into the search box, for the suggestion check. */
export const SUGGEST_PREFIXES = [
    'de', 'den', 'dent', 'orto', 'gine', 'pedi', 'card', 'tij', 'jua', 'san', 'el p', 'imp', 'blanq',
    'hosp', 'clin', 'poli', 'dra', 'mar', 'jose', 'gnp', 'axa', 'met', '22', '220', '32', '323', '79', '921', 'zz',
];

/** What the page derives once per region and language. */
export function regionAnswer(prep: Prepared): RegionAnswer {
    const { providers: names, ...vocab } = prep.vocabulary;
    return {
        region: prep.region,
        lang: prep.lang,
        rows: prep.providers.length,
        prior: prep.prior,
        bounds: roundBox(boundsOf(prep.providers)),
        postalCentres: [...prep.centroids.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)),
        vocabulary: vocab,
        providerNames: names.length,
        suggestions: SUGGEST_PREFIXES.map((q) => ({
            q,
            items: suggest(prep.vocabulary, q).map((s) => `${s.kind}:${s.value}`),
        })),
        home: buildDiscoverRows(prep.providers, prep.region).map((r) => ({ id: r.id, ids: r.providers.map((p) => p.id) })),
    };
}

/** Boxes go over JSON; keep the comparison about position, not float noise. */
function roundBox(b: MapBox | null): MapBox | null {
    if (!b) return null;
    const r = (n: number) => Math.round(n * 1e6) / 1e6;
    return { north: r(b.north), south: r(b.south), east: r(b.east), west: r(b.west) };
}
