import * as cheerio from 'cheerio';
import { extractEmails } from './parse-email';
import { extractMedia, normalizeImage, type Media } from './parse-media';
import { mapSpecialties } from './specialties';
import type {
  Currency,
  DoctoraliaAddress,
  DoctoraliaBooking,
  DoctoraliaProfile,
  DoctoraliaReview,
  DoctoraliaService,
  EntityType,
  IndexEntry,
} from './types';

const clean = (s: string | undefined | null): string | null => {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim().replace(/,$/, '').trim();
  return t.length ? t : null;
};

/** Run one extractor; a changed page layout must cost a field, never the whole profile. */
function safe<T>(fallback: T, fn: () => T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Vue islands carry their data as HTML-entity-encoded JSON props; cheerio decodes the entities. */
function jsonProp<T = any>($: cheerio.CheerioAPI, selector: string, attr: string): T | null {
  const raw = $(selector).first().attr(attr);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function jsonLd(html: string): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // Doctoralia emits one block per entity; a malformed one shouldn't kill the record.
    }
  }
  return out;
}

const httpsUrl = (raw: string | undefined | null): string | null => {
  const s = clean(raw);
  if (!s) return null;
  return s.startsWith('//') ? `https:${s}` : s;
};

/**
 * PHP DateTime serialised by Doctoralia: {date: "2026-10-14 19:00:00.000000",
 * timezone_type: 1, timezone: "+00:00"}. Returned as ISO-8601 UTC when the zone
 * is an offset; a named zone (type 3) is kept as local wall-clock time.
 */
function phpDate(d: any): string | null {
  const m = typeof d?.date === 'string' ? d.date.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/) : null;
  if (!m) return null;
  const tz = String(d.timezone ?? '');
  const offset = /^[+-]\d{2}:\d{2}$/.test(tz) ? tz : /^(UTC|Z|GMT)$/i.test(tz) ? 'Z' : null;
  if (!offset) return `${m[1]}T${m[2]}`;
  const t = new Date(`${m[1]}T${m[2]}${offset}`);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

const earliest = (dates: (string | null | undefined)[]): string | null =>
  dates.filter((d): d is string => !!d).sort()[0] ?? null;

// ---------- phones ----------

/**
 * Every phone number on a doctor page lives in a per-address modal whose
 * data-id says what kind of number it is:
 *   address-<id>-<digits>-secretary-ai-phone  Doctoralia's 24/7 AI booking line
 *                                             (Tijuana: 664 9xx / 55 99xx; Juárez: 656 738)
 *   address-<id>-<digits>-<n>-phone           "Número de teléfono" — the practice's own
 *                                             number (diverse local prefixes, tracked as
 *                                             object_sub_type="phone_number")
 * "address-ask-<id>-…" is the same number repeated in the "ask a question" box.
 * The tel: link inside the modal has the human formatting ("664 907 0902").
 * US practices put a "+1…" number in the id: address-579889-+19159990834-3-phone.
 *
 * The suffix alone is not trustworthy: a few pages file one of Doctoralia's AI
 * booking numbers under a plain "-<n>-phone" modal (perfil/ricardo-chaparro-manriquez
 * shows 656 738 0961, which is laura-marmolejo's secretary-ai-phone). So a number
 * that is on a known AI pool, or that is a secretary-ai-phone anywhere on the same
 * page, is always Doctoralia's line — see isDoctoraliaLine().
 */
interface AddressPhones {
  ai: string | null;
  /** First practice number (kept as `phone`). */
  direct: string | null;
  /** Every distinct practice number, in page order. */
  directs: string[];
}

/**
 * Number blocks Doctoralia allocates its 24/7 AI booking lines from, as the
 * first six national digits (country code 52 stripped). Only blocks with
 * several distinct numbers that occur exclusively as `…-secretary-ai-phone`
 * ids across the 2,794 cached Juárez pages + 8 Tijuana samples (and never as a
 * practice number, except the two misfiled 656 738 numbers this guards against):
 *   656 738  Juárez         166 distinct AI numbers (245 modals)
 *   656 939  Juárez          11 distinct
 *   656 927  Juárez           4 distinct
 *   614 399  Chihuahua        5 distinct
 *   664 907  Tijuana          3 distinct (p_rich 664 907 0902)
 *   664 934  Tijuana          3 distinct
 *   55 9962 / 55 9963 / 55 9990 / 55 9549   CDMX-format lines used nationally
 *                             (p_online 55 9963 2113), 2–3 distinct each
 * Neighbouring blocks are real practices (e.g. 656 737 has 4 practice numbers),
 * so match whole six-digit blocks only; singletons are left to the same-page rule.
 */
export const DOCTORALIA_AI_POOLS = ['656738', '656939', '656927', '614399', '664907', '664934', '559962', '559963', '559990', '559549'];

/** National digits: "+52 656 738 0961" → "6567380961"; foreign numbers keep their country code. */
const phoneDigits = (s: string) => s.replace(/\D/g, '').replace(/^52(?=\d{10}$)/, '');

const onAiPool = (number: string) => {
  const d = phoneDigits(number);
  return d.length === 10 && DOCTORALIA_AI_POOLS.some((p) => d.startsWith(p));
};

