/**
 * Sweep targets for sweep.ts and promote-google.ts.
 *
 * A target is one place the Google Places sweep can cover: its bounding box,
 * how its queries are built, which staging table the results land in, and how
 * a staged place becomes a `providers` row.
 *
 *   --target=juarez     (default) Ciudad Juárez. Queries come from the Spanish
 *                       Doctoralia specialization labels in the database,
 *                       results go to google_places_juarez. Unchanged from the
 *                       original Juárez-only scripts.
 *   --target=san-diego  US side of San Diego–Tijuana. A fixed English query list
 *                       (the Juárez categories, translated), results go to
 *                       google_places_san_diego (migration 0023).
 *
 * The flag is `--target=`, not `--city=`: config.ts owns `--city=` for the
 * Doctoralia scraper and throws on any city it does not know.
 *
 * This module has no side effects and never touches the network.
 */
import type { Specialty } from '../../src/types/provider';

export type TargetId = 'juarez' | 'san-diego';

export interface BBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

/** One Text Search: the query text plus the location bias it is sent with. */
export interface SweepQuery {
  text: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** Known for the static (English) lists; unknown for the Doctoralia labels. */
  specialty?: Specialty[];
  generic?: boolean;
}

export interface SweepTarget {
  id: TargetId;
  /** Banner label: "Google Places sweep — <label>". */
  label: string;
  /** Short name in "N unique places in the <boxLabel> bounding box". */
  boxLabel: string;
  table: string;
  bbox: BBox;
  /** 'doctoralia' = derive from doctoralia_doctors (needs Supabase); 'static' = buildStaticQueries(). */
  querySource: 'doctoralia' | 'static';
  /** Appended to the first-page Text Search URL, before &key=. Empty for Juárez so its cache keys are unchanged. */
  textSearchExtra: string;
  /** Place Details `fields`. */
  detailsFields: string;
  /** Drop anything not confirmed to be in the United States (address + country component + border line). */
  requireUs: boolean;
  /** The `link` / `report` phases match against Doctoralia — Juárez only. */
  doctoraliaLink: boolean;
  estimate: {
    searchesPerQuery: number;
    /** Fixed details guess (Juárez's original figure)… */
    fixedDetails?: number;
    /** …or unique places expected per query. */
    newPlacesPerQuery?: number;
    /** Extra comparison line printed under the estimate. */
    comparison?: string;
  };
  provider: {
    country: 'US' | 'MX';
    /** City used when none can be derived from the address. */
    defaultCity: string;
    /** Use the Google locality (San Diego, Chula Vista, National City…) as `city`. */
    cityFromLocality: boolean;
  };
}

// ── Juárez (unchanged behaviour) ─────────────────────────────────────────────

const JUAREZ: SweepTarget = {
  id: 'juarez',
  label: 'Ciudad Juárez',
  boxLabel: 'Juárez',
  table: 'google_places_juarez',
  bbox: { minLat: 31.58, maxLat: 31.83, minLng: -106.61, maxLng: -106.28 },
  querySource: 'doctoralia',
  textSearchExtra: '',
  detailsFields:
    'place_id,name,formatted_address,geometry,international_phone_number,website,rating,user_ratings_total,types,business_status',
  requireUs: false,
  doctoraliaLink: true,
  estimate: {
    searchesPerQuery: 2,
    fixedDetails: 1_800,
    comparison: '(vs ~US$135 for asking about all 2,794 entities one at a time)',
  },
  provider: { country: 'MX', defaultCity: 'Juárez', cityFromLocality: false },
};

export const JUAREZ_CENTER = { lat: 31.7, lng: -106.45 };
export const JUAREZ_RADIUS_M = 20_000;

// ── San Diego (US side of San Diego–Tijuana) ─────────────────────────────────

/**
 * Box: south 32.534 is the US–Mexico border where it meets the Pacific
 * (Border Field State Park); north 32.90 takes in Kearny Mesa's hospital
 * district, Hillcrest, UTC/La Jolla (UCSD, Scripps) but stops short of the
 * inland northern suburbs; west -117.30 is open ocean past La Jolla and Point
 * Loma; east -116.90 covers Otay Mesa, Otay Ranch/Eastlake and Spring Valley.
 *
 * The box alone does NOT exclude Mexico: the border is a straight survey line
 * that rises north-east, so at Otay Mesa (-116.95) Tijuana reaches ~32.547 —
 * north of the box's southern edge. Hence `usSideOfBorder` plus the country
 * checks below; the box is only the first, coarse cut.
 */
