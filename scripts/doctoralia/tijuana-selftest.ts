/**
 * Parser self-test for the Tijuana scrape. No network.
 *
 *   npx tsx scripts/doctoralia/tijuana-selftest.ts
 *
 * 1. Parses the 8 saved Tijuana profile pages and asserts concrete values read
 *    off their HTML (services from the <doctor-services> JSON, USD detection,
 *    phones by modal kind, payment methods, about-modal lists, …), then prints a
 *    per-field coverage table.
 * 2. Regression: re-parses ~30 cached Ciudad Juárez pages (.cache/<2-hex>/<sha1(url)>.gz)
 *    and checks that nothing the previous parser found (out/profiles.jsonl) went empty.
 * 3. Audit defects pinned on named cached Juárez pages: no cross-address price,
 *    multi-option ranges, AI numbers kept out of `phone`, all practice numbers,
 *    rating/reviews from the visible opinion cards, facebook /p/ links.
 *
 * Samples live outside the repo; point TIJUANA_SAMPLES at another copy if needed.
 * Exit code 1 on any failure.
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { parseProfile } from './parse';
import type { DoctoraliaProfile, IndexEntry } from './types';

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const SAMPLES =
  process.env.TIJUANA_SAMPLES ??
  'C:/Users/carlo/AppData/Local/Temp/claude/C--dev-dropdev-medora-marketplace/9a0980fe-adc8-437c-b07a-ae88a55bae85/scratchpad/recon/html';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failed++;
    console.error(`  FAIL ${name}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)?.slice(0, 300)}`}`);
  }
}

// ---------- 1. Tijuana samples ----------

const SAMPLE_PATHS: Record<string, string> = {
  p_rich: 'perfil/rosalva-jimenez-barriga',
  p_sparse: 'perfil/marco-antonio-soto-ledesma',
  p_clinic: 'clinicas/california-s-dental-clinic',
  p_clinic2: 'clinicas/dental-drei',
  p_multi: 'perfil/erik-andres-rodriguez-martin',
  p_tourist: 'perfil/luis-suarez',
  p_usd: 'perfil/ricardo-vega-montiel-4',
  p_online: 'perfil/alejandro-felix-martinez-caamano',
};

/** Listing pages print 0 stars / 0 reviews for an unreviewed provider — mirror that. */
function sampleEntry(key: string): IndexEntry {
  const url = `https://www.doctoralia.com.mx/${SAMPLE_PATHS[key]}`;
  return {
    doctoraliaId: key,
    entityType: url.includes('/clinicas/') ? 'facility' : 'doctor',
    name: key,
    url,
    foundUnderSlugs: [],
    specializationNames: [],
    ratingFromListing: 0,
    reviewCountFromListing: 0,
    cities: ['Tijuana'],
    isOnlineOnly: false,
    isPromoted: false,
    hasPhoto: false,
    hasCalendar: false,
  };
}

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const parsed: Record<string, DoctoraliaProfile> = {};
console.log(`\n# Tijuana samples (${SAMPLES})`);
for (const key of Object.keys(SAMPLE_PATHS)) {
  const file = path.join(SAMPLES, `${key}.html`);
  if (!fs.existsSync(file)) {
    check(`${key}: sample present`, false, file);
    continue;
  }
  try {
    parsed[key] = parseProfile(fs.readFileSync(file, 'utf-8'), sampleEntry(key));
  } catch (e) {
    check(`${key}: parses`, false, String(e));
  }
}

const addr = (key: string, id: string) => parsed[key]?.addresses.find((a) => a.addressId === id);
const allServices = (key: string) => parsed[key]?.addresses.flatMap((a) => a.services) ?? [];
const svc = (key: string, name: string) => allServices(key).find((s) => s.name === name);

