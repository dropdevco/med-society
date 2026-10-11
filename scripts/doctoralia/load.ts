/**
 * Load out/profiles.jsonl into Supabase, dedupe against `providers`, and
 * (optionally) promote the new ones into the marketplace.
 *
 *   npx tsx scripts/doctoralia/load.ts stage             # dry run
 *   npx tsx scripts/doctoralia/load.ts stage   --commit  # write staging tables
 *   npx tsx scripts/doctoralia/load.ts match   --commit  # dedupe vs providers
 *   npx tsx scripts/doctoralia/load.ts promote --commit  # insert approved rows into providers
 *   npx tsx scripts/doctoralia/load.ts details --commit  # provider_details + fill blanks on existing rows
 *
 * Every phase takes --city=tijuana (default Ciudad Juárez), like the scraper.
 *
 * Nothing is written without --commit. `promote` never updates or deletes an
 * existing providers row — it only inserts entities that matched nothing.
 * `details` upserts provider_details and only ever fills *blank* columns on
 * existing Doctoralia rows (photo, gallery, socials, email, website).
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import { pathToFileURL } from 'url';
import { createClient } from '@supabase/supabase-js';
import { CITY_SLUG, OUT_DIR, PROFILES_FILE } from './config';
import { priceFromOf, servicesOf } from './backfill-services';
import type { EmailRecord } from './emails';
import type { DoctoraliaProfile } from './types';

const argv = process.argv.slice(2);
const phase = argv.find((a) => !a.startsWith('--')) ?? 'stage';
const commit = argv.includes('--commit');

// The scripts in this repo each parse .env.local themselves (no dotenv dep).
function loadEnv() {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      out[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const env = loadEnv();
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('✖ VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Supabase over REST drops the occasional connection on a long sequential run
 * (a full stage/match is ~9,000 round trips). A transient `fetch failed` should
 * cost a retry, not the whole pass — the earlier match run died at 800/2794.
 */
// Accepts PromiseLike because Supabase query builders are thenable, not Promises.
async function withRetry<T>(label: string, fn: () => PromiseLike<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const backoff = 1_000 * 2 ** i;
      console.warn(`
  ↻ ${label} failed (${err instanceof Error ? err.message : err}) — retrying in ${backoff / 1000}s`);
      await sleep(backoff);
    }
  }
  throw lastErr;
}

function readProfiles(): DoctoraliaProfile[] {
  if (!fs.existsSync(PROFILES_FILE)) {
    console.error(`✖ ${PROFILES_FILE} not found — run the scrape first.`);
    process.exit(1);
  }
  const byId = new Map<string, DoctoraliaProfile>();
  for (const line of fs.readFileSync(PROFILES_FILE, 'utf-8').split('\n').filter(Boolean)) {
    try {
      const p = JSON.parse(line) as DoctoraliaProfile;
      byId.set(p.doctoraliaId, p); // last write wins on a re-scrape
    } catch {
      // half-written line from an interrupted run
    }
  }
  return [...byId.values()];
}

// ── normalisation ────────────────────────────────────────────────────────────

const TITLES = /\b(dr|dra|drs|lic|mtro|mtra|ing|c\.?d|m\.?c|md|phd|esp|prof)\b\.?/g;

/** Accent-folded, title-stripped, punctuation-free name for comparison. */
export function normName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(TITLES, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard — order-insensitive, which suits Spanish two-surname names. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normName(a).split(' ').filter((t) => t.length > 2));
  const tb = new Set(normName(b).split(' ').filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / new Set([...ta, ...tb]).size;
}

/** Metres between two WGS84 points (haversine). */
export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** '$1,500' → 1500 · 'Desde $1,000' → 1000 (from) · 'Servicio gratuito' → 0 */
export function parsePrice(text: string | null): { mxn: number | null; isFrom: boolean } {
  if (!text) return { mxn: null, isFrom: false };
  if (/gratuito|gratis/i.test(text)) return { mxn: 0, isFrom: false };
  const isFrom = /desde/i.test(text);
  const m = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return { mxn: m ? Number(m[1]) : null, isFrom };
}

