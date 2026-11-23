/**
 * Flights: the partner link, airport entry and the optional commission wrapper.
 * No network, no credentials.
 *   npx tsx scripts/flights-selftest.ts
 */
import { readFileSync } from 'node:fs';
import { GUIDE, guideFor } from '../src/utils/gettingHere';
import { buildFlightHref, earnsFlightCommission, FLIGHT_DESTINATIONS, parseAirport, suggestedTrip, validFlightQuery } from '../src/utils/flightLinks';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
    if (!ok) failed++;
}

const TODAY = '2026-11-23';
const TP = 'https://tp.media/r?marker=123456&p=4114&u={url}';

console.log('airports');
check('a 3-letter code, any case', parseAirport('lax') === 'LAX' && parseAirport(' SAN ') === 'SAN');
check('the datalist form', parseAirport('Los Angeles (LAX)') === 'LAX');
check('a known city name', parseAirport('Chicago O’Hare') === 'ORD');
check('nonsense is refused', parseAirport('') === null && parseAirport('Narnia') === null && parseAirport('12') === null);
check('four destinations, both regions, both sides', FLIGHT_DESTINATIONS.map((d) => d.code).join() === 'SAN,TIJ,ELP,CJS'
    && FLIGHT_DESTINATIONS.filter((d) => d.side === 'us').length === 2);

console.log('links');
{
    const round = buildFlightHref({ from: 'lax', to: 'SAN', depart: '2026-12-01', ret: '2026-12-05', adults: 1, today: TODAY }, {});
    check('round trip uses the Aviasales form ORIGIN DDMM DEST DDMM ADULTS', round === 'https://www.aviasales.com/search/LAX0112SAN05121', round);
    const oneWay = buildFlightHref({ from: 'ORD', to: 'ELP', depart: '2026-12-01', adults: 2, today: TODAY }, {});
    check('one way has no return date', oneWay === 'https://www.aviasales.com/search/ORD0112ELP2', oneWay);
    const wrapped = buildFlightHref({ from: 'LAX', to: 'TIJ', depart: '2026-12-01', ret: '2026-12-05', today: TODAY }, { template: TP });
    check('a network template wraps the encoded partner address', wrapped === `https://tp.media/r?marker=123456&p=4114&u=${encodeURIComponent('https://www.aviasales.com/search/LAX0112TIJ05121')}`, wrapped);
    check('commission only when a template is set', earnsFlightCommission(wrapped, { template: TP }) && !earnsFlightCommission(round, {}));
    check('a template without {url}, with two, or over http is ignored',
        buildFlightHref({ from: 'LAX', to: 'SAN', depart: '2026-12-01', today: TODAY }, { template: 'https://x.test/r' })?.startsWith('https://www.aviasales.com/') === true
        && buildFlightHref({ from: 'LAX', to: 'SAN', depart: '2026-12-01', today: TODAY }, { template: 'https://x.test/{url}/{url}' })?.startsWith('https://www.aviasales.com/') === true
        && buildFlightHref({ from: 'LAX', to: 'SAN', depart: '2026-12-01', today: TODAY }, { template: 'http://x.test/?u={url}' })?.startsWith('https://www.aviasales.com/') === true);
}

console.log('validation');
{
    const ok = { from: 'LAX', to: 'SAN', depart: '2026-12-01', today: TODAY };
    check('same origin and destination is refused', validFlightQuery({ ...ok, to: 'LAX' }) === null);
    check('a past departure is refused', validFlightQuery({ ...ok, depart: '2026-11-22' }) === null);
    check('today is fine', validFlightQuery({ ...ok, depart: TODAY }) !== null);
    check('a return on or before departure is refused', validFlightQuery({ ...ok, ret: '2026-12-01' }) === null && validFlightQuery({ ...ok, ret: '2026-11-30' }) === null);
    check('an impossible date is refused', validFlightQuery({ ...ok, depart: '2026-02-30' }) === null);
    check('bad codes are refused', validFlightQuery({ ...ok, from: 'LA' }) === null && validFlightQuery({ ...ok, to: 'S4N' }) === null);
    check('adults are clamped to 1–9, default 1', validFlightQuery({ ...ok, adults: 40 })?.adults === 9
        && validFlightQuery({ ...ok, adults: 0 })?.adults === 1 && validFlightQuery(ok)?.adults === 1);
    const s = suggestedTrip(TODAY);
    check('the suggested trip is two weeks out, back a week later', s.depart === '2026-12-07' && s.ret === '2026-12-14', s);
}

console.log('getting-here guide (api/agent.ts keeps an English copy)');
{
    const agent = readFileSync(new URL('../api/agent.ts', import.meta.url), 'utf8');
    const strings = [
        ...GUIDE.bring.map((b) => b.text.en), GUIDE.cbx.en, GUIDE.disclaimer.en,
        ...(['sandiego-tijuana', 'elpaso-juarez'] as const).flatMap((r) => guideFor(r, 'en').airports.map((a) => a.next.en)),
    ];
    const missing = strings.filter((x) => !agent.includes(x));
    check('the prerendered guide has the same English text as the page', missing.length === 0, missing);
    check('each region has a US and a Mexican airport and its crossings', (['sandiego-tijuana', 'elpaso-juarez'] as const).every((r) => {
        const g = guideFor(r, 'en');
        return g.airports.length === 2 && g.airports[0].side === 'us' && g.airports[1].side === 'mx' && g.crossings.length >= 2;
    }));
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