if (Object.keys(parsed).length === 8) {
  // Fix 2 — the full JSON list, not the 5-per-card display.
  check('p_online: ≥80 services', allServices('p_online').length >= 80, allServices('p_online').length);
  check('p_online: 80 at REHABYGEN, 1 online', addr('p_online', '380811')?.services.length === 80 && addr('p_online', '380789')?.services.length === 1);
  check('p_rich: 25 services at 54177', addr('p_rich', '54177')?.services.length === 25, addr('p_rich', '54177')?.services.length);
  check('p_usd: 33 services', allServices('p_usd').length === 33, allServices('p_usd').length);
  check('p_multi: per-address counts 10/10/10/17', JSON.stringify(parsed.p_multi.addresses.map((a) => a.services.length)) === '[10,10,10,17]', parsed.p_multi.addresses.map((a) => a.services.length));
  check('p_rich: card slug kept', svc('p_rich', 'Primera visita Ginecología y Obstetricia')?.slug === 'primera-visita-ginecologia-y-obstetricia');
  check('p_rich: "Desde" price', svc('p_rich', 'Primera visita Ginecología y Obstetricia')?.price === 'Desde $1,800' && svc('p_rich', 'Primera visita Ginecología y Obstetricia')?.isPriceFrom === true);
  const desc = svc('p_online', 'Consulta en línea');
  check('p_online: option description + isBookable + date', desc?.description === 'Consulta telemática (a distancia) por videollamada.' && desc.isBookable === true && desc.earliestBookableDate === '2026-10-14T19:00:00.000Z', desc);
  // Our rebuilt display string must equal what the card prints, wherever both exist.
  const mismatches = Object.values(parsed)
    .flatMap((p) => p.addresses.flatMap((a) => a.services))
    .filter((s) => s.slug && s.priceMin != null)
    .filter((s) => {
      const rebuilt = s.isPriceFrom ? `Desde ${money(s.priceMin!)}` : money(s.priceMin!);
      return rebuilt !== s.price;
    });
  check('card price text == rebuilt JSON price text', mismatches.length === 0, mismatches.map((s) => [s.name, s.price, s.priceMin]));

  // Fix 3 — currency.
  check('p_usd: "Precio el dolares" → USD', svc('p_usd', 'Primera visita Cirugía Plástica')?.currency === 'USD', svc('p_usd', 'Primera visita Cirugía Plástica'));
  check('p_usd: "Precio en dolares" → USD', svc('p_usd', 'Visita Cirugía Plástica')?.currency === 'USD');
  check('p_usd: no text → MXN (Ritidectomía 13,500)', svc('p_usd', 'Ritidectomía')?.currency === 'MXN' && svc('p_usd', 'Ritidectomía')?.priceMin === 13500);
  check('p_usd: unpriced → currency null', svc('p_usd', 'Rinoplastia')?.currency === null);
  check('p_tourist: $60 with no text stays MXN', svc('p_tourist', 'Primera visita Cirugía Plástica')?.currency === 'MXN');
  check('no USD anywhere but p_usd', Object.entries(parsed).every(([k, p]) => k === 'p_usd' || !p.addresses.some((a) => a.services.some((s) => s.currency === 'USD'))));

  // Fix 1 — facility postal/city.
  for (const k of ['p_clinic', 'p_clinic2']) {
    const a = parsed[k].addresses[0];
    check(`${k}: postal 5 digits, city without digits`, /^\d{5}$/.test(a?.postalCode ?? '') && !!a?.city && !/\d/.test(a.city), [a?.postalCode, a?.city]);
  }
  check('p_clinic: 22010 / Tijuana', parsed.p_clinic.addresses[0].postalCode === '22010' && parsed.p_clinic.addresses[0].city === 'Tijuana');

  // Fix 4 — payment methods.
  check('p_online 380789: modal <span> rows (incl. Paypal)', addr('p_online', '380789')?.paymentMethods.includes('Paypal') === true, addr('p_online', '380789')?.paymentMethods);
  check('p_online 380811: inline + modal (Efectivo, Paypal)', ['Efectivo', 'Paypal'].every((m) => addr('p_online', '380811')?.paymentMethods.includes(m)), addr('p_online', '380811')?.paymentMethods);
  check('p_usd: 4 inline payment methods', addr('p_usd', '658240')?.paymentMethods.length === 4, addr('p_usd', '658240')?.paymentMethods);
  check('p_tourist 496682: 5 payment methods', addr('p_tourist', '496682')?.paymentMethods.length === 5, addr('p_tourist', '496682')?.paymentMethods);
  check('p_rich 349278: payment methods', (addr('p_rich', '349278')?.paymentMethods.length ?? 0) === 3);

  // Fix 5 — online-only.
  check('p_rich 349278 online-only', addr('p_rich', '349278')?.isOnlineOnly === true);
  check('p_tourist 689320 online-only', addr('p_tourist', '689320')?.isOnlineOnly === true);
  check('p_online 380789 online-only, 380811 not', addr('p_online', '380789')?.isOnlineOnly === true && addr('p_online', '380811')?.isOnlineOnly === false);

  // Fix 6 — website.
  check('p_sparse website (doctor link)', parsed.p_sparse.website === 'http://www.drmarcosoto.com', parsed.p_sparse.website);
  check('p_usd website', parsed.p_usd.website === 'http://ricardovega.com', parsed.p_usd.website);
  check('p_clinic website (clinic link)', parsed.p_clinic.website === 'http://californiasdentalclinic.com');

  // Fix 7 — rating.
  check('p_multi: no reviews → rating null', parsed.p_multi.rating === null && parsed.p_multi.reviewCount === 0);
  check('p_clinic2: no reviews → rating null', parsed.p_clinic2.rating === null);
  check('p_rich: rating 5 / 1317', parsed.p_rich.rating === 5 && parsed.p_rich.reviewCount === 1317);

  // Fix 8 — phones by modal kind.
  check('p_rich 54177: AI line → doctoraliaPhone', addr('p_rich', '54177')?.doctoraliaPhone === '664 907 0902' && addr('p_rich', '54177')?.phone === null);
  check('p_rich 349278: "-2-phone" → phone', addr('p_rich', '349278')?.phone === '664 634 7465' && addr('p_rich', '349278')?.doctoraliaPhone === null);
  check('p_sparse 32545: "-3-phone" → phone', addr('p_sparse', '32545')?.phone === '664 200 0894');
  check('p_online: 55 99xx AI line', addr('p_online', '380811')?.doctoraliaPhone === '55 9963 2113');
  check('p_clinic: data-phone-number', parsed.p_clinic.addresses[0].phone === '+526643192992');

  // Fix 9 + new lists.
  check('p_rich languages include Español/Inglés', ['Español', 'Inglés'].every((l) => parsed.p_rich.languages.includes(l)), parsed.p_rich.languages);
  check('p_clinic languages (ul#languages)', JSON.stringify(parsed.p_clinic.languages) === '["Español","Inglés"]', parsed.p_clinic.languages);
  check('p_multi languages empty (not defaulted)', parsed.p_multi.languages.length === 0);
  check('p_rich education non-empty', parsed.p_rich.education.length > 0, parsed.p_rich.education);
  check('p_online education incl. hidden rows (41)', parsed.p_online.education.length === 41, parsed.p_online.education.length);
  check('p_online experience 14', parsed.p_online.experience.length === 14, parsed.p_online.experience.length);
  check('p_online expertIn 8', parsed.p_online.expertIn.length === 8, parsed.p_online.expertIn.length);
  check('p_online diseases ≥130, linked ones carry slug', parsed.p_online.diseases.length >= 130 && parsed.p_online.diseases.some((d) => d.slug === 'codo-de-tenista'), parsed.p_online.diseases.length);
  check('p_rich diseases 12', parsed.p_rich.diseases.length === 12, parsed.p_rich.diseases.length);
  check('p_online certificates 78 (https)', parsed.p_online.certificates.length === 78 && parsed.p_online.certificates.every((c) => c.url.startsWith('https://')), parsed.p_online.certificates.length);
  check('p_usd certificates 1', parsed.p_usd.certificates.length === 1);
  check('p_online videos are embeds', parsed.p_online.videos.length === 6 && parsed.p_online.videos[0] === 'https://www.youtube.com/embed/O6wcF-m-foA', parsed.p_online.videos);
  check('p_rich socials from "Redes sociales"', parsed.p_rich.socials.facebook === 'https://www.facebook.com/drarosalvajimenez' && parsed.p_rich.socials.instagram === 'https://www.instagram.com/drarosalvajimenez', parsed.p_rich.socials);
  check('p_clinic socials + gallery', !!parsed.p_clinic.socials.facebook && parsed.p_clinic.gallery.length === 15);
  check('p_rich qna 2 with answers', parsed.p_rich.qna.length === 2 && parsed.p_rich.qna.every((q) => q.answer), parsed.p_rich.qna.length);
  check('p_rich reviewTags (3, keyed)', parsed.p_rich.reviewTags.length === 3 && parsed.p_rich.reviewTags[0].key === 'detailed_explanations', parsed.p_rich.reviewTags);
  check('p_clinic equipment 3', parsed.p_clinic.equipment.length === 3, parsed.p_clinic.equipment);

  // Booking / online consultation.
  check('p_online booking: insurance + online payments', parsed.p_online.booking?.insuranceSupport === 'private_and_insurance' && parsed.p_online.booking.hasOnlinePaymentsEnabled === true);
  check('p_sparse booking: no active calendar', addr('p_sparse', '32545')?.booking?.hasActiveCalendar === false);
  check('p_clinic booking null', parsed.p_clinic.booking === null && parsed.p_clinic.onlineConsultation === null);
  check('p_online onlineConsultation 1500 MXN', JSON.stringify(parsed.p_online.onlineConsultation) === '{"available":true,"priceMin":1500,"currency":"MXN"}', parsed.p_online.onlineConsultation);
  check('p_rich onlineConsultation 1700', parsed.p_rich.onlineConsultation?.priceMin === 1700);
  check('p_usd no onlineConsultation', parsed.p_usd.onlineConsultation?.available === false);

  // Audit defect 1 — price comes only from the address's own entry, never another address's.
  const unpriced = (s: DoctoraliaProfile['addresses'][number]['services'][number] | undefined) =>
    !!s && s.price === null && s.priceMin === null && s.priceMax === null && s.isPriceFrom === false && s.currency === null;
  const at = (key: string, id: string, name: string) => addr(key, id)?.services.find((s) => s.name === name);
  for (const id of ['617075', '616814', '616890']) {
    check(`p_multi ${id}: toxina botulínica unpriced (only 630321 has a price)`, unpriced(at('p_multi', id, 'Aplicación de toxina botulínica con fines estéticos')), at('p_multi', id, 'Aplicación de toxina botulínica con fines estéticos'));
  }
  check('p_multi 630321: toxina botulínica $5,400 (as its card prints it)', at('p_multi', '630321', 'Aplicación de toxina botulínica con fines estéticos')?.price === '$5,400' && at('p_multi', '630321', 'Aplicación de toxina botulínica con fines estéticos')?.priceMin === 5400);
  check('p_multi 616890: Visita / Consulta de valoración unpriced', unpriced(at('p_multi', '616890', 'Visita Cirugía Plástica')) && unpriced(at('p_multi', '616890', 'Consulta de valoración')));
  check('p_tourist 496682: Consulta en línea unpriced', unpriced(at('p_tourist', '496682', 'Consulta en línea')), at('p_tourist', '496682', 'Consulta en línea'));
  check('p_tourist 689319: Consulta de valoración unpriced', unpriced(at('p_tourist', '689319', 'Consulta de valoración')), at('p_tourist', '689319', 'Consulta de valoración'));
  check('p_tourist 689320: Consulta en línea keeps its own $25', at('p_tourist', '689320', 'Consulta en línea')?.priceMin === 25);

  // Audit defect 8 — "pacientes privados" options are not insurers.
  check('no "pacientes privados / sin aseguradora" insurer', Object.values(parsed).every((p) => [...p.insurances, ...p.addresses.flatMap((a) => a.insurances)].every((n) => !/pacientes privados|sin aseguradora/i.test(n))));
}

