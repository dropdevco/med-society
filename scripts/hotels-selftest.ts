/**
 * Hotels: affiliate links, stay dates, and the finder's picking rules.
 * No network, no credentials, made-up places only.
 *   npx tsx scripts/hotels-selftest.ts
 */
import { addDays, buildBookingHref, earnsCommission, validStay } from '../src/utils/hotelLinks';
import { bookingSearchUrl, clusterCentres, describe, describeCrossing, isUnsuitableName, pick, priceBand, rejectReason, scoreNearCrossing, type Candidate } from './hotels/pick';
import { BORDER_CROSSINGS, crossingsOf, formatCrossingDistance, fromCrossing, nearestCrossing } from '../src/utils/borderCrossings';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failed++;
}

const TODAY = '2026-11-19';
const booking = { booking_url: 'https://www.booking.com/searchresults.html?ss=Hotel%20Prueba%2C%20Tijuana', website: null };
const ownSite = { booking_url: null, website: 'https://hotel-prueba.example/reservas' };
const CJ = 'https://www.anrdoezrs.net/click-1234567-15734286?url={url}';

console.log('links');
{
    const plain = buildBookingHref(booking, { lang: 'es', checkin: '2026-12-01', checkout: '2026-12-04', today: TODAY }, {});
    const u = new URL(plain!);
    check('plain link keeps the search and adds lang, label and dates', u.hostname === 'www.booking.com'
        && u.searchParams.get('ss') === 'Hotel Prueba, Tijuana' && u.searchParams.get('lang') === 'es'
        && u.searchParams.get('label') === 'medsociety' && u.searchParams.get('checkin') === '2026-12-01'
        && u.searchParams.get('checkout') === '2026-12-04', plain);
    check('no commission configured → not marked sponsored', !earnsCommission(plain, {}));

    const wrapped = buildBookingHref(booking, { lang: 'en', checkin: '2026-12-01', checkout: '2026-12-04', today: TODAY }, { template: CJ });
    check('template wraps the Booking.com link', wrapped!.startsWith('https://www.anrdoezrs.net/click-1234567-15734286?url='), wrapped);
    const inner = new URL(decodeURIComponent(wrapped!.split('?url=')[1]));
    check('the wrapped link round-trips with dates, lang and label', inner.hostname === 'www.booking.com'
        && inner.searchParams.get('checkin') === '2026-12-01' && inner.searchParams.get('lang') === 'en-us'
        && inner.searchParams.get('label') === 'medsociety' && inner.searchParams.get('ss') === 'Hotel Prueba, Tijuana', inner.toString());
    check('the destination is encoded, so its & cannot leak into the network link', !wrapped!.split('?url=')[1].includes('&'));
    check('wrapped link counts as commission', earnsCommission(wrapped, { template: CJ }));
    check('template wins over an old aid', !wrapped!.includes('aid='));

    const own = buildBookingHref(ownSite, { lang: 'es' }, { template: CJ, aid: '999' });
    check("a hotel's own website is never wrapped or changed", own === 'https://hotel-prueba.example/reservas', own);
    check('…and is not marked sponsored', !earnsCommission(own, { template: CJ }));

    const aid = buildBookingHref(booking, {}, { aid: '1234' });
    check('old direct aid still works without a template', new URL(aid!).searchParams.get('aid') === '1234' && earnsCommission(aid, { aid: '1234' }), aid);

    for (const bad of ['http://www.anrdoezrs.net/click-1?url={url}', 'https://x.example/click?url=', 'https://x.example/{url}?u={url}', 'javascript:{url}']) {
        const out = buildBookingHref(booking, {}, { template: bad });
        check(`unusable template is ignored: ${bad}`, new URL(out!).hostname === 'www.booking.com', out);
    }
    check('a javascript: hotel link is refused', buildBookingHref({ booking_url: null, website: 'javascript:alert(1)' }, {}, {}) === null);
}

