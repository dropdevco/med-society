/**
 * The browse rows shown before anyone has searched.
 *
 * Airbnb's home page never asks "where do you want to go?" and then shows you a
 * map — it shows you rows of places, because a picture is a better invitation
 * than an empty viewport. These rows are the same idea: each one is a *preview
 * of a search*, so clicking through hands the user a real, filtered result set
 * rather than a curated dead end.
 *
 * Every row is derived from the loaded directory, so a row can never advertise
 * a search that returns nothing — a candidate with too few providers behind it
 * is simply dropped. The directory holds one border region at a time, so the
 * rows are that region's, and the city-named ones name its cities ("Dentists
 * in Tijuana", "Primary care in El Paso"). A side with no providers yet — San
 * Diego, before its sweep — drops its row by the same rule.
 */

import type { Provider, ProviderFilters } from '../types/provider';
import { portraitUrl } from './images';
import type { RegionId } from './region';
import { isFocusedOn } from './filters';

export interface DiscoverRow {
    id: string;
    /** i18n key for the heading. */
    titleKey: string;
    /** The exact search this row previews. "See all" applies it verbatim. */
    filters: Partial<ProviderFilters>;
    providers: Provider[];
}

/** Below this a row looks like a mistake rather than a category. */
const MIN_ROW = 6;
/** Beyond this nobody scrolls, and every extra tile is an image request. */
const ROW_SIZE = 14;

/**
 * Rating alone puts a single five-star review above a 4.8 with three hundred.
 * Pulling each score toward the directory mean, weighted by how many reviews
 * back it, is what stops the browse rows filling with one-review clinics.
 */
const PRIOR = 25;
const MEAN = 4.4;

function confidence(p: Provider): number {
    const n = p.reviewCount || 0;
    return ((p.rating || 0) * n + MEAN * PRIOR) / (n + PRIOR);
}

/**
 * Portraits first. A row of eight photos and six monograms reads as broken;
 * a row that front-loads the photos reads as curated, and the monograms that
 * follow look deliberate.
 */
function browseOrder(a: Provider, b: Provider): number {
    const pa = portraitUrl(a.imageUrl) ? 1 : 0;
    const pb = portraitUrl(b.imageUrl) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (a.promoted !== b.promoted) return a.promoted ? -1 : 1;
    return confidence(b) - confidence(a);
}

interface Candidate {
    id: string;
    /** i18n key; `{region}` is replaced with the selected region's id. */
    titleKey: string;
    filters: Partial<ProviderFilters>;
    match: (p: Provider) => boolean;
    /**
     * Provider ids to force into the front of this row, in this order, ahead
     * of `browseOrder`. Separate from `featuredRank` on purpose — that field
     * is one sitewide list already spoken for by other clinics, while this is
     * a per-row pick that has no business displacing them.
     */
    pinnedIds?: string[];
}

/**
 * Ordered by how much of the directory they speak for, so the first screen a
 * new visitor sees is the border's two biggest questions — a dentist on the
 * Mexican side, a doctor on the US side — rather than a niche.
 *
 * The per-side rows filter on `country` alone: within the loaded region that
 * already means one city.
 */
/*
 * Specialty rows match only providers *focused* on that specialty (their
 * primary one, or one of a few — see isFocusedOn). A general hospital tagged
 * with thirteen specialties is a fine result for "dentist", but "Top-rated
 * dentists in Tijuana" opening on Hospital Angeles, Centro Médico Premier and
 * Hospital Bethel reads as a wrong answer, not a broad one.
 */
