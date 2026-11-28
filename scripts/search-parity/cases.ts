/**
 * The sample searches the parity check runs (docs/server-search-plan.md,
 * section 9). Every one runs in both interface languages.
 *
 * Insurers and languages are taken from the region's own vocabulary (its most
 * common ones), so the cases keep meaning something as the data changes.
 */
import type { MapBox, SortMode } from '../../src/types/provider';
import type { RegionId } from '../../src/utils/region';
import type { Prepared } from './reference';
import type { Case } from './types';

/** Places each region's cases point at: a code we hold, one we may not, a box downtown. */
const PLACES: Record<RegionId, {
    heldPostal: string;
    otherPostal: string;
    /** A code from the US side, answered by the geocoder in the page. */
    geocodedPostal: { code: string; lat: number; lng: number };
    downtown: MapBox;
    clinicName: string;
}> = {
    'sandiego-tijuana': {
        heldPostal: '22000',
        otherPostal: '22010',
        geocodedPostal: { code: '92173', lat: 32.5556, lng: -117.0470 },
        downtown: { south: 32.5, west: -117.06, north: 32.54, east: -117.0 },
        clinicName: 'hospital angeles',
    },
    'elpaso-juarez': {
        heldPostal: '32000',
        otherPostal: '32300',
        geocodedPostal: { code: '79901', lat: 31.7587, lng: -106.4869 },
        downtown: { south: 31.72, west: -106.5, north: 31.76, east: -106.42 },
        clinicName: 'poliplaza',
    },
};

const SORTS: SortMode[] = ['relevance', 'rating', 'reviews', 'distance', 'price'];

export function casesFor(region: RegionId, prep: Prepared): Case[] {
    const place = PLACES[region];
    const topInsurer = prep.vocabulary.insurers[0]?.label ?? 'GNP';
    const secondInsurer = prep.vocabulary.insurers[1]?.label ?? 'AXA';

    const text = (q: string): Case => ({ name: `q=${q}`, filters: { search: q } });

    return [
        // Nothing typed: the default browse order (curated, placement, rating).
        { name: 'browse (list=1)', filters: { browse: true } },

        // Specialty words, both languages, accents.
        ...['dentist', 'dentista', 'pediatra', 'pediatría', 'pediatria', 'cardiologo', 'psicologo'].map(text),
        // Synonyms and stems.
        ...['muela', 'gineco', 'ginecologo', 'oido', 'brackets', 'lentes', 'urgencias'].map(text),
        // Half-typed words.
        ...['dent', 'orto', 'ginec', 'card', 'derma'].map(text),
        // Names and clinics, and a word nothing matches.
        ...['dra ana', 'maria', place.clinicName, 'zzqxv'].map(text),
        // Several words, and one that mixes a service with a place.
        ...['dentista centro', 'implantes dentales tijuana', 'limpieza dental', 'consulta general'].map(text),
        // Noise: stopwords only, one letter, digits, an insurer typed as text.
        ...['the doctor', 'x', '22000', topInsurer].map(text),

        // Filters on their own.
        { name: 'spec=dentist', filters: { specialty: ['dentist'] } },
        { name: 'spec=dentist,orthodontist', filters: { specialty: ['dentist', 'orthodontist'] } },
        { name: 'spec=dentist country=MX', filters: { specialty: ['dentist'], country: 'MX' } },
        { name: 'spec=general country=US', filters: { specialty: ['general'], country: 'US' } },
        { name: 'country=US', filters: { country: 'US' } },
        { name: 'rating>=4.5', filters: { minRating: 4.5 } },
        { name: `ins=${topInsurer}`, filters: { insurances: [topInsurer] } },
        { name: `ins=${topInsurer},${secondInsurer}`, filters: { insurances: [topInsurer, secondInsurer] } },
        { name: 'lang=en', filters: { languages: ['en'] } },
        { name: 'verified', filters: { verifiedOnly: true } },
        { name: 'priced', filters: { withPricing: true } },
        { name: 'priced max=800', filters: { withPricing: true, maxPriceMxn: 800 } },

        // Filters combined with text.
        { name: 'q=dentista spec=dentist rating>=4.5', filters: { search: 'dentista', specialty: ['dentist'], minRating: 4.5 } },
        { name: 'q=limpieza priced country=MX', filters: { search: 'limpieza', withPricing: true, country: 'MX' } },

        // Places: a code we hold, a second one, one only the geocoder knows, an unknown one.
        { name: `near=${place.heldPostal}`, filters: { postalCode: place.heldPostal } },
        { name: `near=${place.heldPostal} r=10 spec=dentist`, filters: { postalCode: place.heldPostal, radiusKm: 10, specialty: ['dentist'] } },
        { name: `near=${place.otherPostal} q=dentista`, filters: { postalCode: place.otherPostal, search: 'dentista' } },
        {
            name: `near=${place.geocodedPostal.code} (geocoded) r=25`,
            filters: { postalCode: place.geocodedPostal.code, radiusKm: 25 },
            geocoded: { lat: place.geocodedPostal.lat, lng: place.geocodedPostal.lng },
        },
        { name: 'near=00000 (unknown)', filters: { postalCode: '00000' } },

        // The map box, alone and with a query.
        { name: 'area=downtown', filters: { mapArea: place.downtown } },
        { name: 'area=downtown q=dentista', filters: { mapArea: place.downtown, search: 'dentista' } },

        // Every sort, on the same query.
        ...SORTS.map((sort): Case => ({ name: `q=dentista sort=${sort}`, filters: { search: 'dentista', sort } })),
        { name: `spec=dentist near=${place.heldPostal} sort=distance`, filters: { specialty: ['dentist'], postalCode: place.heldPostal, sort: 'distance' } },

        // Smart search: text ignored, narrowed to what the AI answer named; nothing before it answers.
        { name: 'smart, two AI specialties', filters: { search: 'me duele el oído desde ayer', smart: true }, aiSpecialties: ['otolaryngology', 'general'] },
        { name: 'smart + country=MX', filters: { search: 'dolor de muela', smart: true, country: 'MX' }, aiSpecialties: ['dentist'] },
        { name: 'smart, no answer yet', filters: { search: 'me duele la cabeza', smart: true }, aiSpecialties: [] },
    ];
}
