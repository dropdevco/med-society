import type { Provider } from '../types/provider';
import { isRegionId, regionOf } from './region';
import { normalizeLanguages } from './languages';

/**
 * PostgreSQL stores unquoted column names as all-lowercase.
 * Supabase therefore returns e.g. `googleplaceid` instead of `googlePlaceId`.
 * This function normalises any row coming from the DB back to the camelCase
 * fields our Provider interface expects.
 *
 * Rows come in two widths: the full `providers` row (`select *`, a provider's
 * own page) and the lean `provider_list` view the directory loads, which has
 * no contact details, socials, gallery or `services` menu — only
 * `service_names`. Every field the narrow row lacks gets a safe default here,
 * so nothing downstream has to know which one it was handed.
 */
export function normalizeProvider(row: any): Provider {
    return {
        ...row,
        // camelCase fields the seed script wrote as camelCase keys
        // (Postgres lowercases them on the way in, so we need to restore them)
        googlePlaceId: row.googlePlaceId ?? row.googleplaceid ?? undefined,
        doctoraliaId:  row.doctoraliaId  ?? row.doctoraliaid  ?? undefined,
        reviewCount:   row.reviewCount   ?? row.reviewcount   ?? 0,
        imageUrl:      row.imageUrl      ?? row.imageurl      ?? undefined,
        postalCode:    row.postalCode    ?? row.postalcode    ?? undefined,
        socials:       row.socials       ?? {},
        galleryUrls:   row.galleryUrls   ?? row.galleryurls   ?? [],
        services:      row.services      ?? [],
        serviceNames:  row.serviceNames  ?? row.service_names ?? undefined,
        region:        isRegionId(row.region) ? row.region : (regionOf(row.lng) ?? undefined),
        clicks:        row.clicks        ?? 0,
        priceFromMxn:  row.priceFromMxn  ?? row.pricefrommxn  ?? undefined,
        featuredRank:  row.featuredRank  ?? row.featuredrank  ?? undefined,
        tier:          row.tier ?? 'basic',
        licensed:      row.licensed ?? false,
        languagesConfirmed: row.languagesConfirmed ?? row.languages_confirmed ?? row.languagesconfirmed ?? false,
        // Trimmed here, once, so the insurance facet groups "GNP " with "GNP"
        // instead of offering both as separate options.
        insurances: (row.insurances ?? [])
            .map((s: unknown) => String(s).trim())
            .filter(Boolean),
        // ISO 639-1 codes, deduped: Tijuana rows store Spanish names
        // ('Español', 'Inglés'), the rest store codes. See utils/languages.ts.
        languages: normalizeLanguages(row.languages),
    };
}