/**
 * The El Paso / Ciudad Juárez region. Used to pick the right practice location:
 * a doctor listed in Juárez may also practise in Guadalajara or Mexico City,
 * and promoting the wrong address puts a pin 1,500km off and drags the map's
 * bounds with it.
 */
export const BORDER_BOX = { minLat: 31.3, maxLat: 32.2, minLng: -106.9, maxLng: -106.0 };

/**
 * Per scraped city: the map region used to pick the practice location, the
 * city-name pattern used as a fallback, and the `providers.city` spelling.
 * Tijuana's box covers the municipality incl. Playas de Tijuana, Otay and the
 * eastern colonias (La Presa, El Florido), and stops short of Rosarito and
 * Tecate (-116.62), which have their own Doctoralia slugs.
 */
const CITY_CONFIG = {
  'ciudad-juarez': { box: BORDER_BOX, cityPattern: /ju[aá]rez/i, providerCity: 'Juárez' },
  tijuana: {
    box: { minLat: 32.36, maxLat: 32.58, minLng: -117.13, maxLng: -116.70 },
    cityPattern: /tijuana/i,
    providerCity: 'Tijuana',
  },
} as const;
const REGION = CITY_CONFIG[CITY_SLUG];

const inBorderRegion = (a: { lat: number | null; lng: number | null }) =>
  a.lat != null &&
  a.lng != null &&
  a.lat >= REGION.box.minLat &&
  a.lat <= REGION.box.maxLat &&
  a.lng >= REGION.box.minLng &&
  a.lng <= REGION.box.maxLng;

function primaryAddress(p: DoctoraliaProfile) {
  return (
    // Coordinates first: the `city` string is often missing or spelled
    // differently, and matching on it silently selected out-of-region practices.
    p.addresses.find(inBorderRegion) ??
    p.addresses.find((a) => REGION.cityPattern.test(a.city ?? '') && a.lat !== null) ??
    p.addresses.find((a) => a.lat !== null) ??
    p.addresses[0] ??
    null
  );
}

function formatAddress(p: DoctoraliaProfile): string | null {
  const a = primaryAddress(p);
  if (!a) return null;
  return [a.street, a.district, a.postalCode, a.city, a.province, a.countryCode === 'MX' ? 'México' : a.countryCode]
    .filter(Boolean)
    .join(', ');
}

// ── phase: stage ─────────────────────────────────────────────────────────────