const SAN_DIEGO: SweepTarget = {
  id: 'san-diego',
  label: 'San Diego (US side)',
  boxLabel: 'San Diego',
  table: 'google_places_san_diego',
  bbox: { minLat: 32.534, maxLat: 32.9, minLng: -117.3, maxLng: -116.9 },
  querySource: 'static',
  textSearchExtra: '&language=en&region=us',
  detailsFields:
    'place_id,name,formatted_address,geometry,international_phone_number,website,rating,user_ratings_total,types,business_status,address_components',
  requireUs: true,
  doctoraliaLink: false,
  estimate: {
    searchesPerQuery: 2,
    // Juárez found 1,001 unique places from 157 queries (~6.4/query). San
    // Diego is denser and its queries are less overlapping (no gendered
    // duplicates), so assume roughly double. Treat as an upper-ish guess.
    newPlacesPerQuery: 12,
  },
  provider: { country: 'US', defaultCity: 'San Diego', cityFromLocality: true },
};

export const TARGETS: Record<TargetId, SweepTarget> = { juarez: JUAREZ, 'san-diego': SAN_DIEGO };

export function resolveTarget(argv: string[]): SweepTarget {
  const id = argv.find((a) => a.startsWith('--target='))?.split('=')[1] ?? 'juarez';
  if (!(id in TARGETS)) {
    throw new Error(`Unknown --target="${id}". Known: ${Object.keys(TARGETS).join(', ')}`);
  }
  return TARGETS[id as TargetId];
}

export const inBox = (b: BBox, lat: number, lng: number) =>
  lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;

/**
 * Areas searched for San Diego. Text Search is capped at 60 results per query,
 * so the dense categories are repeated per municipality with a tight location
 * bias; the rest run once against the whole metro.
 *
 * San Ysidro is a San Diego neighbourhood, not a city — Google returns locality
 * "San Diego" for it — but it is the port of entry, so it gets its own sweep.
 * It is also where Google is most eager to return Tijuana businesses, which
 * the US filters drop.
 */
const SD_AREAS = [
  { suffix: 'San Diego, CA', lat: 32.74, lng: -117.1, radiusM: 20_000, main: true },
  { suffix: 'Chula Vista, CA', lat: 32.6401, lng: -117.0842, radiusM: 8_000, main: false },
  { suffix: 'National City, CA', lat: 32.6781, lng: -117.0992, radiusM: 4_000, main: false },
  { suffix: 'Imperial Beach, CA', lat: 32.5839, lng: -117.1131, radiusM: 4_000, main: false },
  { suffix: 'San Ysidro, San Diego, CA', lat: 32.555, lng: -117.045, radiusM: 4_000, main: false },
] as const;

interface Category {
  q: string;
  specialty: Specialty[];
  /** Dense enough that one metro-wide query would hit the 60-result cap. */
  everyArea?: boolean;
  generic?: boolean;
}

/**
 * The Juárez sweep's categories (its 188 Doctoralia labels collapse to these
 * once gender variants and specialty/specialist pairs are merged), in English.
 * Specialty mapping follows promote-google.ts / specialties.ts.
 */