function phonesByAddress($: cheerio.CheerioAPI): Map<string, AddressPhones> {
  const rows: { address: string; number: string; ai: boolean }[] = [];
  $('[data-id$="-phone"]').each((_i, el) => {
    const id = $(el).attr('data-id') ?? '';
    const m = id.match(/^address-(?:ask-)?(\d+)-(\+?\d{7,15})-(secretary-ai|\d+)-phone$/);
    if (!m) return;
    const tel = $(el).find('a[href^="tel:"]').first().attr('href');
    const number = (tel && clean(decodeURIComponent(tel.replace(/^tel:/, '')))) || m[2];
    rows.push({ address: m[1], number, ai: m[3] === 'secretary-ai' });
  });

  // Every AI line on the page, whichever address it belongs to.
  const aiOnPage = new Set(rows.filter((r) => r.ai).map((r) => phoneDigits(r.number)));
  const isDoctoraliaLine = (r: (typeof rows)[number]) => r.ai || aiOnPage.has(phoneDigits(r.number)) || onAiPool(r.number);

  const out = new Map<string, AddressPhones>();
  for (const r of rows) {
    const slot = out.get(r.address) ?? { ai: null, direct: null, directs: [] };
    if (isDoctoraliaLine(r)) slot.ai ??= r.number;
    else if (!slot.directs.some((d) => phoneDigits(d) === phoneDigits(r.number))) slot.directs.push(r.number);
    slot.direct = slot.directs[0] ?? null;
    out.set(r.address, slot);
  }
  return out;
}

/** Older markup without a classifiable modal: the first tel: link in the card, as before. */
function cardTelFallback($card: cheerio.Cheerio<any>): string | null {
  const tel = $card.find('a[href^="tel:"]').first().attr('href');
  if (tel) return clean(decodeURIComponent(tel.replace(/^tel:/, '')));
  const target = $card.find('[data-id="show-phone-number-modal"]').attr('data-target') ?? '';
  const m = target.match(/address-\d+-(\d{10,13})-secretary-ai-phone/);
  return m ? m[1] : null;
}

// ---------- insurances / payments ----------

/**
 * The insurer lists also carry Doctoralia's "who is accepted" options — "Pacientes
 * privados (sin aseguradora)", "Pacientes con aseguradora médica y pacientes
 * privados (sin aseguradora)" — which are not insurers. Matched loosely because
 * the wording varies.
 */
const isInsurer = (name: string) => !/pacientes privados|sin aseguradora/i.test(name);

/**
 * The per-address modals ("Compañías aseguradoras aceptadas", "Métodos de pago").
 * Insurers render as <h5> rows; payment methods as bare <span> rows separated by <hr>
 * (older markup used <li>).
 */
function modalItems($: cheerio.CheerioAPI, modalId: string): string[] {
  const read = (sel: string) =>
    $(`[data-id="${modalId}"] .modal-body ${sel}`)
      .map((_i, el) => clean($(el).text()) ?? '')
      .get()
      .filter(Boolean);
  for (const sel of ['h5', 'li', 'span']) {
    const items = read(sel);
    if (items.length) return [...new Set(items)];
  }
  return [];
}

/**
 * Payment methods: the card shows up to three inline as
 * <li data-test-id="address-payment-method">; the "Métodos de pago" modal
 * (only rendered when there are more) has the full list.
 */
function paymentMethods($: cheerio.CheerioAPI, $card: cheerio.Cheerio<any>, addressId: string | null): string[] {
  const inline = $card
    .find('[data-test-id="address-payment-method"]')
    .map((_i, el) => clean($(el).text()) ?? '')
    .get()
    .filter(Boolean);
  const modal = addressId ? modalItems($, `address-${addressId}-payments`) : [];
  return [...new Set([...modal, ...inline])];
}

/**
 * Insurers are also serialised as a JSON prop on the Vue island, which is the
 * complete list rather than the truncated "+1 ver más" display list.
 */
function insurancesFromVueProps($: cheerio.CheerioAPI): string[] {
  const names = new Set<string>();
  $('insurances-list, insurance-checker-button').each((_i, el) => {
    for (const attr of [':all-bookable-insurances', ':doctors-insurances', ':displayed-insurances']) {
      const raw = $(el).attr(attr);
      if (!raw) continue;
      try {
        for (const item of JSON.parse(raw) as any[]) {
          const name = clean(item?.name ?? item?.insurance?.name);
          if (name) names.add(name);
        }
      } catch {
        // prop shape changed — skip rather than lose the whole profile
      }
    }
  });
  return [...names];
}

// ---------- services ----------

/** Only the provider's own text can make a price dollars; magnitude is not evidence. */
const USD_TEXT = /\b(d[oó]lar(es)?|usd|dlls?|dls)\b|\bus\s?\$|\bu\.\s?s\.\s?d/i;

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** Rebuild the card's display string ("Desde $1,800") for services the card doesn't show. */
function priceText(min: number | null, max: number | null, isFrom: boolean): string | null {
  if (min == null) return null;
  // The card prints a 0 floor as "Desde $0" (perfil/carlos-fdo-peraldi-rios); only a plain 0 is free.
  if (isFrom) return `Desde ${money(min)}`;
  if (min === 0 && !max) return 'Servicio gratuito';
  if (max != null && max > min) return `${money(min)} - ${money(max)}`;
  return money(min);
}

const ONLINE_NAME = /en l[ií]nea|videollamada|video ?consulta|telemedicina|online/i;

interface CardService {
  name: string;
  price: string | null;
  slug: string | null;
}

/** The visible address card lists at most five services; kept for slugs and as the fallback. */
function cardServices($: cheerio.CheerioAPI, $card: cheerio.Cheerio<any>): CardService[] {
  const out: CardService[] = [];
  $card.find('[data-test-id="address-service-item"]').each((_i, s) => {
    const $s = $(s);
    const name = clean($s.find('a').first().text());
    if (!name) return;
    out.push({
      name,
      price: clean($s.find('[data-id="service-price"]').text())?.replace(/^[••]\s*/, '') ?? null,
      // /tratamientos-servicios/<slug>/<city> — stable identity for the treatment
      slug: $s.find('a[href*="/tratamientos-servicios/"]').first().attr('href')?.split('/')[2] ?? null,
    });
  });
  return out;
}

