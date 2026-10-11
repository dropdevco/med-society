import type { Specialty } from '../../src/types/provider';
import type { Socials } from './parse-media';

export type EntityType = 'doctor' | 'facility';

/** One row of a {specialty}/{city} listing page. Cheap, no profile fetch needed. */
export interface IndexEntry {
  doctoraliaId: string;
  entityType: EntityType;
  name: string;
  url: string;
  /** Doctoralia slugs this entity was found under, e.g. ['cardiologo']. */
  foundUnderSlugs: string[];
  specializationNames: string[];
  ratingFromListing: number | null;
  reviewCountFromListing: number | null;
  cities: string[];
  isOnlineOnly: boolean;
  isPromoted: boolean;
  hasPhoto: boolean;
  hasCalendar: boolean;
  /** Address line printed on the listing card ("Calle 1, Tijuana"); set by discover.ts. */
  cardAddress?: string | null;
  /** City parsed from cardAddress, used to keep only in-city rows. */
  cardCity?: string | null;
  /** Pin from the listing card's map link. */
  cardLat?: number | null;
  cardLng?: number | null;
}

export interface DoctoraliaAddress {
  addressId: string | null;
  /** Clinic / hospital / "Consultorio" label Doctoralia shows for this location. */
  clinicName: string | null;
  street: string | null;
  district: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  /**
   * Doctoralia's own 24/7 AI booking-assistant number for this address
   * (`address-<id>-<digits>-secretary-ai-phone` modal) — NOT the practice's
   * direct line. Doctoralia allocates these from its own pools (656 738 xxxx
   * in Juárez; 664 9xx xxxx and 55 99xx xxxx in Tijuana — see
   * DOCTORALIA_AI_POOLS in parse.ts). Kept for reference; never written to
   * providers.phone.
   */
  doctoraliaPhone: string | null;
  /**
   * A real, directly-dialable number. Clinic (facility) pages publish one in
   * `data-phone-number`; doctor pages publish one per address in the plain
   * "Número de teléfono" modal (`address-<id>-<digits>-<n>-phone`). Safe to
   * surface to patients.
   */
  phone: string | null;
  /**
   * Every distinct practice number published for this address, in page order
   * (`phone` is the first). Some practices list a landline and a mobile.
   */
  phones: string[];
  isOnlineOnly: boolean;
  /** Insurers accepted at this location, per the address's own modal. */
  insurances: string[];
  paymentMethods: string[];
  services: DoctoraliaService[];
  /** Calendar / booking state for this address; null when the page carries none (clinic pages). */
  booking: DoctoraliaBooking | null;
}

export type Currency = 'MXN' | 'USD';

export interface DoctoraliaService {
  name: string;
  /** Display string as Doctoralia renders it ("$1,500", "Desde $800", "Servicio gratuito"). */
  price: string | null;
  /** /tratamientos-servicios/<slug>/<city>; only the services shown on the address card carry one. */
  slug: string | null;
  /** Doctoralia's catalogue id for the treatment (same across doctors). */
  itemServiceId?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  /** "Desde $X" — priceMin is a floor, not the price. */
  isPriceFrom?: boolean;
  /**
   * MXN unless the doctor's own description / option text explicitly says
   * dollars. null when there is no price at all.
   */
  currency?: Currency | null;
  description?: string | null;
  isBookable?: boolean | null;
  /** ISO-8601 UTC. */
  earliestBookableDate?: string | null;
  /** Online (video) consultation rather than an in-person visit. */
  isOnline?: boolean;
}

export interface DoctoraliaBooking {
  hasActiveCalendar: boolean | null;
  /** 'private' | 'private_and_insurance' | … as Doctoralia reports it. */
  insuranceSupport: string | null;
  hasOnlinePaymentsEnabled: boolean | null;
  /** ISO-8601 UTC; the soonest bookable slot across this address's services. */
  earliestBookableDate: string | null;
}

export interface DoctoraliaReview {
  author: string | null;
  rating: number | null;
  publishedAt: string | null;
  body: string | null;
}

export interface DoctoraliaProfile {
  doctoraliaId: string;
  entityType: EntityType;
  url: string;
  slug: string;
  name: string;
  /** Professional-licence numbers (cédula profesional), as printed. */
  cedulas: string[];
  specializations: string[];
  foundUnderSlugs: string[];
  mappedSpecialties: Specialty[];
  about: string | null;
  imageUrl: string | null;
  /** Wide banner above the profile, `_large` size; null when none was uploaded. */
  coverImageUrl: string | null;
  /**
   * Every image that is the provider's own, at `_large` size, de-duplicated
   * across sizes: portrait/logo, cover, gallery, certificates, news posts.
   * Doctoralia's own banners and other doctors' avatars are excluded.
   */
  photos: { url: string; kind: 'profile' | 'cover' | 'gallery' | 'certificate' | 'news' }[];
  /**
   * Emails the provider wrote on their own profile (website field, about,
   * service descriptions, Q&A answers). Doctoralia publishes none itself; most
   * emails come from the practice website via emails.ts.
   */
  emails: { email: string; source: 'website-field' | 'about' | 'services' | 'qna' }[];
  /** The practice's own site. Facility pages publish one; doctor pages do not. */
  website: string | null;
  rating: number | null;
  reviewCount: number;
  /** Subset embedded in the page; reviewCount is the true total. */
  reviews: DoctoraliaReview[];
  insurances: string[];
  addresses: DoctoraliaAddress[];
  /** Spoken languages as the provider lists them ("Español", "Inglés"). */
  languages: string[];
  /** "Formación" — degrees, courses, congresses, as free text. */
  education: string[];
  /** "Experiencia" — hospitals / positions, as free text. */
  experience: string[];
  /** "Enfocado en:" — the provider's declared focus areas. */
  expertIn: string[];
  /** "Enfermedades tratadas"; slug is the /enfermedades/<slug> page. */
  diseases: { name: string; slug: string | null }[];
  /** Diploma / certificate scans. title is null when Doctoralia only says "certificate N". */
  certificates: { title: string | null; url: string }[];
  /** Embed URLs (YouTube etc.) of the provider's own videos. */
  videos: string[];
  /** Provider's own social profiles (canonicalised by parse-media). */
  socials: Socials;
  /** Gallery photo URLs (parse-media). */
  gallery: string[];
  /** Public Q&A answered by the provider. */
  qna: { question: string; answer: string | null }[];
  /** "Lo más mencionado por los pacientes" chips. count is null when not shown. */
  reviewTags: { text: string; key: string | null; count: number | null }[];
  /** Profile-wide roll-up of the per-address booking state; null when absent. */
  booking: DoctoraliaBooking | null;
  /** Video consultation offered, from the online-only address's services. null on clinic pages. */
  onlineConsultation: { available: boolean; priceMin: number | null; currency: Currency | null } | null;
  /** Clinic pages: "Equipamiento" list. */
  equipment: string[];
  scrapedAt: string;
  /** Fields the page simply did not carry, for coverage reporting. */
  missing: string[];
}