const SD_CATEGORIES: Category[] = [
  // dense, every area
  { q: 'dentist', specialty: ['dentist'], everyArea: true },
  { q: 'family medicine doctor', specialty: ['general'], everyArea: true },
  { q: 'primary care physician', specialty: ['general'], everyArea: true },
  { q: 'pediatrician', specialty: ['pediatrics'], everyArea: true },
  { q: 'gynecologist OB-GYN', specialty: ['obgyn'], everyArea: true },
  { q: 'psychologist', specialty: ['mental_health'], everyArea: true },
  { q: 'urgent care', specialty: ['urgent_care'], everyArea: true },
  { q: 'pharmacy', specialty: ['pharmacy'], everyArea: true },
  { q: 'optometrist', specialty: ['optometry'], everyArea: true },
  { q: 'orthodontist', specialty: ['orthodontist'], everyArea: true },
  { q: 'physical therapist', specialty: ['physical_therapy'], everyArea: true },
  { q: 'chiropractor', specialty: ['physical_therapy'], everyArea: true },
  { q: 'medical clinic', specialty: ['general'], everyArea: true, generic: true },
  { q: 'community health center', specialty: ['general'], everyArea: true, generic: true },
  { q: 'medical laboratory', specialty: ['general'], everyArea: true, generic: true },
  { q: 'plastic surgeon', specialty: ['plastic_surgery'], everyArea: true },

  // metro-wide only
  { q: 'internal medicine doctor', specialty: ['general'] },
  { q: 'general surgeon', specialty: ['general'] },
  { q: 'orthopedic surgeon', specialty: ['orthopedics'] },
  { q: 'sports medicine doctor', specialty: ['orthopedics'] },
  { q: 'nutritionist dietitian', specialty: ['general'] },
  { q: 'ophthalmologist', specialty: ['optometry'] },
  { q: 'retina specialist', specialty: ['optometry'] },
  { q: 'cardiologist', specialty: ['cardiology'] },
  { q: 'cardiothoracic surgeon', specialty: ['cardiology'] },
  { q: 'ENT doctor otolaryngologist', specialty: ['otolaryngology'] },
  { q: 'audiologist hearing center', specialty: ['otolaryngology'] },
  { q: 'urologist', specialty: ['general'] },
  { q: 'pain management doctor', specialty: ['general'] },
  { q: 'psychiatrist', specialty: ['mental_health'] },
  { q: 'mental health counseling', specialty: ['mental_health'] },
  { q: 'sex therapist', specialty: ['mental_health'] },
  { q: 'cosmetic surgery clinic', specialty: ['plastic_surgery'] },
  { q: 'medical spa aesthetic medicine', specialty: ['aesthetician'] },
  { q: 'dermatologist', specialty: ['aesthetician'] },
  { q: 'pediatric surgeon', specialty: ['pediatrics'] },
  { q: 'pediatric dentist', specialty: ['dentist', 'pediatrics'] },
  { q: 'neonatologist', specialty: ['pediatrics'] },
  { q: 'gastroenterologist', specialty: ['general'] },
  { q: 'endoscopy center', specialty: ['general'] },
  { q: 'colorectal surgeon proctologist', specialty: ['general'] },
  { q: 'nephrologist', specialty: ['general'] },
  { q: 'neurologist', specialty: ['neurology'] },
  { q: 'neurosurgeon', specialty: ['neurology'] },
  { q: 'allergist immunologist', specialty: ['general'] },
  { q: 'weight loss bariatric surgeon', specialty: ['general'] },
  { q: 'oral and maxillofacial surgeon', specialty: ['dentist'] },
  { q: 'endodontist', specialty: ['dentist'] },
  { q: 'periodontist', specialty: ['dentist'] },
  { q: 'dental implants', specialty: ['dentist'] },
  { q: 'pulmonologist', specialty: ['general'] },
  { q: 'vascular surgeon', specialty: ['general'] },
  { q: 'oncologist', specialty: ['general'] },
  { q: 'radiation oncology', specialty: ['general'] },
  { q: 'hematologist', specialty: ['general'] },
  { q: 'endocrinologist diabetes', specialty: ['general'] },
  { q: 'rheumatologist', specialty: ['general'] },
  { q: 'infectious disease doctor', specialty: ['general'] },
  { q: 'geriatrician', specialty: ['general'] },
  { q: 'occupational medicine clinic', specialty: ['general'] },
  { q: 'radiology imaging center', specialty: ['general'] },
  { q: 'acupuncture', specialty: ['general'] },
  { q: 'naturopathic doctor', specialty: ['general'] },
  { q: 'speech therapist', specialty: ['general'] },
  { q: 'massage therapist', specialty: ['massage'] },
  { q: 'emergency room', specialty: ['urgent_care'] },
  { q: 'hospital', specialty: ['general'], generic: true },
  { q: 'medical center', specialty: ['general'], generic: true },
];

export function buildStaticQueries(target: SweepTarget): SweepQuery[] {
  if (target.id !== 'san-diego') throw new Error(`${target.id} has no static query list`);
  const out: SweepQuery[] = [];
  for (const c of SD_CATEGORIES) {
    for (const a of SD_AREAS) {
      if (!a.main && !c.everyArea) continue;
      out.push({
        text: `${c.q} in ${a.suffix}`,
        lat: a.lat,
        lng: a.lng,
        radiusM: a.radiusM,
        specialty: c.specialty,
        generic: c.generic,
      });
    }
  }
  return out;
}

// ── US-side filters ──────────────────────────────────────────────────────────

/**
 * The border from the Pacific to the Colorado River is a straight survey line:
 * 32.5343N at the coast (-117.1229) to 32.7183N at -114.7196. Anything south of
 * it is Mexico, whatever the box says. 30 m of slack absorbs geocode jitter;
 * the country checks are what actually decide close calls.
 */