interface JsonAddressServices {
  isOnlineOnly: boolean;
  services: DoctoraliaService[];
}

/**
 * The complete service list is the `:services` prop of <doctor-services>:
 * one item per treatment, each linked to the addresses that offer it with an
 * address-specific price and its bookable "serviceOptions" (description,
 * isBookable, earliestBookableDate). Grouped here by address id.
 */
function servicesFromJson($: cheerio.CheerioAPI): Map<string, JsonAddressServices> | null {
  const items = jsonProp<any[]>($, 'doctor-services', ':services');
  if (!Array.isArray(items)) return null;
  const byAddress = new Map<string, JsonAddressServices>();

  for (const item of items) {
    const name = clean(item?.name);
    if (!name) continue;
    for (const a of Array.isArray(item?.addresses) ? item.addresses : []) {
      if (a?.id == null) continue;
      const id = String(a.id);
      const options: any[] = Array.isArray(a.serviceOptions) ? a.serviceOptions : [];
      const num = (v: any) => (typeof v === 'number' ? v : null);
      // Price comes only from this address's entry. The item-level priceMin/priceMax
      // is a roll-up across ALL the doctor's addresses (and is 0 for unpriced
      // surgeries), so falling back to it gave unpriced addresses another
      // address's "Desde $5,400" or a bogus "Servicio gratuito".
      const priceMin = num(a.priceMin);
      const priceMax = priceMin == null ? null : num(a.priceMax) ?? priceMin;
      const isPriceFrom = priceMin != null && !!a.isPriceMin;
      const description =
        [...new Set(options.map((o) => clean(o?.description)).filter((d): d is string => !!d))].join(' / ') || null;
      const currencyText = [description, name, ...options.map((o) => o?.name)].filter(Boolean).join(' ');
      const currency: Currency | null = priceMin == null ? null : USD_TEXT.test(currencyText) ? 'USD' : 'MXN';

      const slot = byAddress.get(id) ?? { isOnlineOnly: !!a.isOnlineOnly, services: [] };
      slot.isOnlineOnly ||= !!a.isOnlineOnly;
      slot.services.push({
        name,
        price: priceText(priceMin, priceMax, isPriceFrom),
        slug: null,
        itemServiceId: num(item.itemServiceId),
        priceMin,
        priceMax,
        isPriceFrom,
        currency,
        description,
        isBookable: options.length ? options.some((o) => !!o?.isBookable) : null,
        earliestBookableDate: earliest(options.map((o) => phpDate(o?.earliestBookableDate))),
        // 4323 is Doctoralia's catalogue id for "Consulta en línea".
        isOnline: !!a.isOnlineOnly || item.itemServiceId === 4323 || ONLINE_NAME.test(name),
      });
      byAddress.set(id, slot);
    }
  }
  return byAddress;
}

/**
 * JSON is the source of truth; the card adds the treatment slug and its exact
 * display price. Card services the JSON somehow lacks are appended so nothing
 * the old card-only parser found is lost.
 */
function mergeServices(json: DoctoraliaService[] | undefined, cards: CardService[], isOnlineOnly: boolean): DoctoraliaService[] {
  // A service with several bookable options gets one card row per option, all with
  // the same name ("Primera visita …  $900" / "… $1,000"), so group rows by name.
  const byName = new Map<string, CardService[]>();
  for (const c of cards) byName.set(fold(c.name), [...(byName.get(fold(c.name)) ?? []), c]);

  /** Price fields from this address's card rows, for services the JSON has no price for. */
  const cardPrice = (rows: CardService[]) => {
    const parsed = rows.map((r) => parseCardPrice(r.price)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!parsed.length) return { price: null, priceMin: null, priceMax: null, isPriceFrom: false, currency: null };
    const priceMin = Math.min(...parsed.map((x) => x.min));
    const priceMax = Math.max(...parsed.map((x) => x.max));
    const isPriceFrom = parsed.some((x) => x.isFrom);
    return {
      // Rebuilt rather than copied so it always agrees with the numbers (several option rows → a range).
      price: priceText(priceMin, priceMax, isPriceFrom),
      priceMin,
      priceMax,
      isPriceFrom,
      currency: (rows.some((r) => USD_TEXT.test(r.price ?? '')) ? 'USD' : 'MXN') as Currency,
    };
  };

  const fromCard = (rows: CardService[]): DoctoraliaService => ({
    name: rows[0].name,
    slug: rows.find((r) => r.slug)?.slug ?? null,
    itemServiceId: null,
    ...cardPrice(rows),
    description: null,
    isBookable: null,
    earliestBookableDate: null,
    isOnline: isOnlineOnly || ONLINE_NAME.test(rows[0].name),
  });
  if (!json?.length) return [...byName.values()].map(fromCard);

  const used = new Set<string>();
  const out = json.map((s) => {
    const rows = byName.get(fold(s.name));
    if (!rows) return s;
    used.add(fold(s.name));
    // The card's spelling wins: the JSON sometimes carries the doctor's own lower-cased label.
    const merged = { ...s, name: rows[0].name, slug: rows.find((r) => r.slug)?.slug ?? null };
    // The JSON's address-level price is authoritative (the display string is rebuilt
    // from it, so it always agrees with priceMin/priceMax/isPriceFrom); the card only
    // fills in when the JSON has no price for this address.
    return s.priceMin != null ? merged : { ...merged, ...cardPrice(rows) };
  });
  for (const [key, rows] of byName) if (!used.has(key)) out.push(fromCard(rows));
  return out;
}

