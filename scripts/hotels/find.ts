/**
 * Finds hotels near the clinic clusters through Google Places and writes them
 * to public.hotels (migration 0054 + 0056). See docs/hotels.md.
 *
 *   npx tsx scripts/hotels/find.ts                 # dry run: prints the picks, writes nothing
 *   npx tsx scripts/hotels/find.ts --commit        # upserts the picks as live hotels
 *   npx tsx scripts/hotels/find.ts --city=tijuana  # one target (tijuana | juarez | sandiego | elpaso)
 *   npx tsx scripts/hotels/find.ts --per-city=12 --refetch
 *
 * How it chooses:
 *   1. Centres: the 5 densest 1-km cells of live Mexican listings in the city,
 *      read from our own providers table (scripts/hotels/pick.ts clusterCentres).
 *   2. Google Places text search "hotel" and nearby search, type=lodging, 3 km around each centre.
 *   3. Drops US-side results, motels and auto hotels, closed places, anything
 *      under 4.0 stars or 100 reviews (pick.ts rejectReason).
 *   4. Ranks by closeness to listings, then rating × log(reviews), with no more
 *      than half from one price level, and keeps --per-city (default 12).
 *   5. One Place Details call per pick confirms the country is MX and adds
 *      phone and website.
 *
 * US side (sandiego, elpaso): for patients who cross for the day instead of
 * sleeping in Mexico. The centres are the border crossings (src/utils/
 * borderCrossings.ts), hotels are ranked by distance to the nearest crossing
 * and described by it, and Place Details must say the country is US.
 *
 * Google's terms let us keep only the place ID indefinitely. Like providers,
 * the row also keeps name, address, coordinates and rating; photos are never
 * stored (they come through /api/place-photo). Re-running updates the same
 * rows by google_place_id and never touches hand-made hotels or amenities,
 * descriptions an admin edited, or a hotel an admin hid.
 *
 * Every run has a UUIDv7 run ID, stored on each row it writes
 * (source_run_id) and in the run file under scripts/hotels/.data/ (ignored).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { isUsAddress, usSideOfBorder } from '../doctoralia/sweep-targets';
import { uuidv7 } from '../sources/lib/snapshot';
import { crossingsOf } from '../../src/utils/borderCrossings';
import type { RegionId } from '../../src/utils/region';
import {
    bookingSearchUrl, clusterCentres, describe, describeCrossing, pick, priceBand, rejectReason, scoreNearCrossing,
    type Candidate, type Point, type Scored,
} from './pick';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const commit = flag('commit');
const refetch = flag('refetch');
const perCityOpt = opt('per-city');
const onlyCity = opt('city');

const CITIES = {
    tijuana: { region: 'sandiego-tijuana', city: 'Tijuana', country: 'MX' },
    juarez: { region: 'elpaso-juarez', city: 'Ciudad Juárez', country: 'MX' },
    sandiego: { region: 'sandiego-tijuana', city: 'San Diego', country: 'US' },
    elpaso: { region: 'elpaso-juarez', city: 'El Paso', country: 'US' },
} as const satisfies Record<string, { region: RegionId; city: string; country: 'MX' | 'US' }>;
type CityId = keyof typeof CITIES;

const SEARCH_RADIUS_M = 3000;
/** Around a border crossing: hotels a short drive from the line, not all of San Diego. */
const US_SEARCH_RADIUS_M = 6000;
/**
 * Google ranks by prominence and a search at the line itself fills up with
 * Tijuana or Juárez hotels (the first run kept 16 of 160 results). So the US
 * search is centred a few km into the US, away from the border; hotels are
 * still ranked by distance to the crossing, not to this centre.
 */
const US_SEARCH_OFFSET: Record<RegionId, { dLat: number; dLng: number }> = {
    'sandiego-tijuana': { dLat: 0.035, dLng: 0 },
    'elpaso-juarez': { dLat: 0.03, dLng: 0.015 },
}
const COST_PER_1K = { textSearch: 32, details: 20 };
const DATA_DIR = path.join('scripts', 'hotels', '.data');
const CACHE_DIR = path.join(DATA_DIR, 'cache');

