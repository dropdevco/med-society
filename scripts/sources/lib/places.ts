/**
 * Where a record from a worldwide list sits: its country written one way, and
 * our region when it is in one. Only records in a region are matched to listings;
 * the rest are stored as published (docs/sources/gha.md, jci.md).
 */
import type { RegionId } from './types';

const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The same country, as the lists spell it. Unknown names are kept as written. */
const COUNTRY_ALIASES: Record<string, string> = {
    'usa': 'United States',
    'us': 'United States',
    'u.s.a.': 'United States',
    'united states': 'United States',
    'united states of america': 'United States',
    'mexico': 'Mexico',
    'republic of korea': 'South Korea',
    'korea, republic of': 'South Korea',
    'south korea': 'South Korea',
    'kingdom of saudi arabia': 'Saudi Arabia',
    'saudi arabia': 'Saudi Arabia',
    'turkiye': 'Turkey',
    'turkey': 'Turkey',
    'uae': 'United Arab Emirates',
};

export function normalizeCountry(raw: string | null | undefined): string | null {
    const s = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    return COUNTRY_ALIASES[fold(s)] ?? s;
}

const TIJUANA_AREA = new Set(['tijuana', 'playas de rosarito', 'rosarito', 'tecate', 'ensenada']);
const JUAREZ_AREA = new Set(['ciudad juarez', 'cd. juarez', 'cd juarez', 'juarez']);
const SAN_DIEGO_AREA = new Set(['san diego', 'chula vista', 'national city', 'el cajon', 'la jolla', 'san ysidro', 'imperial beach', 'coronado', 'la mesa', 'oceanside', 'escondido', 'carlsbad']);
const EL_PASO_AREA = new Set(['el paso']);

/** Our region for a place, or null. A city alone is enough; the country only guards against namesakes. */
export function regionOf(country: string | null, city: string | null): RegionId | null {
    const c = fold(city ?? '').replace(/,.*$/, '');
    const k = normalizeCountry(country);
    if (k === 'Mexico' || k === null) {
        if (TIJUANA_AREA.has(c)) return 'sandiego-tijuana';
        if (JUAREZ_AREA.has(c)) return 'elpaso-juarez';
    }
    if (k === 'United States' || k === null) {
        if (SAN_DIEGO_AREA.has(c)) return 'sandiego-tijuana';
        if (EL_PASO_AREA.has(c)) return 'elpaso-juarez';
    }
    return null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "September 20, 2017" or "October 15th, 2019" → ISO date; anything else → null. */
export function englishDateToIso(s: string | null | undefined): string | null {
    const m = /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec((s ?? '').trim());
    if (!m) return null;
    const month = MONTHS.indexOf(m[1].toLowerCase());
    if (month < 0) return null;
    return `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** A stable key from a name: "Clínica de Especialidades - CEO" → "clinica-de-especialidades-ceo". */
export const slugify = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