/** Audit defect 2 — the display string always agrees with priceMin/priceMax/isPriceFrom. */
function priceInconsistencies(p: DoctoraliaProfile): string[] {
  const bad: string[] = [];
  for (const a of p.addresses)
    for (const s of a.services) {
      if (s.priceMin == null) {
        if (s.price !== null || s.isPriceFrom || s.currency != null) bad.push(`${a.addressId} ${s.name}: ${s.price} without priceMin`);
        continue;
      }
      const want = s.isPriceFrom
        ? `Desde ${money(s.priceMin)}`
        : s.priceMin === 0 && !s.priceMax
          ? 'Servicio gratuito'
          : s.priceMax != null && s.priceMax > s.priceMin
            ? `${money(s.priceMin)} - ${money(s.priceMax)}`
            : money(s.priceMin);
      if (s.price !== want) bad.push(`${a.addressId} ${s.name}: "${s.price}" vs ${s.priceMin}-${s.priceMax}${s.isPriceFrom ? ' desde' : ''}`);
    }
  return bad;
}
for (const [k, p] of Object.entries(parsed)) {
  const bad = priceInconsistencies(p);
  check(`${k}: price string consistent with priceMin/priceMax/isPriceFrom`, bad.length === 0, bad);
}

// Malformed JSON props must not throw.
try {
  const html = fs.readFileSync(path.join(SAMPLES, 'p_online.html'), 'utf-8');
  const broken = html
    .replace(/:services="\[/, ':services="[{oops')
    .replace(/:addresses-extra-data="\[/, ':addresses-extra-data="nope[')
    .replace(/:videos="\[/, ':videos="{');
  const p = parseProfile(broken, sampleEntry('p_online'));
  check('malformed JSON props: no throw, card fallback (5 services)', addr('p_online', '380811') !== undefined && p.addresses[0].services.length === 5 && p.videos.length === 0, p.addresses[0]?.services.length);
  const empty = parseProfile('<html></html>', sampleEntry('p_rich'));
  check('empty page: no throw', empty.addresses.length === 0 && empty.languages.length === 0);
} catch (e) {
  check('malformed JSON props: no throw', false, String(e));
}

// Per-field coverage table.
const nonEmpty = (v: unknown): boolean =>
  v == null ? false : Array.isArray(v) ? v.length > 0 : typeof v === 'object' ? Object.keys(v as object).length > 0 : v !== '' && v !== false;
const fields: [string, (p: DoctoraliaProfile) => unknown][] = [
  ['rating', (p) => p.rating],
  ['website', (p) => p.website],
  ['services', (p) => p.addresses.reduce((n, a) => n + a.services.length, 0) || null],
  ['USD services', (p) => p.addresses.reduce((n, a) => n + a.services.filter((s) => s.currency === 'USD').length, 0) || null],
  ['postal', (p) => p.addresses.find((a) => a.postalCode)?.postalCode],
  ['phone', (p) => p.addresses.find((a) => a.phone)?.phone],
  ['doctoraliaPhone', (p) => p.addresses.find((a) => a.doctoraliaPhone)?.doctoraliaPhone],
  ['onlineOnly addr', (p) => p.addresses.filter((a) => a.isOnlineOnly).length || null],
  ['paymentMethods', (p) => [...new Set(p.addresses.flatMap((a) => a.paymentMethods))].length || null],
  ['languages', (p) => p.languages.length || null],
  ['education', (p) => p.education.length || null],
  ['experience', (p) => p.experience.length || null],
  ['expertIn', (p) => p.expertIn.length || null],
  ['diseases', (p) => p.diseases.length || null],
  ['certificates', (p) => p.certificates.length || null],
  ['videos', (p) => p.videos.length || null],
  ['socials', (p) => Object.keys(p.socials).length || null],
  ['gallery', (p) => p.gallery.length || null],
  ['qna', (p) => p.qna.length || null],
  ['reviewTags', (p) => p.reviewTags.length || null],
  ['booking', (p) => (p.booking ? (p.booking.hasActiveCalendar ? 'active' : 'inactive') : null)],
  ['onlineConsult', (p) => (p.onlineConsultation?.available ? p.onlineConsultation.priceMin ?? 'yes' : null)],
  ['equipment', (p) => p.equipment.length || null],
];
const keys = Object.keys(parsed);
const pad = (s: unknown, n: number) => String(s).slice(0, n).padEnd(n);
console.log(`\n${pad('field', 16)}${keys.map((k) => pad(k.replace('p_', ''), 13)).join('')}cover`);
for (const [label, get] of fields) {
  const vals = keys.map((k) => get(parsed[k]));
  console.log(`${pad(label, 16)}${vals.map((v) => pad(v ?? '—', 13)).join('')}${vals.filter(nonEmpty).length}/${keys.length}`);
}

// ---------- 2. Juárez regression ----------

const CACHE = path.join(HERE, '.cache');
const OUT = path.join(HERE, 'out');
const readJsonl = <T>(f: string): T[] =>
  fs.existsSync(f)
    ? fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T)
    : [];

function cached(url: string): string | null {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  const f = path.join(CACHE, h.slice(0, 2), `${h}.gz`);
  if (!fs.existsSync(f)) return null;
  try {
    return zlib.gunzipSync(fs.readFileSync(f)).toString('utf-8');
  } catch {
    return null;
  }
}

console.log('\n# Juárez regression (old parser output: out/profiles.jsonl)');
const old = readJsonl<any>(path.join(OUT, 'profiles.jsonl'));
// Same merge the scraper does: one entry per URL, slugs/specialisations unioned.
const index = new Map<string, IndexEntry>();
for (const e of readJsonl<IndexEntry>(path.join(OUT, 'index.jsonl'))) {
  const x = index.get(e.url);
  if (!x) index.set(e.url, { ...e, foundUnderSlugs: [...e.foundUnderSlugs], specializationNames: [...e.specializationNames] });
  else {
    x.foundUnderSlugs = [...new Set([...x.foundUnderSlugs, ...e.foundUnderSlugs])];
    x.specializationNames = [...new Set([...x.specializationNames, ...e.specializationNames])];
  }
}

// ~30 spread across the file: 10 clinics, 20 doctors, favouring ones with services / phones.
const facilities = old.filter((p) => p.entityType === 'facility');
const doctors = old.filter((p) => p.entityType === 'doctor');
const stride = <T>(arr: T[], n: number) => arr.filter((_x, i) => i % Math.max(1, Math.floor(arr.length / n)) === 0).slice(0, n);
const richDoctors = doctors.filter((p) => p.addresses.some((a: any) => a.services.length && a.doctoraliaPhone));
const picked = [...stride(facilities, 10), ...stride(richDoctors, 10), ...stride(doctors, 10)];

let compared = 0;
let movedPhones = 0;
const regressions: string[] = [];
for (const before of picked) {
  const html = cached(before.url);
  const entry = index.get(before.url);
  if (!html || !entry) continue;
  let after: DoctoraliaProfile;
  try {
    after = parseProfile(html, entry);
  } catch (e) {
    regressions.push(`${before.doctoraliaId}: threw ${String(e)}`);
    continue;
  }
  compared++;
  const lost = (field: string) => regressions.push(`${before.doctoraliaId} ${before.slug}: ${field} went empty`);

  for (const [k, v] of Object.entries(before)) {
    if (k === 'scrapedAt' || k === 'missing' || k === 'addresses') continue;
    if (!nonEmpty(v)) continue;
    // Fix 7: a listing "0" with no reviews is now null by design.
    if (k === 'rating' && v === 0 && !before.reviewCount) continue;
    // The old run defaulted every profile to ['es'] (since removed as fabricated, commit e7668e8).
    if (k === 'languages' && JSON.stringify(v) === '["es"]') continue;
    // Clinics without a logo used to get Doctoralia's own og.png banner as their photo.
    if (k === 'imageUrl' && /\/open-graph\/og\.png/.test(String(v))) continue;
    if (!nonEmpty((after as any)[k]) && !(k === 'rating' && after.rating === 0)) lost(k);
  }
  for (const a of before.addresses) {
    const b = after.addresses.find((x) => x.addressId === a.addressId);
    if (!b) {
      lost(`address ${a.addressId}`);
      continue;
    }
    for (const [k, v] of Object.entries(a)) {
      if (!nonEmpty(v) || k === 'services' || k === 'doctoraliaPhone') continue;
      if (!nonEmpty((b as any)[k])) lost(`address ${a.addressId}.${k}`);
    }
    // Fix 8: a practice number that the old parser filed as doctoraliaPhone may now be `phone`.
    if (a.doctoraliaPhone) {
      if (!b.doctoraliaPhone && !b.phone) lost(`address ${a.addressId}.doctoraliaPhone`);
      else if (!b.doctoraliaPhone && b.phone === a.doctoraliaPhone) movedPhones++;
    }
    const names = new Set(b.services.map((s) => s.name));
    const missingSvcs = a.services.filter((s: any) => !names.has(s.name));
    if (missingSvcs.length) lost(`address ${a.addressId}.services [${missingSvcs.map((s: any) => s.name).join(', ')}]`);
    for (const s of a.services) {
      const t = b.services.find((x) => x.name === s.name);
      if (t && ((s.price && !t.price) || (s.slug && !t.slug))) lost(`address ${a.addressId}.services[${s.name}] price/slug`);
    }
  }
}
check(`regression: ${compared} cached Juárez profiles re-parsed`, compared >= 25, compared);
check('regression: no field went empty', regressions.length === 0, regressions);
console.log(`  info practice numbers moved doctoraliaPhone → phone: ${movedPhones}`);

// ---------- 3. Audit defects on specific cached Juárez pages ----------

console.log('\n# Audit defects (cached Juárez pages)');
function juarez(slug: string): DoctoraliaProfile | null {
  const url = `https://www.doctoralia.com.mx/perfil/${slug}`;
  const html = cached(url);
  const entry = index.get(url);
  if (!html || !entry) {
    console.log(`  skip ${slug} (not in cache)`);
    return null;
  }
  return parseProfile(html, entry);
}
const jAddr = (p: DoctoraliaProfile | null, id: string) => p?.addresses.find((a) => a.addressId === id);

// 1 — no price borrowed from another address.
const weckmann = juarez('sergio-alberto-weckmann-lujan-2');
if (weckmann) {
  const gratis = jAddr(weckmann, '651960')?.services.filter((s) => s.price === 'Servicio gratuito') ?? [];
  check('weckmann 651960: no surgery is "Servicio gratuito"', gratis.length === 0, gratis.map((s) => s.name));
  check('weckmann 505236: its own 0 prices stay free', jAddr(weckmann, '505236')?.services.find((s) => s.name === 'Hemorroidectomia')?.price === 'Servicio gratuito');
}
const santos = juarez('edgar-ivan-santos-castro');
if (santos) {
  const s = jAddr(santos, '259744')?.services.filter((x) => /bypass|manga/i.test(x.name)) ?? [];
  check('santos-castro 259744: bypass/manga unpriced', s.length > 0 && s.every((x) => x.price === null && x.priceMin === null), s.map((x) => [x.name, x.price]));
}

// 2 — several option rows on the card: one consistent range, not the last row.
const padilla = juarez('ricardo-padilla-ballesteros');
if (padilla) {
  const s = jAddr(padilla, '12174')?.services.find((x) => x.name === 'Primera visita Angiología y Cirugia Vascular');
  check('padilla 12174: "$900 - $1,000" (900/1000, not "Desde")', s?.price === '$900 - $1,000' && s.priceMin === 900 && s.priceMax === 1000 && s.isPriceFrom === false, s);
  check('padilla: price strings consistent', priceInconsistencies(padilla).length === 0, priceInconsistencies(padilla));
}
const peraldi = juarez('carlos-fdo-peraldi-rios');
if (peraldi) {
  const s = jAddr(peraldi, '362934')?.services.find((x) => x.name === 'Ajuste de ortodoncia');
  check('peraldi 362934: 0 floor prints "Desde $0" like the card', s?.price === 'Desde $0' && s.isPriceFrom === true, s);
}

// 3, 6, 7 — phones.
const chaparro = juarez('ricardo-chaparro-manriquez');
if (chaparro) {
  const a = jAddr(chaparro, '499246');
  check('chaparro 499246: AI number 656 738 0961 is doctoraliaPhone, not phone', a?.phone === null && a?.doctoraliaPhone === '656 738 0961' && a.phones.length === 0, a && [a.phone, a.phones, a.doctoraliaPhone]);
}
const catalan = juarez('ricardo-alberto-catalan-carmona-2');
if (catalan) {
  const a = jAddr(catalan, '11380');
  check('catalan 11380: pool number 656 738 1939 not a practice phone', a?.phone === null && a?.doctoraliaPhone === '656 738 1939', a && [a.phone, a.doctoraliaPhone]);
}
const zuniga = juarez('armando-zuniga-dominguez');
if (zuniga) {
  const a = jAddr(zuniga, '499580');
  check('zuniga 499580: both practice numbers kept, phone = first', a?.phone === '656 554 4758' && JSON.stringify(a.phones) === '["656 554 4758","656 598 3699"]', a?.phones);
  check('zuniga: facebook /p/<slug> kept', zuniga.socials.facebook === 'https://www.facebook.com/p/DrArmando-zuñiga-100090845602098', zuniga.socials.facebook);
}
const acevedo = juarez('david-acevedo-villafana');
if (acevedo) check('acevedo 579889: +1 US number parsed', jAddr(acevedo, '579889')?.phones.some((n) => n.replace(/\D/g, '') === '19159990834') === true, jAddr(acevedo, '579889')?.phones);

// 4 — rating 0 with reviews → average of the visible review scores; reviews read off the cards.
const cruz = juarez('miguel-angel-cruz-suarez');
if (cruz) {
  check('cruz-suarez: rating 5 from visible reviews (was 0)', cruz.rating === 5 && cruz.reviewCount === 12, [cruz.rating, cruz.reviewCount]);
  const r = cruz.reviews[0];
  check('cruz-suarez: 10 visible reviews (author, 5★, date, body)', cruz.reviews.length === 10 && r?.author === 'Cuenta eliminada' && r.rating === 5 && r.publishedAt === '2018-05-18' && !!r.body?.startsWith('Lo mejor: Nos indico'), r);
}
if (padilla) check('padilla: JSON-LD reviews still preferred', padilla.reviews.length > 0 && /T\d{2}:/.test(padilla.reviews[0].publishedAt ?? ''), padilla.reviews[0]);

console.log(failed ? `\n${failed} failing` : '\nall passing');
process.exit(failed ? 1 : 0);