async function stage() {
  const profiles = readProfiles();
  console.log(`\n📥 Staging ${profiles.length} entities${commit ? '' : ' (dry run — pass --commit to write)'}\n`);

  const doctors = profiles.map((p) => ({
    doctoralia_id: p.doctoraliaId,
    entity_type: p.entityType,
    name: p.name,
    slug: p.slug,
    url: p.url,
    cedulas: p.cedulas,
    specializations: p.specializations,
    found_under_slugs: p.foundUnderSlugs,
    mapped_specialties: p.mappedSpecialties,
    about: p.about,
    image_url: p.imageUrl,
    rating: p.rating,
    review_count: p.reviewCount,
    insurances: p.insurances,
    languages: p.languages,
    is_promoted: false,
    scraped_at: p.scrapedAt,
    raw: p,
    updated_at: new Date().toISOString(),
  }));

  console.log(`  doctoralia_doctors    ${doctors.length}`);
  console.log(`  doctoralia_addresses  ${profiles.reduce((n, p) => n + p.addresses.length, 0)}`);
  console.log(
    `  doctoralia_services   ${profiles.reduce((n, p) => n + p.addresses.reduce((m, a) => m + a.services.length, 0), 0)}`,
  );
  console.log(`  doctoralia_reviews    ${profiles.reduce((n, p) => n + p.reviews.length, 0)}`);

  if (!commit) return;

  for (let i = 0; i < doctors.length; i += 200) {
    const chunk = doctors.slice(i, i + 200);
    await withRetry('doctoralia_doctors upsert', async () => {
      const { error } = await supabase.from('doctoralia_doctors').upsert(chunk, { onConflict: 'doctoralia_id' });
      if (error) throw new Error(`doctoralia_doctors upsert failed: ${error.message}`);
    });
    process.stdout.write(`\r  doctors ${Math.min(i + 200, doctors.length)}/${doctors.length}`);
  }
  console.log();

  // Addresses are replaced wholesale per doctor so a re-scrape drops stale
  // locations. Batched 100 doctors at a time: the per-row version was ~25k
  // round trips for Tijuana's 8,900 addresses.
  const addressRow = (p: DoctoraliaProfile, a: DoctoraliaProfile['addresses'][number]) => ({
    doctoralia_id: p.doctoraliaId,
    address_id: a.addressId,
    clinic_name: a.clinicName,
    street: a.street,
    district: a.district,
    postal_code: a.postalCode,
    city: a.city,
    province: a.province,
    country_code: a.countryCode,
    lat: a.lat,
    lng: a.lng,
    doctoralia_phone: a.doctoraliaPhone,
    phone: a.phone,
    is_online_only: a.isOnlineOnly,
    insurances: a.insurances,
    payment_methods: a.paymentMethods,
  });
  const serviceRows = (p: DoctoraliaProfile, a: DoctoraliaProfile['addresses'][number], addressUuid: string) =>
    a.services.map((s) => {
      const { mxn, isFrom } = parsePrice(s.price);
      const usd = s.currency === 'USD';
      return {
        address_id: addressUuid,
        doctoralia_id: p.doctoraliaId,
        name: s.name,
        slug: s.slug,
        price_text: s.price,
        // A dollar quote is never a peso amount; price_min/currency keep the figure.
        price_mxn: usd ? null : mxn,
        price_is_from: s.isPriceFrom ?? isFrom,
        currency: s.currency ?? null,
        price_min: s.priceMin ?? null,
        price_max: s.priceMax ?? null,
      };
    });

  for (let i = 0; i < profiles.length; i += 100) {
    const batch = profiles.slice(i, i + 100);
    const ids = batch.map((p) => p.doctoraliaId);
    await withRetry('clear addresses', async () => {
      const { error } = await supabase.from('doctoralia_addresses').delete().in('doctoralia_id', ids);
      if (error) throw new Error(error.message);
    });

    // Address ids are unique per doctor, so (doctor, address id) maps each
    // returned uuid back to its services. Doctors whose addresses lack a
    // unique id (rare) go one address at a time instead.
    const key = (doctor: string, addr: string | null) => `${doctor}|${addr}`;
    const bulk = batch.filter((p) => new Set(p.addresses.map((a) => a.addressId)).size === p.addresses.length && p.addresses.every((a) => a.addressId));
    const single = batch.filter((p) => !bulk.includes(p));

    const uuidByKey = new Map<string, string>();
    const bulkRows = bulk.flatMap((p) => p.addresses.map((a) => addressRow(p, a)));
    if (bulkRows.length) {
      const inserted = await withRetry('insert addresses', async () => {
        const { data, error } = await supabase.from('doctoralia_addresses').insert(bulkRows).select('id,doctoralia_id,address_id');
        if (error) throw new Error(error.message);
        return data!;
      });
      for (const r of inserted) uuidByKey.set(key(r.doctoralia_id, r.address_id), r.id);
    }
    const services: ReturnType<typeof serviceRows> = [];
    for (const p of bulk) for (const a of p.addresses) services.push(...serviceRows(p, a, uuidByKey.get(key(p.doctoraliaId, a.addressId))!));
    for (const p of single) {
      for (const a of p.addresses) {
        const row = await withRetry(`address ${p.doctoraliaId}`, async () => {
          const { data, error } = await supabase.from('doctoralia_addresses').insert(addressRow(p, a)).select('id').single();
          if (error) throw new Error(error.message);
          return data!;
        });
        services.push(...serviceRows(p, a, row.id));
      }
    }
    for (let j = 0; j < services.length; j += 1000) {
      const chunk = services.slice(j, j + 1000);
      await withRetry('insert services', async () => {
        const { error } = await supabase.from('doctoralia_services').insert(chunk);
        if (error) throw new Error(error.message);
      });
    }

    const reviews = batch.flatMap((p) =>
      p.reviews
        .filter((r) => r.publishedAt)
        .map((r) => ({ doctoralia_id: p.doctoraliaId, author: r.author, rating: r.rating, published_at: r.publishedAt, body: r.body })),
    );
    // The unique key is (doctor, author, date); two reviews sharing it in one batch would abort the upsert.
    const uniqueReviews = [...new Map(reviews.map((r) => [`${r.doctoralia_id}|${r.author}|${r.published_at}`, r])).values()];
    if (uniqueReviews.length) {
      await withRetry('upsert reviews', async () => {
        const { error } = await supabase
          .from('doctoralia_reviews')
          .upsert(uniqueReviews, { onConflict: 'doctoralia_id,author,published_at', ignoreDuplicates: true });
        if (error) throw new Error(error.message);
      });
    }

    process.stdout.write(`\r  addresses/services/reviews ${Math.min(i + 100, profiles.length)}/${profiles.length}`);
  }
  console.log('\n  ✅ staged');
}