function loadEnv(): Record<string, string> {
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
const GOOGLE_KEY = env.VITE_GOOGLE_MAPS_API_KEY;
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!GOOGLE_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    console.error('✖ VITE_GOOGLE_MAPS_API_KEY, VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (.env.local).');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const calls = { textSearch: 0, details: 0, cached: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The parts of Google's legacy Places responses this script reads. */
interface PlacesResult {
    place_id?: string; name?: string; formatted_address?: string; vicinity?: string;
    geometry?: { location?: { lat?: number; lng?: number } };
    rating?: number; user_ratings_total?: number; price_level?: number; business_status?: string; types?: string[];
}
interface PlaceDetails extends PlacesResult {
    international_phone_number?: string; website?: string;
    address_components?: { short_name?: string; types?: string[] }[];
}
interface PlacesResponse {
    status?: string; error_message?: string; next_page_token?: string;
    results?: PlacesResult[]; result?: PlaceDetails;
}

/** Cached by request, so a dry run and the --commit run after it pay once. The key never reaches the cache name. */
async function places(url: string, kind: 'textSearch' | 'details'): Promise<PlacesResponse> {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, crypto.createHash('sha1').update(url.replace(GOOGLE_KEY, 'KEY')).digest('hex') + '.json');
    if (!refetch && fs.existsSync(file)) {
        try { calls.cached++; return JSON.parse(fs.readFileSync(file, 'utf-8')) as PlacesResponse; } catch { /* refetch */ }
    }
    const json = (await (await fetch(url)).json()) as PlacesResponse;
    calls[kind]++;
    if (json.status === 'OVER_QUERY_LIMIT' || json.status === 'REQUEST_DENIED') {
        throw new Error(`Places API ${json.status}: ${json.error_message ?? 'no detail'}`);
    }
    fs.writeFileSync(file, JSON.stringify(json), 'utf-8');
    return json;
}

async function liveClinics(region: string): Promise<Point[]> {
    const out: Point[] = [];
    for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from('providers').select('lat,lng')
            .eq('status', 'live').eq('country', 'MX').eq('region', region)
            .not('lat', 'is', null).range(from, from + 999);
        if (error) throw error;
        out.push(...(data ?? []).map((r) => ({ lat: Number(r.lat), lng: Number(r.lng) })));
        if (!data || data.length < 1000) break;
    }
    return out;
}

/** Up to 3 pages (60 results) of one search. */
async function paged(endpoint: 'textsearch' | 'nearbysearch', params: string): Promise<PlacesResult[]> {
    const results: PlacesResult[] = [];
    let token: string | undefined;
    for (let page = 0; page < 3; page++) {
        const url = token
            ? `https://maps.googleapis.com/maps/api/place/${endpoint}/json?pagetoken=${token}&key=${GOOGLE_KEY}`
            : `https://maps.googleapis.com/maps/api/place/${endpoint}/json?${params}&key=${GOOGLE_KEY}`;
        const json = await places(url, 'textSearch');
        results.push(...(json.results ?? []));
        token = json.next_page_token;
        if (!token) break;
        await sleep(2000); // a page token takes a moment to become valid
    }
    return results;
}

/**
 * Two searches per centre: text search ranks by prominence and leaks past the
 * radius; nearby search keeps strictly to it, so between them a centre's
 * well-known hotels and its smaller ones both show up.
 */
async function searchAround(centre: Point, us: boolean): Promise<Candidate[]> {
    const at = `location=${centre.lat},${centre.lng}&radius=${us ? US_SEARCH_RADIUS_M : SEARCH_RADIUS_M}&language=${us ? 'en' : 'es'}`;
    const results = [
        ...await paged('textsearch', `query=${encodeURIComponent('hotel')}&type=lodging&region=${us ? 'us' : 'mx'}&${at}`),
        ...await paged('nearbysearch', `type=lodging&${at}`),
    ];
    return results.map((r): Candidate => ({
        placeId: r.place_id ?? '',
        name: String(r.name ?? '').trim(),
        lat: Number(r.geometry?.location?.lat),
        lng: Number(r.geometry?.location?.lng),
        // Nearby search gives `vicinity` (street, city) instead of a full address.
        address: r.formatted_address ?? r.vicinity ?? null,
        rating: typeof r.rating === 'number' ? r.rating : null,
        reviews: Number(r.user_ratings_total ?? 0),
        priceLevel: typeof r.price_level === 'number' ? r.price_level : null,
        businessStatus: r.business_status ?? null,
        types: r.types ?? [],
    })).filter((c) => c.placeId && Number.isFinite(c.lat) && Number.isFinite(c.lng));
}

