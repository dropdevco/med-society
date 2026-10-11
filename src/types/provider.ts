import type { RegionId } from '../utils/region';

export type Country = 'MX' | 'US';
export type ProviderSource = 'google' | 'manual' | 'doctoralia';
export type ProviderTier = 'basic' | 'promoted' | 'featured';

export type Specialty =
  | 'dentist'
  | 'orthodontist'
  | 'plastic_surgery'
  | 'aesthetician'
  | 'obgyn'
  | 'physical_therapy'
  | 'massage'
  | 'optometry'
  | 'general'
  | 'pediatrics'
  | 'cardiology'
  | 'urgent_care'
  | 'mental_health'
  | 'pharmacy'
  | 'telehealth'
  | 'neurology'
  | 'otolaryngology'
  | 'orthopedics';

export const SpecialtyLabels: Record<Specialty, string> = {
  dentist: 'Dentist',
  orthodontist: 'Orthodontist',
  plastic_surgery: 'Plastic Surgery',
  aesthetician: 'Aesthetician',
  obgyn: 'OB/GYN & Women\'s Health',
  physical_therapy: 'Physical Therapy',
  massage: 'Massage Therapy',
  optometry: 'Vision & Optometry',
  general: 'Primary & Family Care',
  pediatrics: 'Pediatrics',
  cardiology: 'Cardiology',
  urgent_care: 'Urgent Care',
  mental_health: 'Mental Health',
  pharmacy: 'Pharmacy',
  telehealth: 'Telehealth',
  neurology: 'Neurology',
  otolaryngology: 'Ear, Nose & Throat',
  orthopedics: 'Orthopedics',
};

/** One published service, as scraped from a Doctoralia profile. */
export interface ProviderService {
  name: string;
  /**
   * Machine translation of `name`, written by
   * scripts/doctoralia/translate-services.ts. Absent until that batch has
   * reached this service, or if the service was never in Spanish to begin
   * with — a UI that wants English shows this when present and `name`
   * otherwise, never the other way around.
   */
  nameEn?: string;
  slug?: string;
  /** Verbatim, e.g. '$1,500' or 'Desde $1,000'. Null when unpriced. */
  priceText?: string;
  /** Parsed lower bound in MXN. Null when the price text carried no number. */
  priceMxn?: number;
  /** True for "Desde $X" — the real price starts there and goes up. */
  isFrom?: boolean;
}

export interface ProviderSocials {
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  youtube?: string;
  x?: string;
  linkedin?: string;
  /** https://wa.me/<digits> */
  whatsapp?: string;
}