// ── phase: match ─────────────────────────────────────────────────────────────

interface ProviderRow {
  id: string;
  name: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  source: string | null;
  doctoraliaId: string | null;
}

async function fetchProviders(): Promise<ProviderRow[]> {
  const all: ProviderRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('providers')
      .select('id,name,city,lat,lng,phone,source,"doctoraliaId"')
      .range(from, from + 999);
    if (error) throw new Error(`providers fetch failed: ${error.message}`);
    all.push(...(data as ProviderRow[]));
    if (!data || data.length < 1000) break;
  }
  return all;
}

/**
 * Dedupe rules, deliberately conservative:
 *
 *  - A Doctoralia *doctor* is a person; an existing Google row is almost always
 *    a clinic. "Dr. X who works at Hospital Ángeles" must not collapse into the
 *    "Hospital Ángeles" row, so we compare person-name to provider-name only —
 *    never the clinic label — and require both a name and a location agreement.
 *  - A Doctoralia *facility* can legitimately be the same business as a Google
 *    row, so the same rule catches it via the name.
 *  - Phone is NOT used: the only number Doctoralia publishes is their own
 *    booking-assistant line, which is identical in shape across all doctors.
 */
function classify(p: DoctoraliaProfile, providers: ProviderRow[]) {
  const addr = primaryAddress(p);
  let best: { provider: ProviderRow; sim: number; dist: number | null } | null = null;

  for (const prov of providers) {
    const sim = nameSimilarity(p.name, prov.name);
    if (sim < 0.5) continue;
    const dist =
      addr?.lat != null && addr.lng != null && prov.lat != null && prov.lng != null
        ? distanceMeters(addr.lat, addr.lng, prov.lat, prov.lng)
        : null;
    if (!best || sim > best.sim || (sim === best.sim && (dist ?? Infinity) < (best.dist ?? Infinity))) {
      best = { provider: prov, sim, dist };
    }
  }

  if (!best) return { method: 'new' as const, confidence: 0, match: null };
  if (best.sim >= 0.95 && (best.dist === null || best.dist <= 1000)) {
    return { method: 'name_geo' as const, confidence: Number(best.sim.toFixed(2)), match: best };
  }
  if (best.sim >= 0.8 && best.dist !== null && best.dist <= 300) {
    return { method: 'name_geo' as const, confidence: Number(best.sim.toFixed(2)), match: best };
  }
  // A similar name 1,000 km away is a different person (a Tijuana "Dra. Ana
  // López" vs a Juárez one); only nearby look-alikes need a human.
  if (best.sim >= 0.65 && (best.dist === null || best.dist <= 50_000)) {
    return { method: 'possible' as const, confidence: Number(best.sim.toFixed(2)), match: best };
  }
  return { method: 'new' as const, confidence: 0, match: null };
}