export function usSideOfBorder(lat: number, lng: number): boolean {
  const slope = (32.7183 - 32.5343) / (-114.7196 - -117.1229);
  const borderLat = 32.5343 + slope * Math.max(0, lng - -117.1229);
  return lat >= borderLat - 0.0003;
}

/** Search-stage check on Google's formatted address ("…, Chula Vista, CA 91910, USA"). */
export function looksLikeUsAddress(addr: string | null | undefined): boolean {
  if (!addr) return false;
  if (/m[eé]xico|\bB\.?\s?C\.?\b|baja california|tijuana/i.test(addr)) return false;
  // With `region=us`, Google omits the country for US results
  // ("4616 El Cajon Blvd #8, San Diego, CA 92115"), so a trailing "USA" can't be
  // required: a California state + 5-digit ZIP is the US marker instead. Place
  // Details then confirms country_code = 'US' before anything is stored.
  return /,\s*CA\s+9\d{4}\b|,\s*California\s+9\d{4}\b|,\s*CA\b[^,]*,\s*(USA|United States)\s*$/i.test(addr);
}

export interface UsAddressParts {
  countryCode: string | null;
  locality: string | null;
  postalCode: string | null;
}

/** From Place Details `address_components`, falling back to the formatted address. */
export function usAddressParts(components: any[] | null | undefined, formatted: string | null): UsAddressParts {
  let countryCode: string | null = null;
  let locality: string | null = null;
  let postalCode: string | null = null;
  for (const c of components ?? []) {
    const types: string[] = c?.types ?? [];
    if (types.includes('country')) countryCode = c.short_name ?? null;
    if (types.includes('locality')) locality = c.long_name ?? null;
    if (types.includes('postal_code')) postalCode = c.long_name ?? null;
  }
  if (formatted) {
    const m = formatted.match(/,\s*([^,]+),\s*CA(?:\s+(\d{5})(?:-\d{4})?)?,\s*(?:USA|United States)\s*$/i);
    if (m) {
      locality ??= m[1].trim();
      postalCode ??= m[2] ?? null;
      countryCode ??= 'US';
    }
  }
  return { countryCode, locality, postalCode };
}

/**
 * English counterpart of promote-google.ts `classify` (which stays Spanish and
 * untouched for Juárez). Returns [] when nothing matches, so the caller can
 * fall back to the query's own specialty before 'general'.
 */
export function classifyEnglish(types: string[], name: string): Specialty[] {
  const t = new Set(types);
  const n = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const out = new Set<Specialty>();

  if (t.has('dentist') || /dental|dentist|dds\b|endodont|periodont|oral surg|smile/.test(n)) out.add('dentist');
  if (/orthodont|braces|invisalign/.test(n)) out.add('orthodontist');
  if (/plastic surg|cosmetic surg|aesthetic surg|body contour|liposuc/.test(n)) out.add('plastic_surgery');
  if (/med ?spa|\bspa\b|aesthetic|skin|dermatolog|botox|laser/.test(n)) out.add('aesthetician');
  if (/gyn|obstetr|\bob\b|women'?s health|maternity|fertility|midwi/.test(n)) out.add('obgyn');
  if (t.has('physiotherapist') || /physical therap|physiother|rehab|chiropract|\bpt\b/.test(n)) out.add('physical_therapy');
  if (/massage/.test(n)) out.add('massage');
  if (/optomet|ophthalm|optical|optician|\beye|vision|retina|lasik/.test(n)) out.add('optometry');
  if (/pediatric|children|kids|\bchild\b|neonat/.test(n)) out.add('pediatrics');
  if (/cardio|heart/.test(n)) out.add('cardiology');
  if (/urgent care|emergency|\ber\b/.test(n)) out.add('urgent_care');
  if (/psycholog|psychiatr|mental health|counsel|behavioral health|therapy center|marriage and family/.test(n)) out.add('mental_health');
  if (t.has('pharmacy') || t.has('drugstore') || /pharmacy|drug store|cvs|walgreens|rite aid/.test(n)) out.add('pharmacy');
  if (/neurolog|neurosurg|\bneuro\b|brain/.test(n)) out.add('neurology');
  if (/\bent\b|ear,? nose|otolaryng|audiolog|hearing/.test(n)) out.add('otolaryngology');
  if (/orthop|sports medicine|joint|spine/.test(n)) out.add('orthopedics');
  // Same rule as the Spanish classifier: a hospital is where the ER is.
  if (t.has('hospital')) out.add('urgent_care');

  return [...out];
}