async function details(placeId: string, us: boolean) {
    const fields = 'name,formatted_address,international_phone_number,website,address_components,geometry,rating,user_ratings_total,price_level,business_status';
    const json = await places(`https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&language=${us ? 'en' : 'es'}&key=${GOOGLE_KEY}`, 'details');
    return json.status === 'OK' ? json.result : null;
}

interface Row {
    google_place_id: string; name: string; city: string; country: 'MX' | 'US'; address: string | null;
    lat: number; lng: number; phone: string | null; website: string | null; booking_url: string;
    price_band: number | null; rating: number | null; review_count: number;
    description: { en: string; es: string }; status: 'live'; source: 'google'; source_run_id: string;
}

/** Mexican-side address markers: with `region=us` Google can still return a Juárez or Tijuana place near the line. */
const looksMexican = (addr: string | null) => Boolean(addr && /m[eé]xico|\bChih\.?\b|\bB\.?\s?C\.?\b|baja california|tijuana|ju[aá]rez/i.test(addr));

async function runCity(id: CityId, runId: string) {
    const { region, city: cityName, country } = CITIES[id];
    const us = country === 'US';
    const perCity = Math.max(1, Math.min(30, Number(perCityOpt ?? (us ? 8 : 12))));
    const crossings = crossingsOf(region);
    const clinics = us ? [] : await liveClinics(region);
    const off = US_SEARCH_OFFSET[region];
    const centres: Point[] = us ? crossings.map((c) => ({ lat: c.lat + off.dLat, lng: c.lng + off.dLng })) : clusterCentres(clinics, 5);
    console.log(us
        ? `\n■ ${cityName} (US side): search centres are a few km into the US from the ${crossings.length} border crossings`
        : `\n■ ${cityName}: ${clinics.length} live listings; centres ${(centres as { lat: number; lng: number; n: number }[]).map((c) => `${c.lat},${c.lng} (${c.n})`).join(' · ')}`);

    const found: Candidate[] = [];
    for (const c of centres) found.push(...await searchAround(c, us));
    // The side we want. Mexico: the Tijuana survey line and any US-style address. US: the survey line
    // (San Diego) and any Mexican address; Place Details country below has the last word.
    const wanted = found.filter((c) => us
        ? !(id === 'sandiego' && !usSideOfBorder(c.lat, c.lng)) && !looksMexican(c.address)
        : !(id === 'tijuana' && usSideOfBorder(c.lat, c.lng)) && !isUsAddress(c.address));
    const unique = new Map(wanted.map((c) => [c.placeId, c]));
    const rejected = [...unique.values()].map((c) => [c, rejectReason(c)] as const).filter(([, r]) => r);
    console.log(`  ${found.length} results, ${unique.size} unique on the ${us ? 'US' : 'Mexican'} side, ${rejected.length} rejected`);
    const reasons = new Map<string, number>();
    for (const [, r] of rejected) reasons.set(r!, (reasons.get(r!) ?? 0) + 1);
    for (const [r, n] of reasons) console.log(`    - ${n} ${r}`);

    // Pick a few extra, in case Place Details shows one is on the other side after all.
    const shortlist = pick([...unique.values()], clinics, perCity + 4, us ? (c) => scoreNearCrossing(c, crossings) : undefined);
    const rows: Row[] = [];
    const picked: Scored[] = [];
    for (const s of shortlist) {
        if (rows.length === perCity) break;
        const d = await details(s.placeId, us);
        const comps = d?.address_components ?? [];
        const got = comps.find((a) => a.types?.includes('country'))?.short_name;
        if (!d || got !== country) { console.log(`  ✗ ${s.name}: Place Details country ${got ?? 'unknown'}`); continue; }
        // US hotels sit in Chula Vista, National City, San Ysidro...: use the real city so Booking.com's search is right.
        const city = us ? (comps.find((a) => a.types?.includes('locality'))?.short_name ?? cityName) : cityName;
        picked.push(s);
        rows.push({
            google_place_id: s.placeId,
            name: s.name.slice(0, 160),
            city,
            country,
            address: d.formatted_address ?? s.address,
            lat: d.geometry?.location?.lat ?? s.lat,
            lng: d.geometry?.location?.lng ?? s.lng,
            phone: d.international_phone_number ?? null,
            website: typeof d.website === 'string' && /^https?:\/\//i.test(d.website) ? d.website : null,
            booking_url: bookingSearchUrl(s.name, city),
            price_band: priceBand(typeof d.price_level === 'number' ? d.price_level : s.priceLevel),
            rating: Math.round((d.rating ?? s.rating ?? 0) * 10) / 10 || null,
            review_count: Number(d.user_ratings_total ?? s.reviews),
            description: us && s.crossing ? describeCrossing({ crossing: s.crossing, crossingKm: s.crossingKm! }) : describe(s),
            status: 'live',
            source: 'google',
            source_run_id: runId,
        });
    }

    console.log(`  picks (${rows.length}):`);
    rows.forEach((r, i) => {
        const s = picked[i];
        const where = us ? `${s.crossingKm!.toFixed(2)} km from ${s.crossing!.id}` : `${s.clinicsWithin1Km} listings ≤1 km, nearest ${s.nearestClinicKm.toFixed(2)} km`;
        console.log(`   ${String(i + 1).padStart(2)}. ${r.name} (${r.city}) · ★${r.rating} (${r.review_count}) · ${r.price_band ? '$'.repeat(r.price_band) : '–'} · ${where} · ${r.address}`);
    });
    return rows;
}