async function match() {
  const profiles = readProfiles();
  const providers = await fetchProviders();
  console.log(`\n🔍 Matching ${profiles.length} scraped entities against ${providers.length} existing providers\n`);

  const buckets = { new: 0, name_geo: 0, possible: 0, doctoralia_id: 0 };
  // Same Doctoralia id = same person, wherever they practise: a Juárez doctor
  // who also consults in Tijuana is already a listing and must stay linked to it.
  const byDoctoraliaId = new Map(providers.filter((r) => r.doctoraliaId).map((r) => [r.doctoraliaId!, r]));
  const updates: { doctoralia_id: string; provider_id: string | null; match_method: string; match_confidence: number; review_status: string }[] = [];
  const samples: string[] = [];

  for (const p of profiles) {
    const existing = byDoctoraliaId.get(p.doctoraliaId);
    if (existing) {
      buckets.doctoralia_id++;
      updates.push({
        doctoralia_id: p.doctoraliaId,
        provider_id: existing.id,
        match_method: 'doctoralia_id',
        match_confidence: 1,
        review_status: 'approved',
      });
      continue;
    }
    const { method, confidence, match: m } = classify(p, providers);
    buckets[method]++;
    updates.push({
      doctoralia_id: p.doctoraliaId,
      provider_id: method === 'name_geo' ? m!.provider.id : null,
      match_method: method,
      match_confidence: confidence,
      // Only clean 'new' rows are auto-approved for promotion; anything that
      // looked like an existing provider waits for a human.
      review_status: method === 'new' ? 'approved' : 'pending',
    });
    if (m && samples.length < 15) {
      samples.push(
        `    ${method.padEnd(9)} ${confidence.toFixed(2)}  ${p.name}  ↔  ${m.provider.name}` +
          (m.dist !== null ? `  (${Math.round(m.dist)}m)` : '  (no geo)'),
      );
    }
  }

  console.log(`  new (no existing provider)   ${buckets.new}`);
  console.log(`  matched an existing provider ${buckets.name_geo}`);
  console.log(`  possible duplicate, review   ${buckets.possible}`);
  console.log(`  already listed (same id)     ${buckets.doctoralia_id}`);
  if (samples.length) console.log('\n  sample decisions:\n' + samples.join('\n'));

  if (!commit) {
    console.log('\n  (dry run — pass --commit to persist match results)');
    return;
  }

  for (let i = 0; i < updates.length; i += 200) {
    for (const u of updates.slice(i, i + 200)) {
      const { error } = await supabase
        .from('doctoralia_doctors')
        .update({
          provider_id: u.provider_id,
          match_method: u.match_method,
          match_confidence: u.match_confidence,
          review_status: u.review_status,
          updated_at: new Date().toISOString(),
        })
        .eq('doctoralia_id', u.doctoralia_id);
      if (error) throw new Error(`match update failed for ${u.doctoralia_id}: ${error.message}`);
    }
    process.stdout.write(`\r  persisted ${Math.min(i + 200, updates.length)}/${updates.length}`);
  }
  console.log('\n  ✅ matched');
}

// ── phase: promote ───────────────────────────────────────────────────────────