console.log('stay dates');
check('valid stay', JSON.stringify(validStay('2026-12-01', '2026-12-03', TODAY)) === '{"checkin":"2026-12-01","checkout":"2026-12-03"}');
check('check-out on or before check-in → no stay', validStay('2026-12-03', '2026-12-03', TODAY) === null && validStay('2026-12-04', '2026-12-03', TODAY) === null);
check('check-in in the past → no stay (stale shared links)', validStay('2026-11-01', '2026-11-03', TODAY) === null);
check('impossible dates → no stay', validStay('2026-02-30', '2026-03-02', TODAY) === null && validStay('tomorrow', '2026-12-01', TODAY) === null);
check('a stale stay is dropped from the link, the rest kept',
    !new URL(buildBookingHref(booking, { checkin: '2026-11-01', checkout: '2026-11-02', today: TODAY }, {})!).searchParams.has('checkin'));
check('addDays crosses months and years', addDays('2026-12-31', 1) === '2027-01-01' && addDays('2026-02-28', 1) === '2026-03-01');

console.log('finder rules');
const base: Candidate = { placeId: 'p', name: 'Hotel Prueba', lat: 32.527, lng: -117.022, address: null, rating: 4.5, reviews: 500, priceLevel: null, businessStatus: 'OPERATIONAL', types: ['lodging'] };
for (const n of ['Auto Hotel Las Palmas', 'AutoHotel Real', 'Motel Fiesta', 'Hostal del Centro', 'Villa Motel Love']) check(`refuses "${n}"`, isUnsuitableName(n));
for (const n of ['Hotel Lucerna Tijuana', 'Real Inn Tijuana', 'Holiday Inn Express & Suites', 'Hotel Ticuán']) check(`keeps "${n}"`, !isUnsuitableName(n));
check('closed hotels are dropped', rejectReason({ ...base, businessStatus: 'CLOSED_PERMANENTLY' }) !== null);
check('under 4.0 stars is dropped', rejectReason({ ...base, rating: 3.9 }) !== null);
check('under 100 reviews is dropped', rejectReason({ ...base, reviews: 99 }) !== null);
check('no rating is dropped', rejectReason({ ...base, rating: null }) !== null);
check('a good hotel is kept', rejectReason(base) === null);

const clinics = [
    ...Array.from({ length: 30 }, (_, i) => ({ lat: 32.527 + i * 0.0001, lng: -117.022 })),
    ...Array.from({ length: 10 }, (_, i) => ({ lat: 32.533 + i * 0.0001, lng: -117.040 })),
    { lat: 32.40, lng: -117.10 },
];
const centres = clusterCentres(clinics, 3, 1.5);
check('densest cluster comes first', centres[0].n >= 30 && Math.abs(centres[0].lat - 32.53) < 0.011, centres);
check('centres are at least 1.5 km apart', centres.every((a, i) => centres.slice(i + 1).every((b) => Math.hypot(a.lat - b.lat, a.lng - b.lng) > 0.0135)), centres);

const near = { ...base, placeId: 'near', name: 'Cerca', reviews: 300 };
const far = { ...base, placeId: 'far', name: 'Lejos', lat: 32.45, lng: -116.95, rating: 4.7, reviews: 5000 };
const picked = pick([far, near, near, { ...base, placeId: 'motel', name: 'Auto Hotel X' }], clinics, 5);
check('a hotel next to the clinics beats a better-rated one 10 km away', picked[0].placeId === 'near', picked.map((p) => p.placeId));
check('duplicates and motels are removed', picked.length === 2 && !picked.some((p) => p.placeId === 'motel'));
const levelled = pick(Array.from({ length: 10 }, (_, i) => ({ ...base, placeId: `l${i}`, priceLevel: i < 8 ? 1 : 3, reviews: 1000 - i })), clinics, 4);
check('no more than half from one price level when others exist', levelled.filter((p) => p.priceLevel === 1).length === 2, levelled.map((p) => p.priceLevel));
check('price level maps to $–$$$$', priceBand(0) === 1 && priceBand(1) === 1 && priceBand(2) === 2 && priceBand(4) === 4 && priceBand(null) === null);