async function write(rows: Row[]) {
    const ids = rows.map((r) => r.google_place_id);
    const { data: existing, error } = await supabase.from('hotels').select('id, google_place_id, status, source, amenities, description').in('google_place_id', ids);
    if (error) throw error;
    const byPlace = new Map((existing ?? []).map((e) => [e.google_place_id as string, e]));
    let inserted = 0, updated = 0, kept = 0;
    for (const r of rows) {
        const e = byPlace.get(r.google_place_id);
        if (!e) {
            const { error: insErr } = await supabase.from('hotels').insert(r);
            if (insErr) throw new Error(`${r.name}: ${insErr.message}`);
            inserted++;
            continue;
        }
        // An admin's decisions win: a hidden or draft hotel keeps its status, an edited description stays.
        const patch: Partial<Row> = { ...r };
        if (e.status !== 'live') { delete patch.status; kept++; }
        if (e.source !== 'google') delete patch.description;
        const { error: upErr } = await supabase.from('hotels').update(patch).eq('id', e.id);
        if (upErr) throw new Error(`${r.name}: ${upErr.message}`);
        updated++;
    }
    console.log(`\n✔ wrote ${rows.length}: ${inserted} new, ${updated} updated${kept ? ` (${kept} kept as they were: hidden or draft)` : ''}`);
}

async function main() {
    const runId = uuidv7();
    const startedAt = new Date().toISOString();
    const cities = (onlyCity ? [onlyCity] : Object.keys(CITIES)) as CityId[];
    for (const c of cities) if (!(c in CITIES)) { console.error(`✖ unknown --city=${c} (tijuana | juarez | sandiego | elpaso)`); process.exit(1); }

    console.log(`Hotel finder · run ${runId} · ${commit ? 'COMMIT (writes live hotels)' : 'dry run (writes nothing)'}`);
    const rows: Row[] = [];
    for (const c of cities) rows.push(...await runCity(c, runId));

    const usd = (calls.textSearch / 1000) * COST_PER_1K.textSearch + (calls.details / 1000) * COST_PER_1K.details;
    console.log(`\nGoogle calls: ${calls.textSearch} searches + ${calls.details} details (≈ US$${usd.toFixed(2)} at list price), ${calls.cached} from cache`);

    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, `${startedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}_${runId}.json`);
    fs.writeFileSync(file, JSON.stringify({ runId, startedAt, observedAt: new Date().toISOString(), commit, rows }, null, 2));
    console.log(`Run file: ${file}`);

    if (commit) await write(rows);
    else console.log('\nDry run: nothing written. Re-run with --commit to publish these hotels.');
}

main().catch((err) => { console.error('✖', err instanceof Error ? err.message : err); process.exit(1); });
