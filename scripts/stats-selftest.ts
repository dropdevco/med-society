/**
 * Checks for the profile-analytics pipeline's pure parts: the visit classifier,
 * the search-term dictionary, the PostHog → daily-stats roll-up and the report
 * emails. Nothing here touches the network.
 *
 *   npx tsx scripts/stats-selftest.ts
 */
import {
    aggregateDemand, aggregateProviderEvents, isoWeek, localHour, reportMail, utcDay,
    type ImpressionRow, type ProfileEventRow, type SearchRow, type StatsPayload,
} from '../api/stats';
import { classifyVisit } from '../src/lib/attribution';
import { matchSearchTerms } from '../src/utils/searchTerms';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

// ── Where a visit came from ──────────────────────────────────────────────────
const HOST = 'medsociety.one';
check('no referrer is direct', classifyVisit('', '', HOST).channel === 'direct');
check('google is search', classifyVisit('https://www.google.com/', '', HOST).channel === 'search');
check('chatgpt referrer is ai', classifyVisit('https://chatgpt.com/', '', HOST).channel === 'ai');
check('chatgpt utm_source is ai', classifyVisit('', '?utm_source=chatgpt.com', HOST).channel === 'ai');
check('whatsapp referrer', classifyVisit('https://wa.me/', '', HOST).channel === 'whatsapp');
check('instagram is social', classifyVisit('https://l.instagram.com/?u=x', '', HOST).channel === 'social');
check('newsletter beats a gmail referrer',
    classifyVisit('https://mail.google.com/', '?utm_medium=email&utm_campaign=Weekly', HOST).channel === 'email');
check('campaign is kept, lower-cased',
    classifyVisit('', '?utm_medium=email&utm_campaign=Weekly', HOST).utm_campaign === 'weekly');
check('own host is internal', classifyVisit('https://medsociety.one/search', '', HOST).channel === 'internal');
check('unknown site is a referral, host only',
    classifyVisit('https://blog.example.com/post?x=secret', '', HOST).channel_source === 'blog.example.com');
check('garbage referrer does not throw', classifyVisit('not a url', '', HOST).channel === 'direct');

// ── Search terms: services only, never conditions ────────────────────────────
const m1 = matchSearchTerms('Cuánto cuesta un IMPLANTE dental en Juárez');
check('matches implants through accent/case/plural', m1.terms.includes('dental_implants'), m1);
check('implants imply dentist', m1.specialties.includes('dentist'), m1);
check('English works', matchSearchTerms('teeth whitening near me').terms.includes('teeth_whitening'));
check('a symptom matches nothing', matchSearchTerms('me duele la espalda y tengo diabetes').terms.length === 0);
check('a condition is not in the vocabulary', matchSearchTerms('depression anxiety').terms.length === 0);
check('short words need to be whole words', !matchSearchTerms('diurno').terms.includes('contraception'));
check('lipo does not match a polyp', matchSearchTerms('polipo').terms.length === 0);
check('empty text is empty', matchSearchTerms('').terms.length === 0);
check('capped at five', matchSearchTerms('implantes brackets blanqueamiento botox lasik rinoplastia masaje').terms.length === 5);

// ── Roll-up ──────────────────────────────────────────────────────────────────
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const T0 = Date.UTC(2026, 10, 2, 18, 0, 0) / 1000;    // 2 Nov 2026 18:00Z
const ev = (p: Partial<ProfileEventRow>): ProfileEventRow => ({
    event: 'provider_viewed', providerId: A, distinctId: 'u1', ts: T0, method: null,
    channel: 'search', country: 'US', lang: 'en', device: 'Mobile', section: null, ...p,
});
const events: ProfileEventRow[] = [
    ev({}),
    ev({ distinctId: 'u1', ts: T0 + 60 }),                       // same person again
    ev({ distinctId: 'u2', channel: 'ai', country: 'MX', lang: 'es' }),
    ev({ event: 'provider_clicked' }),
    ev({ event: 'provider_contact_click', method: 'whatsapp' }),
    ev({ event: 'provider_contact_click', method: 'phone' }),
    ev({ event: 'provider_section_viewed', section: 'reviews' }),
    ev({ distinctId: 'owner1' }),                                // the doctor, signed in
    ev({ providerId: 'not-a-uuid' }),
    ev({ providerId: B }),
    ev({ ts: T0 - 5 * 864e2 * 1000 }),                           // far outside the window
];
const imps: ImpressionRow[] = [
    { distinctId: 'u1', ts: T0, ids: `${A}:1,${B}:4` },
    { distinctId: 'u2', ts: T0, ids: `${A}:3` },
    { distinctId: 'owner1', ts: T0, ids: `${A}:1` },
    { distinctId: 'u3', ts: T0, ids: `bad:1,${A}:x` },
];
const day = utcDay(T0);
const stats = aggregateProviderEvents(events, imps, {
    fromDay: day, toDay: day,
    regionOf: () => 'sandiego-tijuana',
    owners: new Map([[A, new Set(['owner1'])]]),
});
const a = stats.get(`${A}|${day}`)!;
check('views counted, owner and junk excluded', a.views === 3, a.views);
check('visitors are distinct people', a.visitors.size === 2, a.visitors.size);
check('sources split', a.sources.search === 2 && a.sources.ai === 1, a.sources);
check('countries and langs', a.countries.US === 2 && a.countries.MX === 1 && a.langs.es === 1, [a.countries, a.langs]);
check('clicks and contacts', a.clicks === 1 && a.contacts === 2, [a.clicks, a.contacts]);
check('contacts by method', a.contacts_by_method.whatsapp === 1 && a.contacts_by_method.phone === 1, a.contacts_by_method);
check('sections', a.sections.reviews === 1, a.sections);
check('impressions without the owner', a.impressions === 3, a.impressions);   // u1:1, u2:3, u3:A:x counts, no position
check('position sum ignores a bad position', a.position_sum === 4, a.position_sum);
check('hour is the clinic\'s local hour (Pacific, 18:00Z = 10:00 in Nov)', a.by_hour[10] === 3, a.by_hour);
check('a second listing is separate', stats.get(`${B}|${day}`)?.views === 1);
check('out-of-window event is dropped', [...stats.keys()].every((k) => k.endsWith(day)));
check('Denver clock for El Paso', localHour(T0, 'elpaso-juarez') === 11, localHour(T0, 'elpaso-juarez'));