async function promote() {
  const profiles = new Map(readProfiles().map((p) => [p.doctoraliaId, p]));
  const siteEmails = readSiteEmails();

  // Page: Supabase caps a select at 1,000 rows and there are ~2,700 approved.
  const data: {
    doctoralia_id: string;
    google_phone: string | null;
    google_website: string | null;
    google_place_id: string | null;
    google_match_type: string | null;
  }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabase
      .from('doctoralia_doctors')
      .select('doctoralia_id,google_phone,google_website,google_place_id,google_match_type')
      .eq('review_status', 'approved')
      .is('provider_id', null)
      .range(from, from + 999);
    if (error) throw new Error(`could not read approved rows: ${error.message}`);
    data.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }

  const approved = data.filter((r) => profiles.has(r.doctoralia_id));
  console.log(`\n⬆ Promoting ${approved.length} approved entities into providers${commit ? '' : ' (dry run)'}\n`);

  let inserted = 0;
  let skipped = 0;
  let withPhone = 0;
  let withEmail = 0;
  let linkedToExisting = 0;
  let outOfRegion = 0;

  for (const row of approved) {
    const p = profiles.get(row.doctoralia_id)!;
    const addr = primaryAddress(p);
    if (!addr?.lat || !addr?.lng) {
      skipped++; // the map needs coordinates; leave it staged for manual geocoding
      continue;
    }
    // Listing pages carry some providers who only practise in a neighbouring
    // city (Tecate, Ensenada, Rosarito). Labelling them with this city would
    // put a "Tijuana" pin in Ensenada; leave them staged instead. Coordinates
    // only: Doctoralia's own city field said "Tijuana" for addresses in
    // Mexicali, Ensenada and San Ysidro, CA (14 rows hidden after the first load).
    if (!inBorderRegion(addr)) {
      outOfRegion++;
      continue;
    }
    const isEntityMatch = row.google_match_type === 'entity';
    const services = servicesOf(p);

    const providerRow = {
      id: crypto.randomUUID(),
      name: p.name,
      specialty: p.mappedSpecialties.length ? p.mappedSpecialties : ['general'],
      country: 'MX',
      // One spelling per city so filters group ('Juárez', 'Tijuana').
      city: REGION.providerCity,
      address: formatAddress(p),
      lat: addr.lat,
      lng: addr.lng,
      rating: p.rating ?? 0,
      reviewCount: p.reviewCount,
      // Order of preference for contact details:
      //   1. what the clinic published on Doctoralia itself
      //   2. a Google listing that IS this provider ('entity')
      // A 'venue' match is the building's switchboard, not this provider's
      // line, so it is deliberately not promoted — see sweep.ts.
      phone: p.addresses.find((a) => a.phone)?.phone ?? (isEntityMatch ? row.google_phone : null),
      website: p.website ?? (isEntityMatch ? row.google_website : null),
      email: bestEmail(p, siteEmails.get(p.doctoraliaId)),
      // Scraped from the provider's own "Idiomas" list. Inserted, not updated,
      // so languages_confirmed stays false (its trigger fires on UPDATE only):
      // the provider stated it on Doctoralia, not to us.
      languages: languageCodes(p.languages),
      promoted: false,
      verified: p.cedulas.length > 0,
      licensed: p.cedulas.length > 0, // same rule as migration 0002
      postalCode: primaryAddress(p)?.postalCode ?? null,
      insurances: p.insurances,
      services,
      priceFromMxn: priceFromOf(services),
      socials: p.socials ?? {},
      galleryUrls: p.gallery ?? [],
      source: 'doctoralia',
      clicks: 0,
      imageUrl: p.imageUrl,
      doctoraliaId: p.doctoraliaId,
      googlePlaceId: isEntityMatch ? row.google_place_id : null,
    };

    if (providerRow.phone) withPhone++;
    if (providerRow.email) withEmail++;

    if (!commit) {
      if (inserted < 3) {
        console.log(
          `    would insert: ${providerRow.name} · ${providerRow.specialty.join(', ')} · ` +
            `${providerRow.phone ?? 'no phone'}`,
        );
      }
      inserted++;
      continue;
    }

    const { error: insErr } = await supabase.from('providers').insert(providerRow);
    if (insErr) {
      // A duplicate googlePlaceId means this entity IS an existing provider that
      // the name matcher missed — the unique index caught what we didn't. Link
      // to that row instead of dropping the entity on the floor.
      if (insErr.message.includes('googlePlaceId') && providerRow.googlePlaceId) {
        const { data: existing } = await supabase
          .from('providers')
          .select('id')
          .eq('googlePlaceId', providerRow.googlePlaceId)
          .maybeSingle();
        if (existing) {
          await supabase
            .from('doctoralia_doctors')
            .update({
              provider_id: existing.id,
              match_method: 'google_place_id',
              match_confidence: 1,
              review_status: 'duplicate',
              updated_at: new Date().toISOString(),
            })
            .eq('doctoralia_id', p.doctoraliaId);
          linkedToExisting++;
          continue;
        }
      }
      console.error(`  ✖ insert failed for ${p.name}: ${insErr.message}`);
      continue;
    }
    await supabase
      .from('doctoralia_doctors')
      .update({ provider_id: providerRow.id, updated_at: new Date().toISOString() })
      .eq('doctoralia_id', p.doctoraliaId);
    const { error: dErr } = await supabase
      .from('provider_details')
      .upsert(detailsRow(providerRow.id, p), { onConflict: 'provider_id' });
    if (dErr) console.error(`  ✖ provider_details failed for ${p.name}: ${dErr.message}`);
    inserted++;
    if (inserted % 25 === 0) process.stdout.write(`\r  inserted ${inserted}/${approved.length}`);
  }

  console.log(`\n  ${commit ? 'inserted' : 'would insert'}: ${inserted}`);
  console.log(`  ...with a phone:            ${withPhone}`);
  console.log(`  ...with an email:           ${withEmail}`);
  console.log(`  linked to existing row:   ${linkedToExisting}`);
  console.log(`  skipped (no coordinates): ${skipped}`);
  console.log(`  skipped (outside ${REGION.providerCity}): ${outOfRegion}`);
}

