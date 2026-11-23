/**
 * Summary of what PostHog has collected, read-only.
 *
 *   npx tsx --env-file=.env.local scripts/posthog-summary.ts          last 30 days
 *   npx tsx --env-file=.env.local scripts/posthog-summary.ts 60       last 60 days
 *
 * Needs POSTHOG_PERSONAL_API_KEY and POSTHOG_PROJECT_ID (POSTHOG_API_HOST if the
 * project is on the EU region). The key is read from the environment and never
 * printed. Listing names are looked up with the public anon key, which cannot
 * read contact fields.
 *
 * Dev traffic (localhost, *.vercel.app previews) is left out of every number
 * except the "hosts" table, which shows where events came from.
 */

const key = process.env.POSTHOG_PERSONAL_API_KEY;
const project = process.env.POSTHOG_PROJECT_ID;
const host = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
const days = Math.max(1, Math.min(365, Number(process.argv[2]) || 30));

if (!key || !project) {
    console.error('Missing POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID (run with --env-file=.env.local).');
    process.exit(1);
}

async function hogql(query: string): Promise<unknown[][]> {
    const res = await fetch(`${host}/api/projects/${encodeURIComponent(project!)}/query/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`PostHog ${res.status}: ${text.slice(0, 300)}`);
    return (JSON.parse(text) as { results?: unknown[][] }).results ?? [];
}

const since = `timestamp > now() - interval ${days} day`;
const live = `toString(properties.$host) not like 'localhost%' and toString(properties.$host) not like '%.vercel.app'`;

function table(title: string, head: string[], rows: unknown[][]) {
    console.log(`\n== ${title}`);
    if (!rows.length) { console.log('   (nothing)'); return; }
    const cell = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v));
    const all = [head, ...rows.map((r) => r.map(cell))];
    const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
    for (const [n, r] of all.entries()) {
        console.log('   ' + r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  '));
        if (n === 0) console.log('   ' + w.map((x) => '-'.repeat(x)).join('  '));
    }
}

async function main() {
    console.log(`PostHog summary, last ${days} days (project ${project}, ${host})`);

    table('hosts (all traffic, shows what is being excluded)', ['host', 'events', 'visitors'], await hogql(
        `select toString(properties.$host), count(), count(distinct distinct_id)
         from events where ${since} group by 1 order by 2 desc limit 15`));

    table('events', ['event', 'events', 'visitors', 'first seen', 'last seen'], await hogql(
        `select event, count(), count(distinct distinct_id), toString(toDate(min(timestamp))), toString(toDate(max(timestamp)))
         from events
         where ${since} and ${live}
           and (event = '$pageview' or event like 'provider_%' or event in ('search_performed','inquiry_sent','inquiry_failed'))
         group by event order by 2 desc limit 40`));

    table('by day', ['day', 'pageviews', 'visitors', 'profile views', 'contact taps', 'searches'], await hogql(
        `select toString(toDate(timestamp)) as d,
                countIf(event = '$pageview'),
                count(distinct distinct_id),
                countIf(event = 'provider_viewed'),
                countIf(event = 'provider_contact_click'),
                countIf(event = 'search_performed')
         from events where ${since} and ${live} group by d order by d desc limit 60`));

    table('where visitors came from (pageviews)', ['channel', 'pageviews', 'visitors'], await hogql(
        `select if(toString(properties.channel) = '', '(not set: before tracking)', toString(properties.channel)),
                count(), count(distinct distinct_id)
         from events where ${since} and ${live} and event = '$pageview' group by 1 order by 2 desc limit 12`));

    table('countries (pageviews)', ['country', 'pageviews', 'visitors'], await hogql(
        `select toString(properties.$geoip_country_code), count(), count(distinct distinct_id)
         from events where ${since} and ${live} and event = '$pageview' group by 1 order by 2 desc limit 10`));

    table('devices (pageviews)', ['device', 'pageviews', 'visitors'], await hogql(
        `select toString(properties.$device_type), count(), count(distinct distinct_id)
         from events where ${since} and ${live} and event = '$pageview' group by 1 order by 2 desc limit 6`));

    table('top pages', ['path', 'pageviews', 'visitors'], await hogql(
        `select toString(properties.$pathname), count(), count(distinct distinct_id)
         from events where ${since} and ${live} and event = '$pageview' group by 1 order by 2 desc limit 12`));

    table('contact taps by method', ['method', 'taps'], await hogql(
        `select toString(properties.method), count()
         from events where ${since} and ${live} and event = 'provider_contact_click' group by 1 order by 2 desc limit 10`));

    table('searches', ['searches', 'with no results'], await hogql(
        `select count(), countIf(toString(properties.no_results) = 'true')
         from events where ${since} and ${live} and event = 'search_performed'`));

    const top = await hogql(
        `select toString(properties.provider_id), countIf(event = 'provider_viewed'), count(distinct distinct_id),
                countIf(event = 'provider_contact_click')
         from events
         where ${since} and ${live} and event in ('provider_viewed','provider_contact_click')
           and toString(properties.provider_id) != ''
         group by 1 order by 2 desc limit 15`);

    // Names come from the public listing table; skip quietly if that is not reachable.
    const names = new Map<string, string>();
    const url = process.env.VITE_SUPABASE_URL;
    const anon = process.env.VITE_SUPABASE_ANON_KEY;
    const ids = top.map((r) => String(r[0])).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (url && anon && ids.length) {
        try {
            const res = await fetch(`${url}/rest/v1/providers?select=id,name&id=in.(${ids.join(',')})`, {
                headers: { apikey: anon, Authorization: `Bearer ${anon}` },
            });
            if (res.ok) for (const p of (await res.json()) as { id: string; name: string }[]) names.set(p.id, p.name);
        } catch { /* names are a nicety */ }
    }
    table('most viewed listings', ['listing', 'profile views', 'visitors', 'contact taps'],
        top.map((r) => [names.get(String(r[0])) ?? String(r[0]), r[1], r[2], r[3]]));

    console.log('\nNote: "visitors" counts browsers (anonymous ids), not people. Staff visits are not filtered here.');
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