// ── Demand ───────────────────────────────────────────────────────────────────
const search = (p: Partial<SearchRow>): SearchRow => ({
    ts: T0, region: 'sandiego-tijuana', demandSpecialties: '["dentist"]', terms: '["dental_implants"]',
    insuranceFilter: 'true', languageFilter: '[]', verifiedOnly: 'false', noResults: 'false', ...p,
});
const demand = aggregateDemand([
    search({}),
    search({ noResults: 'true', insuranceFilter: 'false' }),
    search({ demandSpecialties: '[]', terms: '[]' }),
    search({ region: null }),
], { fromDay: day, toDay: day });
const pick = (spec: string, kind: string, key: string) =>
    demand.find((d) => d.specialty === spec && d.kind === kind && d.key === key);
check('searches per specialty', pick('dentist', 'searches', 'all')?.searches === 2, pick('dentist', 'searches', 'all'));
check('no_results counted', pick('dentist', 'searches', 'all')?.no_results === 1);
check('term counted', pick('dentist', 'term', 'dental_implants')?.searches === 2);
check('filter counted only when used', pick('dentist', 'filter', 'insurance')?.searches === 1);
check('unspecified searches go to _any', pick('_any', 'searches', 'all')?.searches === 1);
check('a search with no region is dropped', demand.every((d) => d.region === 'sandiego-tijuana'));

// ── Dates ────────────────────────────────────────────────────────────────────
check('ISO week', isoWeek(new Date(Date.UTC(2026, 10, 2))) === '2026-W45', isoWeek(new Date(Date.UTC(2026, 10, 2))));
check('ISO week across new year', isoWeek(new Date(Date.UTC(2027, 0, 1))) === '2026-W53', isoWeek(new Date(Date.UTC(2027, 0, 1))));

// ── Emails ───────────────────────────────────────────────────────────────────
const r = (tier: 'basic' | 'promoted' | 'featured', lang: 'en' | 'es') => ({
    user_id: 'u', email: 'dr@example.com', lang, token: 't0k3n', provider_id: A, provider_name: 'Clínica <Sol>', tier,
});
const base: StatsPayload = { tier: 'basic', ready: true, views_30d: 120 };
const basic = reportMail(r('basic', 'en'), base, 'monthly');
check('basic: subject has the number', basic.subject.includes('120'), basic.subject);
check('basic: points at the plans', basic.html.includes('tab=plan'));
check('basic: unsubscribe is the reports kind', basic.unsubscribeUrl.endsWith('&k=reports'), basic.unsubscribeUrl);
check('html-escapes the clinic name', !basic.html.includes('<Sol>') && basic.html.includes('&lt;Sol&gt;'));

const promoted: StatsPayload = {
    tier: 'promoted', ready: true, views_30d: 200,
    totals: { impressions: 900, avg_position: 4.2, clicks: 150, views: 200, visitors: 160, contacts: 30, inquiries: 4 },
    prev: { views: 100, contacts: 10 }, prev_complete: true,
    contacts_by_method: { whatsapp: 18, phone: 12 }, sources: { search: 120, ai: 40 },
    plan_lift: { since: '2026-10-01', before_per_day: 3.1, after_per_day: 6.8 },
};
const pm = reportMail(r('promoted', 'es'), promoted, 'monthly');
check('promoted es: change vs last month', pm.text.includes('subió 100%'), pm.text);
check('promoted es: contacts by method', pm.text.includes('18 toques en WhatsApp'), pm.text);
check('promoted es: plan lift', pm.text.includes('6.8') && pm.text.includes('3.1'));
const noPrev = reportMail(r('promoted', 'en'), { ...promoted, prev_complete: false }, 'monthly');
check('no comparison when last month is incomplete', !/ up |down /.test(noPrev.text.split('\n')[2] ?? ''), noPrev.text);

const daily = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(20 + i).padStart(2, '0')}`, views: i < 7 ? 2 : 4, contacts: 1 }));
const featured: StatsPayload = {
    ...promoted, tier: 'featured', daily, by_hour: Array.from({ length: 24 }, (_, h) => (h === 14 ? 9 : 1)),
    benchmark: { percentile: 80, peers: 25 },
};
const wm = reportMail(r('featured', 'en'), featured, 'weekly');
check('featured: weekly numbers from the last 7 days', wm.text.includes('28 profile views') && wm.text.includes('up 100%'), wm.text);
check('featured: busiest hour', wm.text.includes('14:00'));
check('featured: benchmark', wm.text.includes('80%'));

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
