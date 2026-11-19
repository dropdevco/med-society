import type { MapBox, ProviderFilters, SortMode, Specialty } from '../../src/types/provider';
import type { SuggestVocabulary } from '../../src/utils/facets';
import type { RegionId } from '../../src/utils/region';

export type Lang = 'en' | 'es';

/** One sample search. `filters` is applied over the defaults and the region. */
export interface Case {
    name: string;
    filters: Partial<ProviderFilters>;
    /** What the AI answer resolved a smart search to (the page gets it from /api/ai-search). */
    aiSpecialties?: Specialty[];
    /** A postal centre the geocoder returned, for a code no listing carries. */
    geocoded?: { lat: number; lng: number };
}

/** The page's answer to one search. */
export interface Answer {
    case: string;
    total: number;
    /** Every result, in order. */
    ids: string[];
    sortApplied: SortMode;
    centre: { lat: number; lng: number } | null;
    /** The box the map frames the results with, when there is no map area. */
    frame: MapBox | null;
    /** The first results that can be pinned, in order (plan section 5.7). */
    pins: string[];
    facets: {
        specialty: [string, number][];
        insurance: [string, number][];
        language: [string, number][];
        verified: number;
        withPricing: number;
    };
}

/** What the page derives once per region and language. */
export interface RegionAnswer {
    region: RegionId;
    lang: Lang;
    rows: number;
    prior: number;
    bounds: MapBox | null;
    postalCentres: [string, { lat: number; lng: number }][];
    vocabulary: Omit<SuggestVocabulary, 'providers'>;
    providerNames: number;
    suggestions: { q: string; items: string[] }[];
    home: { id: string; ids: string[] }[];
}

/** An engine answers the same questions as the browser; the parity check compares them. */
export interface Engine {
    name: string;
    region(region: RegionId, lang: Lang): Promise<RegionAnswer>;
    search(region: RegionId, lang: Lang, c: Case): Promise<Answer>;
}