export interface Provider {
  id: string;
  name: string;
  specialty: Specialty[];
  country: Country;
  city: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  reviewCount: number;
  phone?: string;
  website?: string;
  email?: string;
  /**
   * Empty until a clinic (or, before then, curation) states this directly.
   * It used to be fabricated at ingest — every one of the 3 ingestion paths
   * guessed `['es','en']` or `['en','es']` with zero real signal behind it,
   * which is why 100% of the directory looked bilingual. `languagesConfirmed`
   * is what tells a real answer apart from that old default ever having been
   * anything but empty for an unclaimed listing.
   */
  languages: string[];
  /** True once `languages` has been set by an owner (or by us) rather than guessed. */
  languagesConfirmed: boolean;
  promoted: boolean;
  /**
   * Paid placement. Derived from `tier`, never set on its own — the gold
   * Verified badge is what a listing buys, so anything that can turn it on
   * without a plan behind it devalues every badge on the site.
   */
  verified: boolean;
  /** What the clinic is paying for. 'basic' is everyone who has not. */
  tier: ProviderTier;
  /**
   * A professional licence (cedula profesional) was published on the source
   * profile. A credential we checked, not a plan we sold — this is what
   * `verified` used to mean, for 1,720 rows, which is why it meant nothing.
   */
  licensed: boolean;
  /**
   * Manual curation. Null for almost everyone; low numbers surface first, above
   * the promoted tier, on the default browse. Exists so the team can put
   * clinics with real photography on row one without a deploy.
   */
  featuredRank?: number;
  source: ProviderSource;
  clicks: number;
  googlePlaceId?: string;
  doctoraliaId?: string;
  /** Insurers accepted, verbatim as published (e.g. 'GNP Seguros'). */
  insurances?: string[];
  /** Doctoralia profile with a bookable calendar. Null when there is none. */
  bookingUrl?: string;
  /** MX postal code or US ZIP, extracted from `address` by backfill-postal.ts. */
  postalCode?: string;
  imageUrl?: string;
  /** Social profiles, full https URLs, keys omitted when unknown. */
  socials?: ProviderSocials;
  /** Extra photos the provider published (Doctoralia gallery), in display order. */
  galleryUrls?: string[];
  /** Published services and prices, denormalised by backfill-services.ts. */
  services?: ProviderService[];
  /** Cheapest priced service, denormalised so sorting never walks `services`. */
  priceFromMxn?: number;
  /**
   * Which border region the provider belongs to. Generated in the database
   * from `lng` (migration 0021); absent on mock data, where `regionOf(lng)`
   * gives the same answer.
   */
  region?: RegionId;
  /**
   * Service names, Spanish and English, as the lean `provider_list` view
   * returns them in place of the full `services` menu. The directory only
   * searches and suggests service names; prices and the menu itself load with
   * the provider's own page. See `serviceNamesOf` in utils/search.ts.
   */
  serviceNames?: string[];
}

export type SortMode = 'relevance' | 'rating' | 'reviews' | 'distance' | 'price';

/**
 * A geographic bounding box, in degrees.
 *
 * Shared between the map (which produces one from its camera) and the filter
 * layer (which consumes one as a spatial predicate), so both sides agree on
 * the shape rather than each declaring its own.
 */
export interface MapBox {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface ProviderFilters {
  /**
   * The border region being browsed. Not a filter so much as a scope: only
   * this region's providers are loaded at all, and `country` below means
   * "which side of *this* region's border".
   */
  region: RegionId;
  /**
   * Show the results list even with nothing narrowing it (`list=1`). Set by
   * the Filters dialog: "Show 4,067 results" after picking only a region has
   * to show those results, not fall back to the browse rows because no
   * filter is active.
   */
  browse: boolean;
  search: string;
  /**
   * `search` came from the smart search bar: it is a description of a problem
   * ("me duele el oído"), answered from patient reviews (api/ai-search.ts),
   * not words to match against names and services.
   */
  smart: boolean;
  /** Multi-select: a provider matches if it holds *any* of these. */
  specialty: Specialty[];
  /** Side of the selected region's border: '' both, 'US' or 'MX'. */
  country: Country | '';
  minRating: number;
  /** Insurer names, verbatim. A provider matches if it accepts any of them. */
  insurances: string[];
  /** ISO-ish language codes as stored on the provider, e.g. 'en', 'es'. */
  languages: string[];
  /** Only providers whose credentials we verified. */
  verifiedOnly: boolean;
  /**
   * Only providers that publish prices. Roughly a third of the directory does,
   * so this hides a lot — it is opt-in, and it gates `maxPriceMxn` because a
   * price ceiling on its own would silently drop everyone we have no price for.
   */
  withPricing: boolean;
  /** Ceiling in MXN on the cheapest service. Ignored unless `withPricing`. */
  maxPriceMxn: number | null;
  sort: SortMode;
  /**
   * A five-digit code the user searched for. When set, results are limited to
   * providers within `radiusKm` of that code's centre and sorted by distance.
   * Empty string means no location filter is active.
   */
  postalCode: string;
  /** Radius around `postalCode`, in kilometres. Ignored when postalCode is ''. */
  radiusKm: number;
  /**
   * The map viewport the user explicitly searched, via "Search this area".
   * Null when the map is not filtering — which is the default, because the
   * map must never narrow the results just by being panned.
   */
  mapArea: MapBox | null;
}
