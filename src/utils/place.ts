import type { TFunction } from 'i18next';
import type { Country, Provider } from '../types/provider';
import { regionOf, sideOf, DEFAULT_REGION, REGIONS, type RegionId } from './region';

/**
 * The city badge on a card, tile, drawer and map pin.
 *
 * The directory began as two sides of one border, so "Mexico" used to mean
 * Ciudad Juárez. It now spans two border regions, so the badge is the city on
 * the provider's side of *its* region: San Diego / Tijuana, or El Paso /
 * Ciudad Juárez. The region comes from the row (`providers.region`, generated
 * from `lng`) and falls back to the same rule applied to the coordinates.
 *
 * A city name is the same in both locales, so no translation is needed.
 */
export function placeLabel(p: Pick<Provider, 'country' | 'city' | 'lng' | 'region'>): string {
    const region = p.region ?? regionOf(p.lng) ?? (/tijuana/i.test(p.city ?? '') ? 'sandiego-tijuana' : DEFAULT_REGION);
    return sideOf(region, p.country === 'US' ? 'US' : 'MX').city;
}

/**
 * What the WHERE segment, the collapsed search pill and the summary say about
 * location: a postal code if one is set, else the chosen side's city, else
 * the whole region ("San Diego – Tijuana"). City and region names are the
 * same in both locales.
 */
export function whereLabel(
    f: { region: RegionId; country: Country | ''; postalCode: string },
    t: TFunction,
): string {
    if (f.postalCode) return t('filters.nearPostal', { code: f.postalCode });
    if (f.country) return sideOf(f.region, f.country).city;
    return REGIONS[f.region].name;
}
