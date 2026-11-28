/**
 * Flights: where "Search flights" goes, and the one place commission is added.
 * The plan and how to get the affiliate link are in docs/travel-booking.md.
 *
 * We never show fares or book anything: the search opens the partner's results
 * (Aviasales, through Travelpayouts) in a new tab. One optional setting, in Vercel:
 *   VITE_FLIGHT_AFFILIATE_LINK   a network deep link with `{url}` where the
 *                                destination goes, e.g.
 *                                "https://tp.media/r?marker=123&p=4114&u={url}".
 * Without it the link works and earns nothing.
 */
import { addDays, todayIso } from './hotelLinks';

export interface FlightAffiliateConfig { template?: string }

function envConfig(): FlightAffiliateConfig {
    const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) ?? {};
    return { template: env.VITE_FLIGHT_AFFILIATE_LINK?.trim() || undefined };
}
const CONFIG = envConfig();

/** A template is only used when it is an https link with exactly the `{url}` slot to fill. */
function usableTemplate(t?: string): string | undefined {
    if (!t || !t.includes('{url}') || t.split('{url}').length !== 2) return undefined;
    try { return new URL(t.replace('{url}', 'x')).protocol === 'https:' ? t : undefined; } catch { return undefined; }
}

/** Where a patient can fly in, and what comes next. Keep in step with docs/travel-booking.md. */
export interface FlightDestination {
    code: string;
    region: 'sandiego-tijuana' | 'elpaso-juarez';
    side: 'us' | 'mx';
    city: { en: string; es: string };
    next: { en: string; es: string };
}

export const FLIGHT_DESTINATIONS: FlightDestination[] = [
    { code: 'SAN', region: 'sandiego-tijuana', side: 'us', city: { en: 'San Diego', es: 'San Diego' },
      next: { en: 'Cross at San Ysidro, about 20 minutes by car.', es: 'Cruza por San Ysidro, a unos 20 minutos en auto.' } },
    { code: 'TIJ', region: 'sandiego-tijuana', side: 'mx', city: { en: 'Tijuana', es: 'Tijuana' },
      next: { en: 'Land in Tijuana, no border crossing by car.', es: 'Aterriza en Tijuana, sin cruzar la frontera en auto.' } },
    { code: 'ELP', region: 'elpaso-juarez', side: 'us', city: { en: 'El Paso', es: 'El Paso' },
      next: { en: 'Cross at Paso del Norte or the Bridge of the Americas.', es: 'Cruza por Paso del Norte o el Puente de las Américas.' } },
    { code: 'CJS', region: 'elpaso-juarez', side: 'mx', city: { en: 'Ciudad Juárez', es: 'Ciudad Juárez' },
      next: { en: 'Land in Juárez. Fewer routes than El Paso.', es: 'Aterriza en Juárez. Menos rutas que El Paso.' } },
];

/** Big airports patients start from, for the "From" suggestions. Anything else can be typed as a 3-letter code. */
export const ORIGIN_AIRPORTS: [code: string, city: string][] = [
    ['ATL', 'Atlanta'], ['AUS', 'Austin'], ['BNA', 'Nashville'], ['BOS', 'Boston'], ['BWI', 'Baltimore'], ['CLT', 'Charlotte'],
    ['CVG', 'Cincinnati'], ['DAL', 'Dallas Love'], ['DEN', 'Denver'], ['DFW', 'Dallas Fort Worth'], ['DTW', 'Detroit'],
    ['EWR', 'Newark'], ['FLL', 'Fort Lauderdale'], ['HOU', 'Houston Hobby'], ['IAD', 'Washington Dulles'], ['IAH', 'Houston'],
    ['JFK', 'New York JFK'], ['LAS', 'Las Vegas'], ['LAX', 'Los Angeles'], ['LGA', 'New York LaGuardia'], ['MCO', 'Orlando'],
    ['MDW', 'Chicago Midway'], ['MIA', 'Miami'], ['MSP', 'Minneapolis'], ['MSY', 'New Orleans'], ['OAK', 'Oakland'],
    ['ONT', 'Ontario CA'], ['ORD', 'Chicago O’Hare'], ['PDX', 'Portland'], ['PHL', 'Philadelphia'], ['PHX', 'Phoenix'],
    ['RDU', 'Raleigh'], ['SEA', 'Seattle'], ['SFO', 'San Francisco'], ['SJC', 'San Jose'], ['SLC', 'Salt Lake City'],
    ['SMF', 'Sacramento'], ['SNA', 'Orange County'], ['STL', 'St. Louis'], ['TPA', 'Tampa'], ['TUS', 'Tucson'],
    ['ABQ', 'Albuquerque'], ['OKC', 'Oklahoma City'], ['SAT', 'San Antonio'], ['MEX', 'Mexico City'], ['GDL', 'Guadalajara'],
    ['MTY', 'Monterrey'],
];

