import type { Country } from '../types/provider';

/**
 * The directory covers two US–Mexico border regions. Everything region-aware —
 * the WHERE picker, the provider fetch, map framing, city badges and smart
 * search — keys off these ids. The database derives the same id from each
 * provider's coordinates (`providers.region`, migration 0021), so the split
 * below must stay in step with it: west of -110° is San Diego–Tijuana.
 */
export type RegionId = 'elpaso-juarez' | 'sandiego-tijuana';

export interface RegionSide {
    country: Country;
    /** City name as shown in the UI; the same in both locales. */
    city: string;
    /** State/country hint for the picker, per locale. */
    hint: { en: string; es: string };
}

export interface Region {
    id: RegionId;
    /** "El Paso – Ciudad Juárez"; the same in both locales. */
    name: string;
    us: RegionSide;
    mx: RegionSide;
    /** Initial map framing and pan limits. */
    center: { lat: number; lng: number };
    bounds: { south: number; west: number; north: number; east: number };
    zoom: number;
    /** A typical postal code for the WHERE picker's placeholder (MX side). */
    postalHint: string;
    /**
     * Leading digits of the postal codes that actually exist in this region,
     * per side. A handful of rows carry another state's code (a Tijuana 22000
     * on a Juárez clinic, copied from the source profile), and averaging those
     * into a "centre" made `near=22000` while browsing El Paso return hundreds
     * of Juárez clinics. Coordinates cannot catch that — the rows sit in the
     * right city; only the code is wrong — so the code has to prove itself.
     */
    postalPrefixes: Record<Country, string[]>;
}

export const REGIONS: Record<RegionId, Region> = {
    'elpaso-juarez': {
        id: 'elpaso-juarez',
        name: 'El Paso – Ciudad Juárez',
        us: { country: 'US', city: 'El Paso', hint: { en: 'Texas, United States', es: 'Texas, Estados Unidos' } },
        mx: { country: 'MX', city: 'Ciudad Juárez', hint: { en: 'Chihuahua, Mexico', es: 'Chihuahua, México' } },
        center: { lat: 31.738, lng: -106.455 },
        bounds: { south: 31.3, west: -106.9, north: 32.2, east: -106.0 },
        zoom: 12,
        postalHint: '32000',
        // Chihuahua is 31000–33999; El Paso ZIPs are 798–799, southern New
        // Mexico (Las Cruces, Sunland Park) 880.
        postalPrefixes: { MX: ['31', '32', '33'], US: ['798', '799', '880'] },
    },
    'sandiego-tijuana': {
        id: 'sandiego-tijuana',
        name: 'San Diego – Tijuana',
        us: { country: 'US', city: 'San Diego', hint: { en: 'California, United States', es: 'California, Estados Unidos' } },
        mx: { country: 'MX', city: 'Tijuana', hint: { en: 'Baja California, Mexico', es: 'Baja California, México' } },
        center: { lat: 32.58, lng: -117.04 },
        bounds: { south: 32.36, west: -117.30, north: 33.05, east: -116.70 },
        zoom: 11,
        postalHint: '22000',
        // Baja California is 21000–22999; San Diego County ZIPs are 919–921.
        postalPrefixes: { MX: ['21', '22'], US: ['919', '920', '921'] },
    },
};

export const REGION_IDS = Object.keys(REGIONS) as RegionId[];
export const DEFAULT_REGION: RegionId = 'elpaso-juarez';

// hasOwnProperty, not `in`: `'constructor' in REGIONS` is true via the prototype.
export const isRegionId = (v: unknown): v is RegionId =>
    typeof v === 'string' && Object.prototype.hasOwnProperty.call(REGIONS, v);

/** Same rule as the database's generated `providers.region` column. */
export function regionOf(lng: number | null | undefined): RegionId | null {
    if (lng == null || !Number.isFinite(lng)) return null;
    return lng < -110 ? 'sandiego-tijuana' : 'elpaso-juarez';
}

/** The side of `region` that `country` names. */
export function sideOf(region: RegionId, country: Country): RegionSide {
    return country === 'US' ? REGIONS[region].us : REGIONS[region].mx;
}

/**
 * Is this point inside the region's frame, give or take `marginDeg`? Used to
 * prefer the in-region reading of an ambiguous postal code (Tijuana's 22xxx
 * are also Virginia ZIPs) over asking the user.
 */
export function inRegion(lat: number, lng: number, region: RegionId, marginDeg = 0.5): boolean {
    const b = REGIONS[region].bounds;
    return lat >= b.south - marginDeg && lat <= b.north + marginDeg
        && lng >= b.west - marginDeg && lng <= b.east + marginDeg;
}

/**
 * Could this postal code belong to `region` at all? Either side's ranges
 * qualify: a row's country is as likely to be mislabelled as its code.
 */
export function postalFitsRegion(code: string, region: RegionId): boolean {
    const { MX, US } = REGIONS[region].postalPrefixes;
    return [...MX, ...US].some((prefix) => code.startsWith(prefix));
}

const LAST_REGION_KEY = 'ms-region';

/**
 * The region this visitor last browsed, so a bare `/` opens where they left
 * off. Read defensively: blocked site data throws on the accessor itself.
 */
export function readLastRegion(): RegionId {
    try {
        const v = localStorage.getItem(LAST_REGION_KEY);
        return isRegionId(v) ? v : DEFAULT_REGION;
    } catch {
        return DEFAULT_REGION;
    }
}

export function writeLastRegion(region: RegionId): void {
    try {
        localStorage.setItem(LAST_REGION_KEY, region);
    } catch {
        // Only the memory of the choice is lost; the URL still carries it.
    }
}