// ── emails & details ─────────────────────────────────────────────────────────

/**
 * providers.languages holds ISO codes ('es', 'en') — the language filter and
 * every existing row use them. Doctoralia prints the Spanish names.
 */
const LANGUAGE_CODES: Record<string, string> = {
  español: 'es', inglés: 'en', francés: 'fr', italiano: 'it', alemán: 'de', portugués: 'pt',
  ruso: 'ru', catalán: 'ca', japonés: 'ja', chino: 'zh', coreano: 'ko', árabe: 'ar', hebreo: 'he',
};
function languageCodes(names: string[]): string[] {
  return [...new Set(names.map((n) => LANGUAGE_CODES[n.trim().toLowerCase()] ?? n.trim().toLowerCase()))];
}

/** emails.ts output, keyed by doctoralia id. Missing file → no website emails. */
function readSiteEmails(): Map<string, EmailRecord> {
  const file = `${OUT_DIR}/emails.jsonl`;
  const out = new Map<string, EmailRecord>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)) {
    try {
      const r = JSON.parse(line) as EmailRecord;
      out.set(r.doctoraliaId, r);
    } catch {
      // half-written line
    }
  }
  return out;
}

/**
 * One public email per provider. What the provider wrote on their own profile
 * wins; then their website, preferring an address on the site's own domain
 * (info@clinic.com) over a free-mail one, in page order otherwise.
 */
function bestEmail(p: DoctoraliaProfile, site: EmailRecord | undefined): string | null {
  if (p.emails?.length) return p.emails[0].email;
  const found = site?.emails ?? [];
  return (found.find((e) => e.onSiteDomain) ?? found[0])?.email ?? null;
}

function detailsRow(providerId: string, p: DoctoraliaProfile) {
  return {
    provider_id: providerId,
    doctoralia_id: p.doctoraliaId,
    about: p.about,
    education: p.education ?? [],
    experience: p.experience ?? [],
    expert_in: p.expertIn ?? [],
    diseases: p.diseases ?? [],
    certificates: p.certificates ?? [],
    videos: p.videos ?? [],
    qna: p.qna ?? [],
    review_tags: p.reviewTags ?? [],
    booking: p.booking ?? null,
    online_consultation: p.onlineConsultation ?? null,
    equipment: p.equipment ?? [],
    cover_image_url: p.coverImageUrl ?? null,
    photos: p.photos ?? [],
    phones: [...new Set(p.addresses.flatMap((a) => a.phones ?? (a.phone ? [a.phone] : [])))],
    payment_methods: [...new Set(p.addresses.flatMap((a) => a.paymentMethods))],
    updated_at: new Date().toISOString(),
  };
}