/** "LAX", "lax", "Los Angeles (LAX)" or "Los Angeles" to a 3-letter code, or null when it is none of those. */
export function parseAirport(input: string): string | null {
    const text = input.trim();
    if (!text) return null;
    const inParens = /\(([A-Za-z]{3})\)\s*$/.exec(text);
    if (inParens) return inParens[1].toUpperCase();
    if (/^[A-Za-z]{3}$/.test(text)) return text.toUpperCase();
    const byCity = ORIGIN_AIRPORTS.find(([, city]) => city.toLowerCase() === text.toLowerCase());
    return byCity ? byCity[0] : null;
}

export interface FlightQuery {
    from: string;
    to: string;
    /** YYYY-MM-DD. */
    depart: string;
    /** YYYY-MM-DD; empty for one way. */
    ret?: string;
    adults?: number;
    /** Ages 2 to 11. */
    children?: number;
    /** Under 2, on an adult's lap. */
    infants?: number;
    today?: string;
}

export interface Travellers { adults: number; children: number; infants: number }
/** Seats (adults and children) one search can ask for. */
export const FLIGHT_PAX_LIMIT = 9;

/** Whole numbers within airline rules: 1+ adults, at most nine seats, never more infants than adults. */
export function validTravellers(t: { adults?: number; children?: number; infants?: number }): Travellers {
    const int = (v: number | undefined, lo: number, hi: number) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v as number)) : lo);
    const adults = int(t.adults, 1, FLIGHT_PAX_LIMIT);
    return { adults, children: int(t.children, 0, FLIGHT_PAX_LIMIT - adults), infants: int(t.infants, 0, adults) };
}

const MONTH_DAY = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}`;
const isRealDay = (d?: string) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

/**
 * What a search needs before it can go out: real airports, a departure that is
 * not in the past, and, if there is a return, one after it. Null when not usable.
 */
export function validFlightQuery(q: FlightQuery): ({ from: string; to: string; depart: string; ret: string } & Travellers) | null {
    const from = /^[A-Za-z]{3}$/.test(q.from) ? q.from.toUpperCase() : '';
    const to = /^[A-Za-z]{3}$/.test(q.to) ? q.to.toUpperCase() : '';
    if (!from || !to || from === to) return null;
    const today = q.today ?? todayIso();
    if (!isRealDay(q.depart) || q.depart < today) return null;
    let ret = '';
    if (q.ret) {
        if (!isRealDay(q.ret) || q.ret <= q.depart) return null;
        ret = q.ret;
    }
    return { from, to, depart: q.depart, ret, ...validTravellers(q) };
}

/**
 * The partner's results page for this search: Aviasales' `ORIGIN DDMM DEST [DDMM]
 * ADULTS [CHILDREN [INFANTS]]` form, one digit each (checked on aviasales.com,
 * 28 Nov 2026: ...211 shows 2 adults, 1 child, 1 infant).
 */
export function partnerSearchUrl(q: NonNullable<ReturnType<typeof validFlightQuery>>): string {
    return `https://www.aviasales.com/search/${q.from}${MONTH_DAY(q.depart)}${q.to}${q.ret ? MONTH_DAY(q.ret) : ''}${q.adults}${q.children || q.infants ? q.children : ''}${q.infants || ''}`;
}

/** The pure version of `flightHref`, with the affiliate settings passed in (for the self-test). */
export function buildFlightHref(q: FlightQuery, cfg: FlightAffiliateConfig): string | null {
    const v = validFlightQuery(q);
    if (!v) return null;
    const url = partnerSearchUrl(v);
    const template = usableTemplate(cfg.template);
    return template ? template.replace('{url}', encodeURIComponent(url)) : url;
}

export function flightHref(q: FlightQuery): string | null {
    return buildFlightHref(q, CONFIG);
}

/** Whether the link earns commission, so the UI marks it rel="sponsored". */
export function earnsFlightCommission(href: string | null, cfg: FlightAffiliateConfig = CONFIG): boolean {
    const template = usableTemplate(cfg.template);
    return Boolean(href && template && href.startsWith(template.split('{url}')[0]));
}

/** Default dates for the form: leave in two weeks, back a week later. Only used to suggest, never sent unasked. */
export function suggestedTrip(today = todayIso()): { depart: string; ret: string } {
    return { depart: addDays(today, 14), ret: addDays(today, 21) };
}