/** The card's display price: "$1,500", "Desde $800", "$900 - $1,000", "Servicio gratuito". */
function parseCardPrice(text: string | null): { min: number; max: number; isFrom: boolean } | null {
  if (!text) return null;
  if (/gratuito|gratis/i.test(text)) return { min: 0, max: 0, isFrom: false };
  const nums = [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, ''))).filter((n) => !Number.isNaN(n));
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums), isFrom: /desde/i.test(text) };
}

// ---------- booking ----------

/** <booking-widget :addresses-extra-data> — per-address calendar state. */
function bookingExtra($: cheerio.CheerioAPI): Map<string, any> {
  const out = new Map<string, any>();
  const arr = jsonProp<any[]>($, 'booking-widget', ':addresses-extra-data');
  if (Array.isArray(arr)) for (const a of arr) if (a?.id != null) out.set(String(a.id), a);
  return out;
}

function addressBooking(extra: any, services: DoctoraliaService[]): DoctoraliaBooking | null {
  const earliestDate = earliest(services.map((s) => s.earliestBookableDate));
  if (!extra && !earliestDate) return null;
  const bool = (v: any) => (typeof v === 'boolean' ? v : null);
  return {
    hasActiveCalendar: bool(extra?.hasActiveCalendar),
    insuranceSupport: clean(extra?.insuranceSupport),
    hasOnlinePaymentsEnabled: bool(extra?.hasOnlinePaymentsEnabled),
    earliestBookableDate: earliestDate,
  };
}

function rollUpBooking(addresses: DoctoraliaAddress[]): DoctoraliaBooking | null {
  const b = addresses.map((a) => a.booking).filter((x): x is DoctoraliaBooking => !!x);
  if (!b.length) return null;
  const any = (k: 'hasActiveCalendar' | 'hasOnlinePaymentsEnabled') =>
    b.some((x) => x[k] === true) ? true : b.some((x) => x[k] === false) ? false : null;
  const supports = b.map((x) => x.insuranceSupport).filter((x): x is string => !!x);
  return {
    hasActiveCalendar: any('hasActiveCalendar'),
    // Any address taking insurance makes the provider insurance-capable.
    insuranceSupport: supports.find((s) => s !== 'private') ?? supports[0] ?? null,
    hasOnlinePaymentsEnabled: any('hasOnlinePaymentsEnabled'),
    earliestBookableDate: earliest(b.map((x) => x.earliestBookableDate)),
  };
}

// ---------- addresses ----------

/** Addresses flagged online-only anywhere on the page (booking buttons carry data-address-id). */
function onlineOnlyIds($: cheerio.CheerioAPI, extra: Map<string, any>, json: Map<string, JsonAddressServices> | null): Set<string> {
  const ids = new Set<string>();
  for (const [id, a] of extra) if (a?.isOnlineOnly === true) ids.add(id);
  if (json) for (const [id, a] of json) if (a.isOnlineOnly) ids.add(id);
  $('[data-address-id][data-address-is-online-only="true"]').each((_i, el) => {
    const id = $(el).attr('data-address-id');
    if (id) ids.add(id);
  });
  return ids;
}

function extractAddresses($: cheerio.CheerioAPI): DoctoraliaAddress[] {
  const addresses: DoctoraliaAddress[] = [];
  const phones = safe(new Map<string, AddressPhones>(), () => phonesByAddress($));
  const json = safe(null, () => servicesFromJson($));
  const extra = safe(new Map<string, any>(), () => bookingExtra($));
  const onlineIds = safe(new Set<string>(), () => onlineOnlyIds($, extra, json));

  $('[data-id="doctor-address-item"]').each((_, el) => {
    const $card = $(el);

    const mapHref = $card.find('a[href*="google.com/maps"]').first().attr('href') ?? '';
    const coords = mapHref.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);

    // The location header emits bare <span content="..."> nodes in a fixed order:
    // postal code, city (.city), province (.province), country code.
    const $loc = $card.find('.profile-address-card__location').first();
    const postalCode = clean($loc.find('span[content]').not('.city').not('.province').first().attr('content'));
    const countryCode = clean(
      $loc
        .find('span[content]')
        .filter((_i, s) => /^[A-Z]{2}$/.test($(s).attr('content') ?? ''))
        .first()
        .attr('content'),
    );

    const addressId =
      ($card.attr('data-tab-id') ?? $card.attr('id') ?? '').match(/address-(\d+)/)?.[1] ?? null;
    const clinicName = clean($card.find('[data-test-id="address-info-name"]').first().text());

    const isOnlineOnly =
      (addressId !== null && onlineIds.has(addressId)) ||
      $card.attr('data-address-is-online-only') === 'true' ||
      $card.find('[data-address-is-online-only="true"]').length > 0 ||
      /^consultas? en l[ií]nea$/i.test(clinicName ?? '');

    const services = safe([] as DoctoraliaService[], () =>
      mergeServices(addressId ? json?.get(addressId)?.services : undefined, cardServices($, $card), isOnlineOnly),
    );

    const p = addressId ? phones.get(addressId) : undefined;
    // No classifiable modal (older markup): keep the old behaviour — first tel: in the card,
    // labelled as Doctoralia's line since we can't tell it is the practice's own.
    const doctoraliaPhone = p ? p.ai : safe(null, () => cardTelFallback($card));

    addresses.push({
      addressId,
      insurances: addressId ? safe([] as string[], () => modalItems($, `address-${addressId}-insurances`).filter(isInsurer)) : [],
      paymentMethods: safe([] as string[], () => paymentMethods($, $card, addressId)),
      clinicName,
      street: clean($card.find('[data-test-id="address-info-street"]').first().text()),
      district: clean($card.find('[data-test-id="address-info-district"]').first().text()),
      postalCode,
      city: clean($loc.find('.city').first().attr('content')),
      province: clean($loc.find('.province').first().attr('content')),
      countryCode,
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[2]) : null,
      doctoraliaPhone,
      phone: p?.direct ?? null,
      phones: p?.directs ?? [],
      isOnlineOnly,
      services,
      booking: safe(null, () => addressBooking(addressId ? extra.get(addressId) : undefined, services)),
    });
  });

  return addresses;
}

