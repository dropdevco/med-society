import * as cheerio from 'cheerio';
import { AREA_SLUGS, BASE, CITY_LABEL, CITY_SLUG, FACILITY_SPEC_CITY_SITEMAP, SPEC_CITY_SITEMAP } from './config';
import { politeGet } from './http';
import type { EntityType, IndexEntry } from './types';

/** Every landing page in a sitemap whose path ends in one of the city's location slugs. */
export async function listCityLandingPages(): Promise<string[]> {
  const urls = new Set<string>();

  for (const sitemap of [SPEC_CITY_SITEMAP, FACILITY_SPEC_CITY_SITEMAP]) {
    // Always live: a cached sitemap from an earlier city's run would hide landing
    // pages added since. Two requests, so cost is nothing.
    const xml = await politeGet(sitemap, { useCache: false });
    if (!xml) {
      console.warn(`  ! could not read ${sitemap}`);
      continue;
    }
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const url = m[1].trim();
      // Anchored, so e.g. benito-juarez never matches ciudad-juarez (see config.ts)
      if (AREA_SLUGS.some((a) => url.endsWith(`/${a}`))) urls.add(url);
    }
  }

  return [...urls].sort();
}

/** Specialty slug of a landing page, e.g. 'medico-general' or 'clinicas/odontologia'. */
export function slugFromLandingPage(url: string): string {
  const rest = url.replace(`${BASE}/`, '');
  return rest.slice(0, rest.lastIndexOf('/'));
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Parse the result cards on one listing page. Cards carry everything in data-* attrs. */
export function parseListingPage(html: string, slug: string): IndexEntry[] {
  const $ = cheerio.load(html);
  const entries: IndexEntry[] = [];

  $('[data-id="result-item"]').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('data-result-id');
    const url = $el.attr('data-doctor-url');
    if (!id || !url) return;

    const specNames = ($el.attr('data-eec-specialization-name') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // The card's first address line: "<street>, <City>" followed by a Google
    // Maps link carrying the coordinates. Used to keep borough pages honest.
    const $addr = $el.find('[data-test-id="address-map-link"]').first().closest('p');
    const cardAddress = $addr.find('.text-truncate').first().text().replace(/\s+/g, ' ').trim() || null;
    const cardCoords = ($addr.find('[data-test-id="address-map-link"]').attr('href') ?? '').match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);

    entries.push({
      doctoraliaId: id,
      cardAddress,
      cardCity: cardAddress?.includes(',') ? cardAddress.slice(cardAddress.lastIndexOf(',') + 1).trim() || null : null,
      cardLat: cardCoords ? Number(cardCoords[1]) : null,
      cardLng: cardCoords ? Number(cardCoords[2]) : null,
      entityType: (($el.attr('data-test-entity-type') as EntityType) ?? 'doctor'),
      name: $el.attr('data-doctor-name') ?? $el.find('[itemprop="name"]').first().text().trim(),
      url,
      foundUnderSlugs: [slug],
      specializationNames: specNames,
      ratingFromListing: num($el.attr('data-eec-stars-rating')),
      reviewCountFromListing: num($el.attr('data-eec-opinions-count')),
      cities: ($el.attr('data-eec-address-cities') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      isOnlineOnly: $el.attr('data-is-online-only') === 'true',
      isPromoted: $el.attr('data-is-first-class') === '1',
      hasPhoto: $el.attr('data-eec-has-photo') !== undefined,
      hasCalendar: $el.attr('data-eec-has-calendar') !== undefined,
    });
  });

  return entries;
}

/**
 * Walk one landing page and its ?page=N siblings until a page returns no cards
 * or repeats what we already have (Doctoralia clamps out-of-range pages to the
 * last real page rather than 404ing, so a repeat means we're done).
 */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Borough pages (e.g. /medico-general/playas-de-tijuana) are padded with the
 * rest of the state once the borough's own results run out — page 80 of that
 * one is Ensenada and Mexicali. On those pages keep only cards whose address
 * line names the city. The city's own pages are kept whole, as before.
 */
function belongsToCity(landingUrl: string, e: IndexEntry): boolean {
  if (landingUrl.endsWith(`/${CITY_SLUG}`)) return true;
  // Contains, not equals: cards also say 'Playas de Tijuana', 'Zona Urbana Rio Tijuana'.
  return fold(e.cardCity ?? '').includes(fold(CITY_LABEL));
}

export async function crawlLandingPage(landingUrl: string, maxPages = 200): Promise<IndexEntry[]> {
  const slug = slugFromLandingPage(landingUrl);
  const collected: IndexEntry[] = [];
  const seenOnThisSlug = new Set<string>();

  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? landingUrl : `${landingUrl}?page=${page}`;
    const html = await politeGet(url);
    if (!html) break;

    const entries = parseListingPage(html, slug);
    if (entries.length === 0) break;

    const fresh = entries.filter((e) => !seenOnThisSlug.has(e.doctoraliaId));
    if (fresh.length === 0) break; // page clamped back to a page we already read

    for (const e of fresh) {
      seenOnThisSlug.add(e.doctoraliaId);
      if (belongsToCity(landingUrl, e)) collected.push(e);
    }

    process.stdout.write(`\r    ${slug}: page ${page}, ${collected.length} entities`);
    if (entries.length < 20) break; // short page = last page
  }

  process.stdout.write(`\r    ${slug}: ${collected.length} entities${' '.repeat(20)}\n`);
  return collected;
}

/** Merge duplicates: the same doctor appears under every specialty they list. */
export function mergeIndex(all: IndexEntry[]): IndexEntry[] {
  const byId = new Map<string, IndexEntry>();

  for (const e of all) {
    const existing = byId.get(e.doctoraliaId);
    if (!existing) {
      byId.set(e.doctoraliaId, { ...e });
      continue;
    }
    existing.foundUnderSlugs = [...new Set([...existing.foundUnderSlugs, ...e.foundUnderSlugs])];
    existing.specializationNames = [...new Set([...existing.specializationNames, ...e.specializationNames])];
    existing.cities = [...new Set([...existing.cities, ...e.cities])];
    existing.isPromoted ||= e.isPromoted;
    existing.ratingFromListing ??= e.ratingFromListing;
    existing.reviewCountFromListing ??= e.reviewCountFromListing;
  }

  return [...byId.values()];
}