const d = describe({ clinicsWithin1Km: 120, nearestClinicKm: 0.62 });
check('description counts listings and the nearest, in both languages', d.en === '120 doctors and clinics listed within 1 km. The nearest is 600 m away.'
    && d.es === '120 médicos y clínicas a menos de 1 km. El más cercano está a 600 m.', d);
check('large counts get a thousands separator', describe({ clinicsWithin1Km: 1730, nearestClinicKm: 0.03 }).en.startsWith('1,730 doctors') && describe({ clinicsWithin1Km: 1730, nearestClinicKm: 0.03 }).es.startsWith('1,730 médicos'));
check('description without a cluster nearby', describe({ clinicsWithin1Km: 0, nearestClinicKm: 2.34 }).en === 'The nearest listed doctor or clinic is 2.3 km away.');
check('Booking.com search link for a hotel name with accents and &', bookingSearchUrl('Hotel Ticuán & Suites', 'Tijuana')
    === 'https://www.booking.com/searchresults.html?ss=Hotel%20Ticu%C3%A1n%20%26%20Suites%2C%20Tijuana');

console.log('US side');
{
    const sd = crossingsOf('sandiego-tijuana');
    const ep = crossingsOf('elpaso-juarez');
    check('both regions have crossings', sd.length >= 2 && ep.length >= 2);
    check('every crossing is in its region by longitude', BORDER_CROSSINGS.every((c) => (c.lng < -110) === (c.region === 'sandiego-tijuana')));
    const near = { ...base, placeId: 'usnear', name: 'Cerca de la Garita', lat: 32.545, lng: -117.03, reviews: 300 };
    const far = { ...base, placeId: 'usfar', name: 'Lejos', lat: 32.68, lng: -117.1, rating: 4.8, reviews: 6000 };
    const out = pick([far, near], [], 2, (c) => scoreNearCrossing(c, sd));
    check('a hotel 0.3 km from the crossing beats a better-rated one 17 km away', out[0].placeId === 'usnear' && out[0].crossing?.id === 'san-ysidro', out.map((o) => [o.placeId, o.crossingKm]));
    check('nearestCrossing picks Zaragoza for east Juárez', nearestCrossing({ lat: 31.68, lng: -106.34 }, 'elpaso-juarez').crossing.id === 'ysleta-zaragoza');
    check('nearestCrossing picks Paso del Norte for downtown El Paso', nearestCrossing({ lat: 31.757, lng: -106.485 }, 'elpaso-juarez').crossing.id === 'paso-del-norte');
    const c = describeCrossing({ crossing: sd[0], crossingKm: 2.1 });
    check('crossing description, English: miles and km, straight line', c.en === '1.3 mi (2.1 km) in a straight line from the San Ysidro crossing.', c.en);
    check('crossing description, Spanish: km, straight line', c.es === 'A 2.1 km en línea recta de la garita de San Ysidro.', c.es);
    const epd = describeCrossing({ crossing: ep[0], crossingKm: 1 });
    check('Spanish "de el" contracts to "del" for a bridge', epd.es === 'A 1 km en línea recta del puente internacional Paso del Norte.', epd.es);
    check('descriptions never promise waits, times or safety', ![c.en, c.es, epd.en, epd.es].some((t) => /wait|minute|minuto|\bsafe|segur|espera/i.test(t)));
    check('fromCrossing reads in both languages', fromCrossing(sd[1], 'en') === 'from the Otay Mesa crossing' && fromCrossing(sd[1], 'es') === 'de la garita de Otay Mesa');
    check('caption distance: miles in English, km in Spanish', formatCrossingDistance(2.1, 'en') === '1.3 mi' && formatCrossingDistance(2.1, 'es') === '2.1 km');
    check('the city Google reports reaches the Booking.com search', bookingSearchUrl('Hotel Prueba', 'Chula Vista') === 'https://www.booking.com/searchresults.html?ss=Hotel%20Prueba%2C%20Chula%20Vista');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
