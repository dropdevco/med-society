import { importLibrary } from '@googlemaps/js-api-loader';
import type { Country } from '../types/provider';
import { inRegion, type RegionId } from './region';
// Side-effect import: configures the loader with our key. Without it,
// importLibrary below resolves against a keyless loader and never answers.
import '../lib/googleMaps';

/**
 * Resolving a postal code to a point on the map.
 *
 * The directory used to answer this from its own rows: average the lat/lng of
 * every provider carrying a given code and call that the centre. That works
 * only for codes we already hold — 228 in Chihuahua and twenty-one in Texas —
 * so a patient in El Paso typing their own ZIP got an empty page with no
 * explanation, which is exactly the complaint that sent this here.
 *
 * Google's geocoder knows every code on both sides, and the Maps SDK is
 * already loaded for the map, so this costs no new key and no new dependency.
 * The derived centroid stays as an instant answer for codes we do hold.
 *
 * Which country matters. MX and US postal codes are both five digits and the
 * ranges do not overlap around the border, but they do overlap nationally —
 * 32300 is a Juárez colonia and also a Florida ZIP. So the caller says which
 * side it is looking from when it knows, and when it does not, both are tried
 * and an ambiguous code comes back as two candidates for the user to pick
 * between rather than as a guess.
 *
 * The border region narrows that further. Tijuana's 22xxx codes are also
 * Virginia ZIPs, and someone browsing San Diego–Tijuana who types 22000 means
 * Tijuana; asking them about Virginia is noise. Only one region's providers
 * are loaded at a time, so a reading outside it could never return anyone:
 * with a region given, only in-region readings are returned, and a code that
 * has none reads as "no providers in this code" rather than as a radius
 * around Springfield, VA.
 */

export interface PostalHit {
    code: string;
    country: Country;
    lat: number;
    lng: number;
    /** Human-readable place, e.g. "El Paso, TX" — shown when disambiguating. */
    label: string;
}

const CACHE_PREFIX = 'ms-postal:';

/** In-memory first: a repeated radius change must not re-hit the geocoder. */
const memo = new Map<string, PostalHit | null>();

function cacheKey(code: string, country: Country) {
    return `${CACHE_PREFIX}${country}:${code}`;
}

function readCache(code: string, country: Country): PostalHit | null | undefined {
    const key = cacheKey(code, country);
    if (memo.has(key)) return memo.get(key);
    try {
        const raw = localStorage.getItem(key);
        if (raw === null) return undefined;
        const value = raw === 'null' ? null : (JSON.parse(raw) as PostalHit);
        memo.set(key, value);
        return value;
    } catch {
        // Private mode, blocked site data, or a hand-edited entry. Treat a
        // broken cache as a cold one — never as a missing postal code.
        return undefined;
    }
}

function writeCache(code: string, country: Country, hit: PostalHit | null) {
    const key = cacheKey(code, country);
    memo.set(key, hit);
    try {
        localStorage.setItem(key, hit === null ? 'null' : JSON.stringify(hit));
    } catch {
        // Cache is an optimisation. Losing it costs a geocode, not a result.
    }
}

/** The town/city line, for telling two countries' versions of a code apart. */
function labelOf(result: google.maps.GeocoderResult): string {
    const pick = (type: string) =>
        result.address_components.find((c) => c.types.includes(type))?.short_name;
    const locality = pick('locality') ?? pick('sublocality') ?? pick('postal_town');
    const region = pick('administrative_area_level_1');
    return [locality, region].filter(Boolean).join(', ') || result.formatted_address;
}

/**
 * Does this result actually stand for the code we asked for?
 *
 * `componentRestrictions` is a hint, not a constraint. Asked for postal code
 * 00000 in Mexico, Google does not answer ZERO_RESULTS — it relaxes the
 * restriction and hands back a broad locality match, which sailed straight
 * through as a valid centre and filtered the whole directory to a five
 * kilometre circle around nothing in particular.
 *
 * So the result has to prove itself: it must carry a postal_code component
 * matching the digits we asked for, and a country component matching the side
 * we asked about. Anything less is a near miss dressed up as a hit.
 */
function isGenuine(result: google.maps.GeocoderResult, code: string, country: Country): boolean {
    if (result.partial_match) return false;

    const components = result.address_components;
    const postal = components.find((c) => c.types.includes('postal_code'));
    if (!postal) return false;
    // Google may answer a five-digit query with a ZIP+4; compare the prefix.
    if (postal.long_name.slice(0, code.length) !== code) return false;

    const iso = components.find((c) => c.types.includes('country'))?.short_name;
    return iso === country;
}

let geocoder: google.maps.Geocoder | null = null;

async function getGeocoder(): Promise<google.maps.Geocoder | null> {
    if (geocoder) return geocoder;
    try {
        const lib = await importLibrary('geocoding');
        geocoder = new lib.Geocoder();
        return geocoder;
    } catch {
        // No Maps key, or the SDK failed to load. Callers fall back to the
        // derived centroids, which is the pre-existing behaviour.
        return null;
    }
}

async function geocodeOne(code: string, country: Country): Promise<PostalHit | null> {
    const cached = readCache(code, country);
    if (cached !== undefined) return cached;

    const g = await getGeocoder();
    if (!g) return null;

    let hit: PostalHit | null = null;
    try {
        const { results } = await g.geocode({
            componentRestrictions: { country, postalCode: code },
        });
        const top = results.find((r) => isGenuine(r, code, country));
        if (top) {
            const loc = top.geometry.location;
            hit = { code, country, lat: loc.lat(), lng: loc.lng(), label: labelOf(top) };
        }
    } catch {
        // ZERO_RESULTS rejects rather than resolving empty. That is a real
        // "no such code in this country", so it caches as a null.
        hit = null;
    }

    writeCache(code, country, hit);
    return hit;
}

/**
 * Every place this code could mean, nearest side first.
 *
 * `preferred` is the side the user is searching from. When it resolves, it is
 * the only answer — someone who has already said "El Paso" does not want to be
 * asked whether they meant Chihuahua. With no preference, both sides are tried
 * and both are returned, and it is the caller's job to ask. With a `region`,
 * readings outside it are dropped first, so the question is only asked when
 * the code is genuinely ambiguous within the region.
 */
export async function resolvePostal(
    code: string,
    preferred: Country | '',
    region?: RegionId,
): Promise<PostalHit[]> {
    const trimmed = code.trim();
    if (!trimmed) return [];

    const local = (h: PostalHit) => !region || inRegion(h.lat, h.lng, region);

    if (preferred) {
        const hit = await geocodeOne(trimmed, preferred);
        if (hit && local(hit)) return [hit];
        // Fall through rather than give up: a mistyped side should still find
        // the code, not report that it does not exist.
    }

    const both = (await Promise.all([
        geocodeOne(trimmed, 'MX'),
        geocodeOne(trimmed, 'US'),
    ])).filter((h): h is PostalHit => h !== null);

    return both.filter(local);
}