function extractReviews(physician: Record<string, any> | undefined): DoctoraliaReview[] {
  const raw = physician?.review;
  if (!Array.isArray(raw)) return [];
  return raw.map((r: any) => ({
    author: clean(r?.author?.name) ?? null,
    rating: typeof r?.reviewRating?.ratingValue === 'number' ? r.reviewRating.ratingValue : null,
    publishedAt: clean(r?.datePublished) ?? null,
    body: clean(r?.reviewBody) ?? null,
  }));
}

const MONTHS: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

/** The review's <time> text: "18 de mayo de 2018" or "November 15, 2024" → "2018-05-18". */
function reviewDate(text: string | null): string | null {
  if (!text) return null;
  const t = fold(text);
  const m = t.match(/^(\d{1,2}) de ([a-z]+) de (\d{4})$/) ?? t.match(/^([a-z]+) (\d{1,2}),? (\d{4})$/);
  if (!m) return null;
  const [day, month, year] = /^\d/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]];
  const mm = MONTHS[month];
  if (!mm) return null;
  return `${year}-${String(mm).padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * The opinion cards rendered on the page, for profiles whose JSON-LD carries no
 * reviews (most low-volume Juárez doctors). Each is [data-test-id="opinion-block"]:
 * author in the <h4>, stars as data-score inside #rating-as-stars, the comment in
 * [data-test-id="opinion-comment"] and the date as <time> text. Only the first
 * page of opinions (≤10) is server-rendered.
 */
function extractVisibleReviews($: cheerio.CheerioAPI): DoctoraliaReview[] {
  const out: DoctoraliaReview[] = [];
  $('[data-test-id="opinion-block"]').each((_i, el) => {
    const $o = $(el);
    const score = Number($o.find('#rating-as-stars [data-score], .rating[data-score]').first().attr('data-score'));
    // <br> separates "Lo mejor:" / "Podría mejorar:"; read a copy so the page itself is untouched.
    const $body = $o.find('[data-test-id="opinion-comment"]').first().clone();
    $body.find('br').replaceWith(' ');
    out.push({
      author: clean($o.find('h4').first().text()),
      rating: score >= 1 && score <= 5 ? score : null,
      publishedAt: reviewDate(clean($o.find('time').first().text())),
      body: clean($body.text()),
    });
  });
  return out.filter((r) => r.body || r.rating != null);
}

/**
 * Clinic ("/clinicas/...") pages use a different layout from doctor profiles:
 * one #contact-section per location, a single free-text address line, and —
 * unlike doctor pages — a real, directly-dialable phone number sitting in
 * `data-phone-number` (the markup only masks it visually). Their service list
 * is loaded client-side (<facility-services-tab-list-app> has no props), so
 * clinic addresses carry no services.
 */
function extractFacilityAddresses($: cheerio.CheerioAPI): DoctoraliaAddress[] {
  const addresses: DoctoraliaAddress[] = [];

  $('#contact-section .tab-pane').each((i, el) => {
    const $pane = $(el);

    const mapHref = $pane.find('[data-test-id="contact-map-link"], a[href*="google.com/maps"]').first().attr('href') ?? '';
    const coords = mapHref.match(/query=(-?\d+\.\d+),(-?\d+\.\d+)/);

    // "Av. Paseo Triunfo de la República 3980, Ciudad Juarez 32310"
    const full = clean($pane.find('[data-test-id="contact-facility-address"]').first().text());
    const tail = full?.split(',').pop()?.trim() ?? '';
    const postal = tail.match(/\b(\d{5})\b/)?.[1] ?? null;
    const city = clean(tail.replace(/\b\d{5}\b/, '')) ?? null;
    const street = full && full.includes(',') ? clean(full.slice(0, full.lastIndexOf(','))) : full;

    const number = clean($pane.find('[data-phone-number]').first().attr('data-phone-number'));
    // Same guard as doctor pages: a number on a Doctoralia AI pool is never the clinic's own.
    const phone = number && !onAiPool(number) ? number : null;

    if (!full && !coords && !number) return;

    addresses.push({
      addressId: $pane.attr('id')?.replace('tab-address-', '') ?? String(i + 1),
      insurances: [],
      paymentMethods: [],
      clinicName: clean($pane.find('[data-test-id="contact-facility-name"]').first().text()),
      street,
      district: null,
      postalCode: postal,
      city,
      province: null,
      countryCode: 'MX',
      lat: coords ? Number(coords[1]) : null,
      lng: coords ? Number(coords[2]) : null,
      doctoraliaPhone: number && !phone ? number : null,
      phone,
      phones: phone ? [phone] : [],
      isOnlineOnly: false,
      services: [],
      booking: null,
    });
  });

  return addresses;
}

// ---------- about-details lists ----------

/**
 * The "Ver más" sections are <ul class="toggleable-list" id="…"> with the overflow
 * rows as <li class="hide"> — read them all. Doctors: #school (Formación),
 * #practice (Experiencia), #expertIn (Enfocado en), #disease, #language — most
 * inside [data-id="about-details-modal"]. Clinics: #languages, #equipments.
 */
function listItems($: cheerio.CheerioAPI, ulId: string): string[] {
  return [
    ...new Set(
      $(`ul[id="${ulId}"] > li`)
        .map((_i, el) => clean($(el).text()) ?? '')
        .get()
        .filter(Boolean),
    ),
  ];
}

function extractDiseases($: cheerio.CheerioAPI): { name: string; slug: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; slug: string | null }[] = [];
  $('ul[id="disease"] > li').each((_i, el) => {
    const $a = $(el).find('a[href^="/enfermedades/"]').first();
    const name = clean($a.length ? $a.text() : $(el).text());
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push({ name, slug: $a.attr('href')?.split('/')[2] ?? null });
  });
  return out;
}

function extractCertificates($: cheerio.CheerioAPI): { title: string | null; url: string }[] {
  const out: { title: string | null; url: string }[] = [];
  const seen = new Set<string>();
  $('[data-id="data-type-certificate"] a[rel="certificate"][href]').each((_i, el) => {
    const url = httpsUrl($(el).attr('href'));
    if (!url || seen.has(url)) return;
    seen.add(url);
    // alt is "Ampliar imagen: certificate 3" unless the doctor captioned it.
    const alt = clean($(el).find('img').attr('alt')?.replace(/^Ampliar imagen:\s*/i, ''));
    out.push({ title: alt && !/^certificate \d+$/i.test(alt) ? alt : null, url });
  });
  return out;
}

/** <experience-videos :videos="[{embedUrl, provider, title, …}]"> */
function extractVideos($: cheerio.CheerioAPI): string[] {
  const arr = jsonProp<any[]>($, 'experience-videos', ':videos');
  if (!Array.isArray(arr)) return [];
  return [...new Set(arr.map((v) => httpsUrl(v?.embedUrl)).filter((u): u is string => !!u))];
}

/** Schema.org Question blocks in the "Dudas solucionadas" tab. */
function extractQna($: cheerio.CheerioAPI): { question: string; answer: string | null }[] {
  const out: { question: string; answer: string | null }[] = [];
  $('[itemtype="http://schema.org/Question"]').each((_i, el) => {
    const question = clean($(el).find('[data-test-id="qna-question-body"]').first().text());
    if (!question) return;
    out.push({ question, answer: clean($(el).find('[data-test-id="qna-answer-body"]').first().text()) });
  });
  if (!out.length) {
    // Fallback: pair the bodies in document order.
    const q = $('[data-test-id="qna-question-body"]').map((_i, el) => clean($(el).text()) ?? '').get();
    const a = $('[data-test-id="qna-answer-body"]').map((_i, el) => clean($(el).text()) ?? '').get();
    q.forEach((question, i) => question && out.push({ question, answer: a[i] || null }));
  }
  return out;
}

/** "Lo más mencionado por los pacientes": <span class="badge" data-tag-key="dedication">Dedicación…</span>. */
function extractReviewTags($: cheerio.CheerioAPI): { text: string; key: string | null; count: number | null }[] {
  const out: { text: string; key: string | null; count: number | null }[] = [];
  $('[data-id="doctor-opinion-most-mentioned-tags"] li').each((_i, el) => {
    const $chip = $(el).find('[data-tag-key]').first();
    const raw = clean(($chip.length ? $chip : $(el)).text());
    if (!raw) return;
    // Not shown today; tolerate a "(12)" / "· 12" suffix if Doctoralia adds one.
    const m = raw.match(/^(.*?)\s*(?:\((\d+)\)|[·•]\s*(\d+))$/);
    out.push({
      text: m ? m[1] : raw,
      key: $chip.attr('data-tag-key') ?? null,
      count: m ? Number(m[2] ?? m[3]) : null,
    });
  });
  return out;
}

// ---------- photos & email ----------

/**
 * Every Doctoralia image comes in several sizes named by suffix
 * (`_small_square`, `_80_square`, `_220_square`, `_medium_square`, `_large`).
 * `_large` exists for avatars, legacy `doctoralia.com.mx/doctor|facility/` paths
 * and facility avatars alike (checked against S3), so store that one.
 */
function toLarge(url: string): string {
  return url.replace(/_(small_square|medium_square|\d+_square|medium|small|thumb)\.(jpe?g|png|webp)$/i, '_large.$2');
}

/** Same photo at another size → same key. */
const photoKey = (url: string) =>
  (url.split('/').pop() ?? url).replace(/_(large|small_square|medium_square|\d+_square|medium|small|thumb)\.[a-z]+$/i, '');

const AVATAR =
  /\/\/[^"'\s\\]+?\/(?:doctor|facility)\/avatar\/[^"'\s\\]+?\.(?:jpe?g|png|webp)|\/\/s3[^"'\s\\]*?\/doctoralia\.com\.mx\/(?:doctor|facility)\/[0-9a-f]{6}\/[0-9a-f]{32}_[a-z0-9_]+\.(?:jpe?g|png|webp)/i;

/**
 * The provider's own portrait or logo. Doctor pages put it in og:image; clinic
 * pages put Doctoralia's generic banner there instead, so fall back to the first
 * avatar-shaped URL in the markup (the clinic logo in the contact card).
 */
function extractProfilePhoto($: cheerio.CheerioAPI, html: string): string | null {
  const og = normalizeImage($('meta[property="og:image"]').attr('content'));
  if (og) return toLarge(og);
  const m = html.match(AVATAR);
  const url = m ? normalizeImage(m[0]) : null;
  return url ? toLarge(url) : null;
}

/** The wide banner some doctors upload above their profile. */
function extractCoverPhoto(html: string): string | null {
  const m = html.match(/\/\/[^"'\s\\]+?\/header_image\/[^"'\s\\]+?\.(?:jpe?g|png|webp)/i);
  return m ? normalizeImage(toLarge(m[0])) : null;
}

/** Images attached to the provider's own news posts (#news-section). */
function extractNewsPhotos(html: string): string[] {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/\/\/[^"'\s\\]+?\/(?:doctor|facility)\/news\/[^"'\s\\]+?\.(?:jpe?g|png|webp)/gi)) {
    const url = normalizeImage(toLarge(m[0]));
    if (url && !out.has(photoKey(url))) out.set(photoKey(url), url);
  }
  return [...out.values()];
}

type EmailSource = DoctoraliaProfile['emails'][number]['source'];

/**
 * Doctoralia publishes no contact email, but providers leak one in two ways:
 * an address typed into the website field (`href="http://citas@clinic.com"`),
 * or one written into their own text. Only their own content is searched —
 * the page chrome carries Doctoralia's support inboxes (parse-email drops those anyway).
 */
function extractOwnEmails(
  $: cheerio.CheerioAPI,
  parts: { about: string | null; addresses: DoctoraliaAddress[]; qna: { answer: string | null }[] },
): DoctoraliaProfile['emails'] {
  const out: DoctoraliaProfile['emails'] = [];
  const add = (text: string | null | undefined, source: EmailSource) => {
    if (!text) return;
    for (const email of extractEmails(text)) if (!out.some((o) => o.email === email)) out.push({ email, source });
  };
  $('a[data-avo-track="doctor-website-link"], a[data-avo-track="clinic-website-link"]').each((_i, el) => {
    const href = $(el).attr('href') ?? '';
    // Only the user-info form: "http://name@host" is an email, "https://host/path" is not.
    const m = href.match(/^(?:https?:\/\/)?(?:www\.)?([^/@\s]+@[^/@\s]+\.[a-z]{2,})\/?$/i);
    if (m) add(m[1], 'website-field');
  });
  add(parts.about, 'about');
  add(parts.addresses.flatMap((a) => a.services.map((s) => s.description ?? '')).join('\n'), 'services');
  add(parts.qna.map((q) => q.answer ?? '').join('\n'), 'qna');
  return out;
}

// ---------- profile ----------

export function parseProfile(html: string, entry: IndexEntry): DoctoraliaProfile {
  const $ = cheerio.load(html);
  const blocks = jsonLd(html);
  const physician = blocks.find((b) => b['@type'] === 'Physician' || b['@type'] === 'MedicalClinic');
  const media = safe<Media>({ galleryUrls: [], socials: {} }, () => extractMedia(html));

  // "No. de cédula: 14237073 11747004" — one or more licence numbers, space separated.
  const cedulaText = $('p:contains("No. de cédula")').first().text();
  const cedulas = [...(cedulaText.match(/\d{5,10}/g) ?? [])];

  const specializations = [
    ...new Set(
      [
        ...entry.specializationNames,
        ...$('[data-test-id="doctor-specializations"]').map((_, el) => clean($(el).text()) ?? '').get(),
      ]
        // The heading doubles as a "· Ver más" disclosure toggle; keep only the names.
        .flatMap((s) => s.split(/[··]/))
        .map((s) => clean(s) ?? '')
        .filter((s) => s.length > 0 && !/^ver (m[aá]s|menos)/i.test(s) && !/especializaciones$/i.test(s)),
    ),
  ];

  const doctorAddresses = safe([] as DoctoraliaAddress[], () => extractAddresses($));
  const addresses = doctorAddresses.length
    ? doctorAddresses
    : safe([] as DoctoraliaAddress[], () => extractFacilityAddresses($));
  // Clinic link kept verbatim (existing behaviour); a doctor's own link
  // (data-avo-track="doctor-website-link") comes normalised from parse-media,
  // which also drops Facebook-pages-posing-as-websites.
  const website =
    clean($('a[data-avo-track="clinic-website-link"]').first().attr('href')) ?? media.website ?? null;
  const insurances = [
    ...new Set([...insurancesFromVueProps($), ...addresses.flatMap((a) => a.insurances)]),
  ].filter(isInsurer);

  // Only the provider's own words. There is a meta description on every page,
  // but it is SEO boilerplate ("Ahorra tiempo agendando cita con…") — falling
  // back to it would report 100% coverage for a field that is often empty.
  const about = clean(
    $('[data-test-id="about-description"], [data-id="profile-about-text"], [data-test-id="profile-about"]')
      .first()
      .text(),
  );

  const imageUrl = safe(null as string | null, () => extractProfilePhoto($, html));
  const coverImageUrl = safe(null as string | null, () => extractCoverPhoto(html));

  const reviewCount = typeof physician?.aggregateRating?.reviewCount === 'number'
    ? physician.aggregateRating.reviewCount
    : entry.reviewCountFromListing ?? 0;
  const rawRating = typeof physician?.aggregateRating?.ratingValue === 'number'
    ? physician.aggregateRating.ratingValue
    : entry.ratingFromListing;
  // JSON-LD reviews when present; otherwise the opinion cards on the page.
  const reviews = safe([] as DoctoraliaReview[], () => {
    const ld = extractReviews(physician);
    return ld.length ? ld : extractVisibleReviews($);
  });
  // 0 stars is never a real rating (Doctoralia's scale is 1–5): listings print 0 for
  // "no reviews yet", and pages without an aggregateRating print
  // data-eec-stars-rating="0" even with reviews. Treat it as unknown and, when
  // the page shows scored reviews, use their average — derived from the
  // (at most 10) reviews visible on the page, not Doctoralia's own figure.
  const rating = safe(null as number | null, () => {
    if (typeof rawRating === 'number' && rawRating > 0) return rawRating;
    const scores = reviews.map((r) => r.rating).filter((x): x is number => typeof x === 'number' && x > 0);
    if (!scores.length) return null;
    return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
  });

  // Doctor pages: ul#language in the about-details modal; clinic pages: ul#languages.
  const languages = safe([] as string[], () => [...new Set([...listItems($, 'language'), ...listItems($, 'languages')])]);
  const education = safe([] as string[], () => listItems($, 'school'));
  const experience = safe([] as string[], () => listItems($, 'practice'));
  const expertIn = safe([] as string[], () => listItems($, 'expertIn'));
  const equipment = safe([] as string[], () => listItems($, 'equipments'));
  const diseases = safe([] as { name: string; slug: string | null }[], () => extractDiseases($));
  const certificates = safe([] as { title: string | null; url: string }[], () => extractCertificates($));
  const videos = safe([] as string[], () => extractVideos($));
  const qna = safe([] as { question: string; answer: string | null }[], () => extractQna($));
  const reviewTags = safe([] as { text: string; key: string | null; count: number | null }[], () => extractReviewTags($));
  const booking = safe(null, () => rollUpBooking(addresses));
  const emails = safe([] as DoctoraliaProfile['emails'], () => extractOwnEmails($, { about, addresses, qna }));

  // Every image that is the provider's own, largest size, de-duplicated:
  // portrait/logo, cover banner, gallery, certificates, news posts.
  const photos = safe([] as DoctoraliaProfile['photos'], () => {
    const out = new Map<string, DoctoraliaProfile['photos'][number]>();
    const push = (url: string | null | undefined, kind: DoctoraliaProfile['photos'][number]['kind']) => {
      const u = url ? normalizeImage(url.startsWith('//') ? `https:${url}` : url) : null;
      if (u && !out.has(photoKey(u))) out.set(photoKey(u), { url: u, kind });
    };
    push(imageUrl, 'profile');
    push(coverImageUrl, 'cover');
    for (const g of media.galleryUrls) push(g, 'gallery');
    for (const c of certificates) push(c.url, 'certificate');
    for (const n of extractNewsPhotos(html)) push(n, 'news');
    return [...out.values()];
  });

  // Video consultation: services at the online-only address (or explicitly "Consulta en línea").
  const onlineConsultation = safe(null as DoctoraliaProfile['onlineConsultation'], () => {
    if (!doctorAddresses.length) return null;
    const online = addresses.flatMap((a) => a.services.filter((s) => a.isOnlineOnly || s.isOnline));
    const available = online.length > 0 || addresses.some((a) => a.isOnlineOnly);
    const priced = online.filter((s) => s.priceMin != null).sort((x, y) => x.priceMin! - y.priceMin!);
    return { available, priceMin: priced[0]?.priceMin ?? null, currency: priced[0]?.currency ?? null };
  });

  const missing: string[] = [];
  if (!cedulas.length) missing.push('cedulas');
  if (!addresses.length) missing.push('addresses');
  if (!addresses.some((a) => a.lat !== null)) missing.push('coordinates');
  if (!addresses.some((a) => a.services.length)) missing.push('services');
  if (!insurances.length) missing.push('insurances');
  if (!addresses.some((a) => a.phone)) missing.push('phone');
  if (!website) missing.push('website');
  if (!rating) missing.push('rating');
  if (!about) missing.push('about');
  if (!addresses.some((a) => a.paymentMethods.length)) missing.push('paymentMethods');
  if (!languages.length) missing.push('languages');
  if (!education.length) missing.push('education');
  if (!experience.length) missing.push('experience');
  if (!expertIn.length) missing.push('expertIn');
  if (!diseases.length) missing.push('diseases');
  if (!certificates.length) missing.push('certificates');
  if (!videos.length) missing.push('videos');
  if (!Object.keys(media.socials).length) missing.push('socials');
  if (!media.galleryUrls.length) missing.push('gallery');
  if (!coverImageUrl) missing.push('coverImage');
  if (!emails.length) missing.push('email');
  if (!qna.length) missing.push('qna');
  if (!reviewTags.length) missing.push('reviewTags');
  if (!booking) missing.push('booking');
  if (!onlineConsultation?.available) missing.push('onlineConsultation');
  if (!doctorAddresses.length && !equipment.length) missing.push('equipment');

  return {
    doctoraliaId: entry.doctoraliaId,
    entityType: (entry.entityType ?? 'doctor') as EntityType,
    url: entry.url,
    slug: entry.url.split('/').pop() ?? '',
    name: clean(physician?.name) ?? entry.name,
    cedulas,
    specializations,
    foundUnderSlugs: entry.foundUnderSlugs,
    mappedSpecialties: mapSpecialties(entry.foundUnderSlugs),
    about,
    imageUrl,
    coverImageUrl,
    photos,
    emails,
    website,
    rating,
    reviewCount,
    reviews,
    insurances,
    addresses,
    // Doctoralia does publish spoken languages: the "Idiomas" list in a
    // doctor's about-details modal (ul#language) and on clinic pages
    // (ul#languages). Empty when the provider never filled it in — we never
    // default to Spanish, which would assert a fact nobody stated.
    languages,
    education,
    experience,
    expertIn,
    diseases,
    certificates,
    videos,
    socials: media.socials,
    gallery: media.galleryUrls,
    qna,
    reviewTags,
    booking,
    onlineConsultation,
    equipment,
    scrapedAt: new Date().toISOString(),
    missing,
  };
}