const isPlaceholder = (url: string | null) => !url || /open-graph|\/og\.png/i.test(url);

/**
 * For providers rows that already exist (Juárez, or anything promoted earlier):
 * upsert provider_details, and fill — never overwrite — the photo, gallery,
 * socials, email and website columns. `source = 'self'` rows are the clinic's
 * own listing and are never touched; nor is `languages`, whose UPDATE trigger
 * would mark scraped languages as confirmed.
 */
async function details() {
  const profiles = new Map(readProfiles().map((p) => [p.doctoraliaId, p]));
  const siteEmails = readSiteEmails();

  const rows: { id: string; doctoraliaId: string; source: string | null; imageUrl: string | null; galleryUrls: string[] | null; socials: Record<string, string> | null; email: string | null; website: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('providers')
      .select('id,"doctoraliaId",source,"imageUrl","galleryUrls",socials,email,website')
      .not('doctoraliaId', 'is', null)
      .order('id')
      .range(from, from + 999);
    if (error) throw new Error(`providers fetch failed: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const targets = rows.filter((r) => profiles.has(r.doctoraliaId) && r.source !== 'self');
  console.log(`\n🧾 provider_details for ${targets.length} existing providers${commit ? '' : ' (dry run)'}\n`);

  const fills = { imageUrl: 0, galleryUrls: 0, socials: 0, email: 0, website: 0 };
  const patches: { id: string; patch: Record<string, unknown> }[] = [];
  for (const r of targets) {
    const p = profiles.get(r.doctoraliaId)!;
    const patch: Record<string, unknown> = {};
    if (isPlaceholder(r.imageUrl) && p.imageUrl && !isPlaceholder(p.imageUrl)) patch.imageUrl = p.imageUrl;
    if (!r.galleryUrls?.length && p.gallery?.length) patch.galleryUrls = p.gallery;
    if ((!r.socials || !Object.keys(r.socials).length) && p.socials && Object.keys(p.socials).length) patch.socials = p.socials;
    const email = bestEmail(p, siteEmails.get(p.doctoraliaId));
    if (!r.email && email) patch.email = email;
    if (!r.website && p.website) patch.website = p.website;
    for (const k of Object.keys(patch) as (keyof typeof fills)[]) fills[k]++;
    if (Object.keys(patch).length) patches.push({ id: r.id, patch });
  }
  console.log(`  details rows          ${targets.length}`);
  for (const [k, n] of Object.entries(fills)) console.log(`  fill blank ${k.padEnd(11)}${n}`);
  if (!commit) return;

  const all = targets.map((r) => detailsRow(r.id, profiles.get(r.doctoraliaId)!));
  for (let i = 0; i < all.length; i += 200) {
    const chunk = all.slice(i, i + 200);
    await withRetry('provider_details upsert', async () => {
      const { error } = await supabase.from('provider_details').upsert(chunk, { onConflict: 'provider_id' });
      if (error) throw new Error(error.message);
    });
    process.stdout.write(`\r  details ${Math.min(i + 200, all.length)}/${all.length}`);
  }
  console.log();
  for (const [i, { id, patch }] of patches.entries()) {
    await withRetry(`fill ${id}`, async () => {
      const { error } = await supabase.from('providers').update(patch).eq('id', id);
      if (error) throw new Error(error.message);
    });
    if ((i + 1) % 100 === 0 || i === patches.length - 1) process.stdout.write(`\r  filled ${i + 1}/${patches.length}`);
  }
  console.log('\n  ✅ details written');
}

// Only run when invoked directly — selftest.ts imports the helpers above.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  void (async () => {
  if (phase === 'stage') await stage();
  else if (phase === 'match') await match();
  else if (phase === 'promote') await promote();
  else if (phase === 'details') await details();
  else {
    console.error(`unknown phase "${phase}" — expected stage | match | promote | details`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('\n✖ fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
}