const CANDIDATES: Candidate[] = [
    {
        id: 'dentists-mx',
        titleKey: 'regions.rows.{region}.dentists',
        filters: { specialty: ['dentist'], country: 'MX' },
        match: (p) => p.country === 'MX' && isFocusedOn(p, 'dentist'),
        // Picked by hand for their photos; fills a large-monitor row.
        pinnedIds: [
            // Tijuana (ids outside the loaded region never match).
            'b6e2963a-1b5b-4191-af36-d9eeba68ae6e', // Dr. Christian Lizalde Swain
            '4a4d98ff-9023-4962-81df-7b497f2c70fe', // Dr. Diego Tirado
            '147262c5-a74c-48bd-ab66-3db39c1d1492', // Dra. Adriana Lares Aviles
            'ddc60f98-9f54-40d4-be00-d8f5a4f32581', // Dr. Eduardo Zamora Murguia
            '90cff5d4-48dd-44d6-91ad-46c49167ad46', // Dra. Pilar Fernández Guzmán
            'ee2e800e-4891-43a2-91e4-8819b37a39e2', // Dra. Adaris Arleen Ruiz Mena
            // Juárez.
            '7942ede4-af3d-4ca4-9aff-43673c503f00', // Dra. Laura Karina Uribe Fentanes
            '931ca3a3-0fe1-4521-8d52-c6820ccfda60', // Dra. Silma Chavez Rios
            '0e25b2e4-fb3c-40ef-ab6f-0d2206153f63', // Dr. Ever Renteria Sepulveda
            'b7275c56-7224-4bc3-ba46-c318fcaa95b3', // Dra. Patricia Cordova Samaniego
            'd4ed6cd2-e898-4116-a5ca-c7a83471dc2a', // Dra. Nantli Vega Menchaca
            '0ba48af3-5071-43c6-9b69-d250bfc45ade', // Dra. Janeth Valenzuela
        ],
    },
    {
        id: 'primary-us',
        titleKey: 'regions.rows.{region}.primary',
        filters: { specialty: ['general'], country: 'US' },
        match: (p) => p.country === 'US' && isFocusedOn(p, 'general'),
        // Picked by hand (San Diego, then El Paso; ids outside the loaded region never match).
        pinnedIds: [
            '5a9ac1e2-7c7f-4b4c-a074-4916bb615144', // Advanced Functional Medicine
            '9d3e2bdf-3ccd-4fa6-92a5-349a46c6e90c', // Natural Health & Acupuncture in San Diego
            '9e41ed34-ce0d-429c-8011-a94386242974', // Julie Roth, DO - Shoreline Medical Group
            '76601617-50bd-4998-8c4b-1f9040c13c09', // Premier Primary Care Clinic (George Dieter Dr)
            'c63d8264-3664-4936-afbf-864b265c14db', // El Paso Primary Care
            'd029f7b5-2e9a-49ca-a264-163b29db3332', // Village Medical - South Mesa Hills
            'a5efd858-9ce1-42bf-b1a3-fa6f111dce05', // Essential Care Clinic LLC
            'f9f9283f-bbce-4f4f-bee9-264405890fd2', // Madrid Family Care Clinic
            '9f3ab02b-8730-4b9a-83df-31c07323deab', // Primary Care Complete
        ],
    },
    {
        id: 'published-prices',
        titleKey: 'discover.publishedPrices',
        filters: { withPricing: true },
        match: (p) => p.priceFromMxn != null,
    },
    {
        id: 'womens-health',
        titleKey: 'discover.womensHealth',
        filters: { specialty: ['obgyn'] },
        match: (p) => isFocusedOn(p, 'obgyn'),
        // Picked by hand for their photos (Tijuana).
        pinnedIds: [
            '4e31800f-0ad8-40ce-8ef1-87775643d268', // Dra. Rosalva Jímenez Barriga
            '84832062-b991-431e-90f4-7322ecad3ed8', // Dra. Linda Vargas
            '9c06389a-8b47-4b31-8f90-3c9001c7843a', // Dra. Diana Luna Guerrero
            '88487971-50d4-4009-baa2-709b41f95408', // Dra. Silvia Guadalupe Sánchez Meza
            '027ee4d2-e755-4882-9741-d5ff5655714d', // Dra. Aleyda Fernanda Armenta Rios
            '3510af92-3010-4c1c-8549-0ec187afbf93', // Dra. Viridiana Martinez Avendaño
        ],
    },
    {
        id: 'mental-health',
        titleKey: 'discover.mentalHealth',
        filters: { specialty: ['mental_health'] },
        match: (p) => isFocusedOn(p, 'mental_health'),
    },
    {
        id: 'pediatrics',
        titleKey: 'discover.pediatrics',
        filters: { specialty: ['pediatrics'] },
        match: (p) => isFocusedOn(p, 'pediatrics'),
    },
    {
        id: 'aesthetic-mx',
        titleKey: 'regions.rows.{region}.aesthetic',
        filters: { specialty: ['plastic_surgery'], country: 'MX' },
        match: (p) => p.country === 'MX' && isFocusedOn(p, 'plastic_surgery'),
    },
];

export function buildDiscoverRows(providers: readonly Provider[], region: RegionId): DiscoverRow[] {
    if (providers.length === 0) return [];

    const rows: DiscoverRow[] = [];
    for (const c of CANDIDATES) {
        const hits = providers.filter(c.match);
        if (hits.length < MIN_ROW) continue;

        const pinned = (c.pinnedIds ?? [])
            .map((id) => hits.find((p) => p.id === id))
            .filter((p): p is Provider => p != null);
        const pinnedIds = new Set(pinned.map((p) => p.id));
        const rest = hits.filter((p) => !pinnedIds.has(p.id)).sort(browseOrder);

        rows.push({
            id: c.id,
            titleKey: c.titleKey.replace('{region}', region),
            filters: { ...c.filters, region },
            providers: [...pinned, ...rest].slice(0, ROW_SIZE),
        });
    }
    return rows;
}
