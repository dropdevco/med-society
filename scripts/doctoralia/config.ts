import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const BASE = 'https://www.doctoralia.com.mx';

/** Sitemap that lists every {specialty}/{city} landing page Doctoralia publishes. */
export const SPEC_CITY_SITEMAP = `${BASE}/sitemaps/monolith/sitemap.specialization_city.xml`;
export const FACILITY_SPEC_CITY_SITEMAP = `${BASE}/sitemaps/monolith/sitemap.facility_specialization_city.xml`;

/**
 * Cities this scraper knows. The slug is matched anchored (`/<slug>` at the end
 * of a landing-page URL): for Juárez that keeps out `benito-juarez`,
 * `oaxaca-de-juarez`, `naucalpan-de-juarez2` and plain `juarez` (Juárez, N.L.),
 * which are different municipalities.
 *
 * `extraSlugs` are boroughs Doctoralia lists under their own slug; their landing
 * pages are walked too and entities merge by id (Playas de Tijuana, 6 pages).
 *
 * Pick one with `--city=tijuana` or DOCTORALIA_CITY=tijuana. Juárez is the
 * default and keeps its original out/ directory so nothing already scraped moves.
 */
const CITIES = {
  'ciudad-juarez': { label: 'Ciudad Juárez', outSubdir: '', extraSlugs: [] },
  tijuana: { label: 'Tijuana', outSubdir: 'tijuana', extraSlugs: ['playas-de-tijuana'] },
} as const;
export type CitySlug = keyof typeof CITIES;

const cityArg =
  process.argv.find((a) => a.startsWith('--city='))?.split('=')[1] ?? process.env.DOCTORALIA_CITY ?? 'ciudad-juarez';
if (!(cityArg in CITIES)) {
  throw new Error(`Unknown city "${cityArg}". Known: ${Object.keys(CITIES).join(', ')}`);
}

export const CITY_SLUG = cityArg as CitySlug;
export const CITY_LABEL = CITIES[CITY_SLUG].label;
/** Every location slug whose landing pages belong to this city's scrape. */
export const AREA_SLUGS: readonly string[] = [CITY_SLUG, ...CITIES[CITY_SLUG].extraSlugs];

/**
 * Politeness budget. robots.txt sets no Crawl-delay for the default agent, so
 * this is our own ceiling: ~1 request every 2.5-4s, single-threaded, no proxies.
 * Raising the rate is the fastest way to get this IP blocked — don't.
 */
export const MIN_DELAY_MS = 2500;
export const JITTER_MS = 1500;
export const MAX_RETRIES = 5;
export const TIMEOUT_MS = 45_000;

/**
 * Listing pages are served fine to a normal browser UA and we make no attempt
 * to defeat bot detection (there is none in front of these paths). We stay off
 * every path robots.txt disallows: /buscar?, /api/, /ajax/.
 */
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Keyed by URL hash, so one cache is safely shared across cities. */
export const CACHE_DIR = path.join(__dirname, '.cache');
export const OUT_DIR = path.join(__dirname, 'out', CITIES[CITY_SLUG].outSubdir);

export const INDEX_FILE = path.join(OUT_DIR, 'index.jsonl');
export const PROFILES_FILE = path.join(OUT_DIR, 'profiles.jsonl');
export const REPORT_FILE = path.join(OUT_DIR, 'report.json');
/** Landing-page URLs fully walked by discover, one per line, for resuming. */
export const WALKED_FILE = path.join(OUT_DIR, 'walked.txt');
