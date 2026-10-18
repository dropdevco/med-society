import type { Provider, Specialty } from '../types/provider';
import { ratingOf } from './rating';
import { SITE_ORIGIN } from './headTags';

/**
 * schema.org description of a provider, for the <head> of its page.
 *
 * api/agent.ts builds the same object on the server for the HTML a crawler or
 * agent fetches before any script runs (providerJsonLd there). This copy
 * covers the other half: a visitor who reached the profile by clicking through
 * the app, whose document was never re-requested. Keep the two in step —
 * scripts/agent-selftest.ts compares them.
 */

const MEDICAL_SPECIALTY: Partial<Record<Specialty, string>> = {
    obgyn: 'Gynecologic', optometry: 'Optometric', pediatrics: 'Pediatric', cardiology: 'Cardiovascular',
    urgent_care: 'Emergency', mental_health: 'Psychiatric', neurology: 'Neurologic', otolaryngology: 'Otolaryngologic',
    orthopedics: 'Musculoskeletal', gastroenterology: 'Gastroenterologic', plastic_surgery: 'PlasticSurgery',
    general: 'PrimaryCare',
};

function schemaType(p: Provider): string {
    if (p.specialty.includes('pharmacy') && p.specialty.length === 1) return 'Pharmacy';
    if (p.specialty[0] === 'dentist' || p.specialty[0] === 'orthodontist') return 'Dentist';
    if (p.specialty[0] === 'optometry') return 'Optician';
    return /^\s*(dr|dra|doctor|doctora)\b\.?/i.test(p.name) ? 'Physician' : 'MedicalClinic';
}

const httpUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : null);

export function providerJsonLd(p: Provider): Record<string, unknown> {
    const url = `${SITE_ORIGIN}/providers/${p.id}`;
    const rating = ratingOf(p);
    const specialties = p.specialty.map((s) => MEDICAL_SPECIALTY[s]).filter((s): s is string => Boolean(s));
    const offers = (p.services ?? []).filter((s) => typeof s.priceMxn === 'number').slice(0, 25).map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.nameEn ?? s.name },
        priceSpecification: { '@type': 'PriceSpecification', price: s.priceMxn, priceCurrency: 'MXN', ...(s.isFrom ? { minPrice: s.priceMxn } : {}) },
    }));
    const sameAs = [httpUrl(p.website), ...Object.values(p.socials ?? {}).map(httpUrl)].filter((u): u is string => Boolean(u));
    const image = httpUrl(p.imageUrl) ?? (p.imageUrl?.startsWith('//') ? `https:${p.imageUrl}` : null);
    const description = (p as Provider & { description?: string }).description;

    return {
        '@context': 'https://schema.org',
        '@type': schemaType(p),
        '@id': `${url}#provider`,
        name: p.name,
        url,
        ...(image ? { image } : {}),
        ...(description ? { description } : {}),
        ...(p.phone ? { telephone: p.phone } : {}),
        address: {
            '@type': 'PostalAddress',
            streetAddress: p.address,
            addressLocality: p.city,
            ...(p.postalCode ? { postalCode: p.postalCode } : {}),
            addressCountry: p.country,
        },
        geo: { '@type': 'GeoCoordinates', latitude: p.lat, longitude: p.lng },
        ...(specialties.length ? { medicalSpecialty: specialties } : {}),
        ...(rating !== null ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: rating, reviewCount: p.reviewCount, bestRating: 5, worstRating: 1 } } : {}),
        ...(p.languagesConfirmed && p.languages.length ? { availableLanguage: p.languages } : {}),
        ...(sameAs.length ? { sameAs } : {}),
        ...(offers.length ? { makesOffer: offers } : {}),
    };
}
