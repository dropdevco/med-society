/**
 * Profile analytics for doctors: PostHog in, Supabase out, then an email.
 *
 *   GET /api/stats?job=sync      (Vercel Cron, daily — vercel.json)
 *       Reads the last couple of days of profile events from PostHog, rolls them
 *       up per listing per day into `provider_stats_daily`, and the searches into
 *       `market_demand_daily` (supabase/migrations/0031_provider_stats.sql).
 *       `&days=N` re-computes the last N days (up to 45), for a backfill or after
 *       an outage; re-running a day is harmless, it is recomputed, not added to.
 *
 *   GET /api/stats?job=reports   (Vercel Cron, daily — after the sync)
 *       Sends the report emails that are due today: the monthly report to Basic
 *       and Promoted listings on the 1st, the weekly digest to Featured listings
 *       on Mondays. Listings that have not cleared the "enough data" bar get
 *       nothing — an email saying "0 views" is worse than silence. Also emails the
 *       team any patient inquiry still untouched after a day.
 *       `&dry=1` lists what would go out and sends nothing.
 *
 * Both need `Authorization: Bearer $CRON_SECRET`.
 *
 * Why the dashboard does not read PostHog directly: the key that reads PostHog can
 * read everything in it, so it lives here and nowhere near a browser; and what a
 * doctor is allowed to see depends on their plan, which Postgres decides
 * (`my_provider_stats`). This file is the pipe between the two.
 *
 * Self-contained on purpose, like every other file in api/: no sibling imports
 * to trip the ESM resolution of Vercel's Node runtime.
 *
 * ── Env (server-only, Vercel → Settings → Environment Variables) ─────────────
 *   POSTHOG_PERSONAL_API_KEY   a PostHog *personal* API key with "Query: read"
 *                              (PostHog → Settings → Personal API keys). NOT the
 *                              public phc_ project key the browser uses.
 *   POSTHOG_PROJECT_ID         the number in the PostHog URL: /project/<id>/…
 *   POSTHOG_API_HOST           optional, default https://us.posthog.com
 *                              (https://eu.posthog.com for an EU project)
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, CRON_SECRET
 *                              already set for the other jobs
 *   STATS_NOTIFY_FROM          optional sender; falls back to FORUM_NOTIFY_FROM,
 *                              then LEAD_NOTIFY_FROM
 *   LEAD_NOTIFY_TO             where the team's "inquiry waiting" alert goes
 *   PUBLIC_SITE_URL            optional, default https://medsociety.one
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage & { body?: unknown };
type Res = ServerResponse & {
    status: (code: number) => Res;
    json: (body: unknown) => void;
};

type Rec = Record<string, number>;
type Lang = 'en' | 'es';

const SITE = (process.env.PUBLIC_SITE_URL || 'https://medsociety.one').replace(/\/$/, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 864e5;
const PAGE = 10_000;
/** A hard stop so a runaway day cannot eat the whole function: 500k events. */
const MAX_PAGES = 50;

// ── Entry ───────────────────────────────────────────────────────────────────

export default async function handler(req: Req, res: Res) {
    const url = new URL(req.url ?? '/', 'http://local');
    const job = url.searchParams.get('job');

    const secret = process.env.CRON_SECRET;
    const auth = req.headers.authorization ?? '';
    if (!secret || !secretMatches(auth.replace(/^Bearer\s+/i, ''), secret)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        if (job === 'sync') {
            const days = clampInt(url.searchParams.get('days'), 1, 45, 2);
            return res.status(200).json({ ok: true, ...(await syncStats(days)) });
        }
        if (job === 'reports') {
            const dry = url.searchParams.get('dry') === '1';
            const on = url.searchParams.get('date');
            return res.status(200).json({ ok: true, ...(await sendReports(on ? new Date(on) : new Date(), dry)) });
        }
        return res.status(400).json({ error: 'Expected ?job=sync or ?job=reports' });
    } catch (err) {
        console.error('[stats]', err);
        return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
}

// ── 1. PostHog → provider_stats_daily ───────────────────────────────────────

/** One event of a profile view, click, contact tap or section reached. */
export interface ProfileEventRow {
    event: string;
    providerId: string | null;
    distinctId: string;
    ts: number;                     // unix seconds
    method: string | null;
    channel: string | null;
    country: string | null;
    lang: string | null;
    device: string | null;
    section: string | null;
}

/** One `provider_impressions` event: who saw `id:position` pairs, and when. */
export interface ImpressionRow { distinctId: string; ts: number; ids: string | null }

/** One `search_performed` event, reduced to the fields demand is reported on. */
export interface SearchRow {
    ts: number;
    region: string | null;
    demandSpecialties: string | null;   // JSON array, as PostHog returns it
    terms: string | null;               // JSON array
    insuranceFilter: string | null;     // 'true' | 'false'
    languageFilter: string | null;      // JSON array
    verifiedOnly: string | null;
    noResults: string | null;
}

export interface DayStats {
    impressions: number;
    position_sum: number;
    clicks: number;
    views: number;
    visitors: Set<string>;
    contacts: number;
    contacts_by_method: Rec;
    sources: Rec;
    countries: Rec;
    langs: Rec;
    devices: Rec;
    sections: Rec;
    by_hour: number[];
}

const emptyDay = (): DayStats => ({
    impressions: 0, position_sum: 0, clicks: 0, views: 0, visitors: new Set(), contacts: 0,
    contacts_by_method: {}, sources: {}, countries: {}, langs: {}, devices: {}, sections: {},
    by_hour: new Array(24).fill(0),
});

function bump(rec: Rec, key: string | null | undefined, by = 1): void {
    const k = clean(key) ?? 'unknown';
    rec[k] = (rec[k] ?? 0) + by;
}

/** PostHog hands back '', 'null' or null for a missing property. */
function clean(v: string | null | undefined): string | null {
    if (v == null) return null;
    const s = String(v).trim();
    return s === '' || s === 'null' ? null : s.slice(0, 40);
}

export const utcDay = (unixSec: number): string => new Date(unixSec * 1000).toISOString().slice(0, 10);

/** The hour of day (0–23) on a clinic's own clock. */
const hourFormats = new Map<string, Intl.DateTimeFormat>();
export function localHour(unixSec: number, region: string | undefined): number {
    const tz = region === 'sandiego-tijuana' ? 'America/Tijuana' : 'America/Denver';
    let f = hourFormats.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' });
        hourFormats.set(tz, f);
    }
    const h = Number(f.formatToParts(new Date(unixSec * 1000)).find((p) => p.type === 'hour')?.value);
    return Number.isFinite(h) ? h % 24 : 0;
}

/**
 * Roll events up to one `DayStats` per listing per UTC day, keyed `id|YYYY-MM-DD`.
 * Visits by the listing's own owners are left out: a doctor admiring their own
 * profile is not demand. (Only catches them when signed in, which is the only
 * time we can tell.)
 */
export function aggregateProviderEvents(
    events: readonly ProfileEventRow[],
    impressions: readonly ImpressionRow[],
    opts: {
        fromDay: string;
        toDay: string;
        regionOf: (providerId: string) => string | undefined;
        owners: ReadonlyMap<string, ReadonlySet<string>>;
    },
): Map<string, DayStats> {
    const out = new Map<string, DayStats>();
    const slot = (providerId: string, ts: number): DayStats | null => {
        const day = utcDay(ts);
        if (day < opts.fromDay || day > opts.toDay) return null;
        const key = `${providerId}|${day}`;
        let s = out.get(key);
        if (!s) { s = emptyDay(); out.set(key, s); }
        return s;
    };
    const isOwner = (providerId: string, who: string) => opts.owners.get(providerId)?.has(who) ?? false;

    for (const e of events) {
        const id = e.providerId;
        if (!id || !UUID.test(id) || isOwner(id, e.distinctId)) continue;
        const s = slot(id, e.ts);
        if (!s) continue;
        switch (e.event) {
            case 'provider_viewed':
                s.views += 1;
                s.visitors.add(e.distinctId);
                bump(s.sources, e.channel ?? 'direct');
                bump(s.countries, e.country);
                bump(s.langs, e.lang);
                bump(s.devices, e.device);
                s.by_hour[localHour(e.ts, opts.regionOf(id))] += 1;
                break;
            case 'provider_clicked':
                s.clicks += 1;
                break;
            case 'provider_contact_click':
                s.contacts += 1;
                bump(s.contacts_by_method, e.method ?? 'other');
                break;
            case 'provider_section_viewed':
                bump(s.sections, e.section);
                break;
        }
    }

    for (const row of impressions) {
        if (!row.ids) continue;
        for (const pair of row.ids.split(',')) {
            const [id, pos] = pair.split(':');
            if (!id || !UUID.test(id) || isOwner(id, row.distinctId)) continue;
            const s = slot(id, row.ts);
            if (!s) continue;
            s.impressions += 1;
            const p = Number(pos);
            if (Number.isInteger(p) && p > 0 && p <= 200) s.position_sum += p;
        }
    }
    return out;
}

export interface DemandRow {
    day: string; region: string; specialty: string; kind: 'searches' | 'term' | 'filter';
    key: string; searches: number; no_results: number;
}

const parseList = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
        const v = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 10) : [];
    } catch { return []; }
};

/** Searches → counts per day, region, specialty and kind. */
export function aggregateDemand(
    rows: readonly SearchRow[],
    range: { fromDay: string; toDay: string },
): DemandRow[] {
    const acc = new Map<string, DemandRow>();
    const add = (day: string, region: string, specialty: string, kind: DemandRow['kind'], key: string, none: boolean) => {
        const id = [day, region, specialty, kind, key].join('|');
        const r = acc.get(id) ?? { day, region, specialty, kind, key, searches: 0, no_results: 0 };
        r.searches += 1;
        if (none) r.no_results += 1;
        acc.set(id, r);
    };

    for (const s of rows) {
        const day = utcDay(s.ts);
        const region = clean(s.region);
        if (!region || day < range.fromDay || day > range.toDay) continue;
        const none = clean(s.noResults) === 'true';
        const specs = parseList(s.demandSpecialties);
        const targets = specs.length ? specs : ['_any'];
        const terms = parseList(s.terms);
        const filters: string[] = [];
        if (clean(s.insuranceFilter) === 'true') filters.push('insurance');
        if (parseList(s.languageFilter).length > 0) filters.push('language');
        if (clean(s.verifiedOnly) === 'true') filters.push('verified');

        for (const spec of targets) {
            add(day, region, spec, 'searches', 'all', none);
            for (const t of terms) add(day, region, spec, 'term', t, none);
            for (const f of filters) add(day, region, spec, 'filter', f, none);
        }
    }
    return [...acc.values()];
}

async function syncStats(days: number) {
    const today = utcDay(Date.now() / 1000);
    const fromDay = utcDay((Date.now() - (days - 1) * DAY_MS) / 1000);
    const toExclusive = utcDay((Date.now() + DAY_MS) / 1000);
    const window = `timestamp >= toDateTime('${fromDay} 00:00:00', 'UTC') and timestamp < toDateTime('${toExclusive} 00:00:00', 'UTC')`;

    const [eventRows, impressionRows, searchRows] = await Promise.all([
        hogqlAll(
            `select event, toString(properties.provider_id), distinct_id, toUnixTimestamp(timestamp),
                    toString(properties.method), toString(properties.channel), toString(properties.$geoip_country_code),
                    toString(properties.lang), toString(properties.$device_type), toString(properties.section)
             from events
             where event in ('provider_viewed', 'provider_clicked', 'provider_contact_click', 'provider_section_viewed')
               and ${window}
             order by timestamp, uuid`,
        ),
        hogqlAll(
            `select distinct_id, toUnixTimestamp(timestamp), toString(properties.ids)
             from events where event = 'provider_impressions' and ${window}
             order by timestamp, uuid`,
        ),
        hogqlAll(
            `select toUnixTimestamp(timestamp), toString(properties.region), toString(properties.demand_specialties),
                    toString(properties.terms), toString(properties.insurance_filter),
                    toString(properties.language_filter), toString(properties.verified_only), toString(properties.no_results)
             from events where event = 'search_performed' and ${window}
             order by timestamp, uuid`,
        ),
    ]);

    const events: ProfileEventRow[] = eventRows.map((r) => ({
        event: String(r[0]), providerId: clean(r[1] as string), distinctId: String(r[2]), ts: Number(r[3]),
        method: clean(r[4] as string), channel: clean(r[5] as string), country: clean(r[6] as string),
        lang: clean(r[7] as string), device: clean(r[8] as string), section: clean(r[9] as string),
    }));
    const impressions: ImpressionRow[] = impressionRows.map((r) => ({
        distinctId: String(r[0]), ts: Number(r[1]), ids: (r[2] as string | null) ?? null,
    }));
    const searches: SearchRow[] = searchRows.map((r) => ({
        ts: Number(r[0]), region: r[1] as string | null, demandSpecialties: r[2] as string | null,
        terms: r[3] as string | null, insuranceFilter: r[4] as string | null, languageFilter: r[5] as string | null,
        verifiedOnly: r[6] as string | null, noResults: r[7] as string | null,
    }));

    // Everything needed to interpret the events: which listings they name, who
    // owns those, and which side of the border each is on (for its local clock).
    const ids = new Set<string>();
    for (const e of events) if (e.providerId && UUID.test(e.providerId)) ids.add(e.providerId);
    for (const i of impressions) for (const p of (i.ids ?? '').split(',')) { const id = p.split(':')[0]; if (UUID.test(id)) ids.add(id); }

    const regions = new Map<string, string>();
    const owners = new Map<string, Set<string>>();
    const idList = [...ids];
    for (let i = 0; i < idList.length; i += 100) {
        const chunk = idList.slice(i, i + 100).join(',');
        const [provs, owns] = await Promise.all([
            db<{ id: string; region: string | null }[]>(`providers?select=id,region&id=in.(${chunk})`),
            db<{ provider_id: string; user_id: string }[]>(`provider_owners?select=provider_id,user_id&provider_id=in.(${chunk})`),
        ]);
        for (const p of provs) if (p.region) regions.set(p.id, p.region);
        for (const o of owns) {
            const set = owners.get(o.provider_id) ?? new Set<string>();
            set.add(o.user_id);
            owners.set(o.provider_id, set);
        }
    }

    const perDay = aggregateProviderEvents(events, impressions, {
        fromDay, toDay: today, regionOf: (id) => regions.get(id), owners,
    });
    const statRows = [...perDay.entries()].map(([key, s]) => {
        const [provider_id, day] = key.split('|');
        return {
            provider_id, day,
            impressions: s.impressions, position_sum: s.position_sum, clicks: s.clicks, views: s.views,
            visitors: s.visitors.size, contacts: s.contacts,
            contacts_by_method: s.contacts_by_method, sources: s.sources, countries: s.countries,
            langs: s.langs, devices: s.devices, sections: s.sections, by_hour: s.by_hour,
            updated_at: new Date().toISOString(),
        };
    });
    const demandRows = aggregateDemand(searches, { fromDay, toDay: today });

    await upsert('provider_stats_daily', 'provider_id,day', statRows);
    await upsert('market_demand_daily', 'day,region,specialty,kind,key', demandRows);

    return {
        from: fromDay, to: today, events: events.length, impressionEvents: impressions.length,
        searches: searches.length, listings: ids.size, statRows: statRows.length, demandRows: demandRows.length,
    };
}

// ── PostHog ─────────────────────────────────────────────────────────────────

async function hogql(query: string): Promise<unknown[][]> {
    const key = process.env.POSTHOG_PERSONAL_API_KEY;
    const project = process.env.POSTHOG_PROJECT_ID;
    if (!key || !project) throw new Error('PostHog is not configured (POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID)');
    const host = (process.env.POSTHOG_API_HOST || 'https://us.posthog.com').replace(/\/$/, '');
    const res = await fetch(`${host}/api/projects/${encodeURIComponent(project)}/query/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`posthog ${res.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as { results?: unknown[][] };
    return body.results ?? [];
}

/** Every row of a query, a page at a time (HogQL otherwise stops at 100). */
async function hogqlAll(query: string): Promise<unknown[][]> {
    const all: unknown[][] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
        const rows = await hogql(`${query} limit ${PAGE} offset ${page * PAGE}`);
        all.push(...rows);
        if (rows.length < PAGE) return all;
    }
    console.error('[stats] stopped at the page cap; some events were not counted');
    return all;
}

// ── 2. Report emails ────────────────────────────────────────────────────────

interface Recipient {
    user_id: string; email: string; lang: Lang; token: string;
    provider_id: string; provider_name: string; tier: 'basic' | 'promoted' | 'featured';
}

/** The slice of `provider_stats_payload` the emails read. */
export interface StatsPayload {
    tier: 'basic' | 'promoted' | 'featured';
    ready: boolean;
    views_30d?: number;
    totals?: { impressions: number; avg_position: number | null; clicks: number; views: number; visitors: number; contacts: number; inquiries: number };
    prev?: { views: number; contacts: number };
    prev_complete?: boolean;
    contacts_by_method?: Rec;
    sources?: Rec;
    plan_lift?: { since: string; before_per_day: number; after_per_day: number } | null;
    daily?: { day: string; views: number; contacts: number }[];
    by_hour?: number[];
    benchmark?: { percentile: number; peers: number } | null;
}

/** ISO week key, e.g. 2026-W46. */
export function isoWeek(d: Date): string {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((t.getTime() - yearStart) / DAY_MS + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function sendReports(now: Date, dry: boolean) {
    const monthly = now.getUTCDate() === 1;
    const weekly = now.getUTCDay() === 1;
    const team = await chaseInquiries(dry);

    if (!monthly && !weekly) return { monthly, weekly, sent: 0, skipped: 0, team };

    const recipients = await rpc<Recipient[]>('stats_report_recipients', {});
    const monthKey = now.toISOString().slice(0, 7);
    const weekKey = isoWeek(now);

    // One payload per listing, however many owners it has.
    const payloads = new Map<string, StatsPayload>();
    const slots = new Map<string, boolean>();
    const mails: Mail[] = [];
    const plan: { listing: string; kind: string; to: string }[] = [];
    let skipped = 0;

    for (const r of recipients) {
        // Featured gets the weekly digest; everyone else the monthly report.
        const kind = r.tier === 'featured' ? 'weekly' : 'monthly';
        if (kind === 'weekly' ? !weekly : !monthly) continue;
        const period = kind === 'weekly' ? weekKey : monthKey;

        let stats = payloads.get(r.provider_id);
        if (!stats) {
            stats = await rpc<StatsPayload>('provider_stats_payload', { p_provider: r.provider_id });
            payloads.set(r.provider_id, stats);
        }
        if (!stats.ready || !(stats.views_30d && stats.views_30d > 0)) { skipped++; continue; }

        // Claim the slot first: a second cron run the same day finds it taken and
        // sends nothing. The first owner of a listing creates the claim; its other
        // owners ride on it, so everyone who should get this report gets it once.
        if (!dry) {
            const key = `${r.provider_id}|${kind}|${period}`;
            let mine = slots.get(key);
            if (mine === undefined) {
                const rows = await db<unknown[]>('stats_email_log?on_conflict=provider_id,kind,period', {
                    method: 'POST',
                    prefer: 'resolution=ignore-duplicates,return=representation',
                    body: JSON.stringify({ provider_id: r.provider_id, kind, period }),
                });
                mine = (rows?.length ?? 0) > 0;
                slots.set(key, mine);
            }
            if (!mine) { skipped++; continue; }
        }

        const mail = reportMail(r, stats, kind);
        plan.push({ listing: r.provider_name, kind, to: r.email });
        mails.push(mail);
    }

    const sent = dry ? 0 : await sendMail(mails);
    return { monthly, weekly, sent, skipped, would: dry ? plan : undefined, team };
}

/**
 * Tell the team about a patient who wrote in and has not been answered. The
 * clinic is contacted on the patient's behalf (api/inquiry.ts), so the thing to
 * chase is the team's own queue, not the doctor.
 */
async function chaseInquiries(dry: boolean) {
    const to = process.env.LEAD_NOTIFY_TO;
    const now = Date.now();
    const rows = await db<{ id: string; provider_name: string | null; created_at: string }[]>(
        `patient_inquiries?select=id,provider_name,created_at&status=eq.new`
        + `&created_at=lt.${new Date(now - DAY_MS).toISOString()}&created_at=gt.${new Date(now - 7 * DAY_MS).toISOString()}`
        + `&order=created_at.asc&limit=50`,
    );
    if (rows.length === 0 || !to || dry) return { waiting: rows.length, emailed: false };

    const list = rows.map((r) => {
        const hours = Math.round((now - Date.parse(r.created_at)) / 36e5);
        return `${r.provider_name ?? 'A clinic'} — ${hours}h`;
    });
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.LEAD_NOTIFY_FROM;
    if (!apiKey || !from) return { waiting: rows.length, emailed: false };

    const body = `${rows.length} patient ${rows.length === 1 ? 'inquiry has' : 'inquiries have'} been waiting over a day with no one marked as contacted:\n\n${list.join('\n')}\n\nSet each to "contacted" in the admin once the clinic has been reached.`;
    const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from, to: to.split(',').map((x) => x.trim()),
            subject: `${rows.length} patient ${rows.length === 1 ? 'inquiry is' : 'inquiries are'} waiting`,
            text: body,
        }),
    });
    return { waiting: rows.length, emailed: r.ok };
}

// ── Email content ───────────────────────────────────────────────────────────

interface Mail { to: string; subject: string; html: string; text: string; unsubscribeUrl: string }

const CHANNEL: Record<string, Record<Lang, string>> = {
    search: { en: 'search engines', es: 'buscadores' },
    ai: { en: 'AI assistants', es: 'asistentes de IA' },
    social: { en: 'social media', es: 'redes sociales' },
    whatsapp: { en: 'WhatsApp', es: 'WhatsApp' },
    email: { en: 'email', es: 'correo' },
    paid: { en: 'ads', es: 'anuncios' },
    referral: { en: 'other websites', es: 'otros sitios' },
    direct: { en: 'direct visits', es: 'visitas directas' },
    internal: { en: 'direct visits', es: 'visitas directas' },
    unknown: { en: 'other', es: 'otros' },
};
const METHOD: Record<string, Record<Lang, string>> = {
    phone: { en: 'calls', es: 'llamadas' },
    whatsapp: { en: 'WhatsApp taps', es: 'toques en WhatsApp' },
    email: { en: 'emails', es: 'correos' },
    website: { en: 'website visits', es: 'visitas a tu sitio' },
    directions: { en: 'direction requests', es: 'solicitudes de ruta' },
    social: { en: 'social profile visits', es: 'visitas a tus redes' },
    other: { en: 'other', es: 'otros' },
};
const DAYS: Record<Lang, string[]> = {
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    es: ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'],
};

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const entries = (rec: Rec | undefined) => Object.entries(rec ?? {}).sort((a, b) => b[1] - a[1]);

/** "up 12%" / "down 8%" against the previous period, or null when there is nothing to compare. */
function change(now: number, before: number, lang: Lang): string | null {
    if (before <= 0) return null;
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return lang === 'es' ? 'igual que antes' : 'the same as before';
    return lang === 'es' ? `${pct > 0 ? 'subió' : 'bajó'} ${Math.abs(pct)}%` : `${pct > 0 ? 'up' : 'down'} ${Math.abs(pct)}%`;
}

/** Build one doctor's email. Exported for the self-test. */
export function reportMail(r: Recipient, s: StatsPayload, kind: 'monthly' | 'weekly'): Mail {
    const lang = r.lang;
    const es = lang === 'es';
    const fmt = (n: number) => n.toLocaleString(es ? 'es-MX' : 'en-US');
    const lines: string[] = [];   // plain-text/HTML paragraphs, in order
    let subject: string;
    let heading: string;
    let ctaLabel = es ? 'Ver tu panel' : 'Open your dashboard';
    let ctaPath = '/dashboard';

    if (kind === 'weekly' && s.daily) {
        const last = s.daily.slice(-7);
        const before = s.daily.slice(-14, -7);
        const views = sum(last.map((d) => d.views));
        const contacts = sum(last.map((d) => d.contacts));
        const delta = before.length >= 7 ? change(views, sum(before.map((d) => d.views)), lang) : null;
        subject = es ? `${fmt(views)} personas vieron tu perfil esta semana` : `${fmt(views)} people viewed your profile this week`;
        heading = es ? 'Tu semana en MedSociety' : 'Your week on MedSociety';
        lines.push(es
            ? `${r.provider_name}: ${fmt(views)} vistas de perfil${delta ? ` (${delta})` : ''} y ${fmt(contacts)} contactos en los últimos 7 días.`
            : `${r.provider_name}: ${fmt(views)} profile views${delta ? ` (${delta})` : ''} and ${fmt(contacts)} contacts in the last 7 days.`);
        const top = entries(s.sources)[0];
        if (top) {
            const label = (CHANNEL[top[0]] ?? CHANNEL.unknown)[lang];
            lines.push(es ? `Más visitas vinieron de: ${label}.` : `Most visitors came from: ${label}.`);
        }
        const best = last.reduce((m, d) => (d.views > m.views ? d : m), last[0]);
        if (best && best.views > 0) {
            const weekday = DAYS[lang][new Date(`${best.day}T12:00:00Z`).getUTCDay()];
            lines.push(es ? `Tu mejor día fue el ${weekday}, con ${fmt(best.views)} vistas.` : `Your best day was ${weekday}, with ${fmt(best.views)} views.`);
        }
        const hours = s.by_hour ?? [];
        if (hours.length === 24 && sum(hours) > 0) {
            const peak = hours.indexOf(Math.max(...hours));
            lines.push(es ? `Tu hora más activa es alrededor de las ${peak}:00.` : `Your busiest hour is around ${peak}:00.`);
        }
        if (s.benchmark) {
            lines.push(es
                ? `Superas al ${s.benchmark.percentile}% de ${s.benchmark.peers} perfiles de tu especialidad en tu región.`
                : `You are ahead of ${s.benchmark.percentile}% of ${s.benchmark.peers} profiles in your specialty and region.`);
        }
    } else if (s.tier === 'basic' || !s.totals) {
        const views = s.views_30d ?? 0;
        subject = es ? `${fmt(views)} personas vieron tu perfil en el último mes` : `${fmt(views)} people viewed your profile in the last month`;
        heading = es ? 'Tu perfil en MedSociety' : 'Your profile on MedSociety';
        lines.push(es
            ? `${r.provider_name} tuvo ${fmt(views)} vistas de perfil en los últimos 30 días.`
            : `${r.provider_name} had ${fmt(views)} profile views in the last 30 days.`);
        lines.push(es
            ? 'Con el plan Promoted ves además cuántas personas te contactaron, por qué medio, y de dónde llegaron.'
            : 'With the Promoted plan you also see how many people contacted you, how, and where they came from.');
        ctaLabel = es ? 'Ver planes' : 'See the plans';
        ctaPath = '/dashboard?tab=plan';
    } else {
        const t = s.totals;
        const delta = s.prev_complete && s.prev ? change(t.views, s.prev.views, lang) : null;
        subject = es ? `Tu reporte mensual: ${fmt(t.views)} vistas de perfil` : `Your monthly report: ${fmt(t.views)} profile views`;
        heading = es ? 'Tu reporte mensual' : 'Your monthly report';
        lines.push(es
            ? `${r.provider_name}, últimos 30 días: ${fmt(t.views)} vistas${delta ? ` (${delta} frente al mes anterior)` : ''}, ${fmt(t.contacts)} contactos y ${fmt(t.inquiries)} consultas de pacientes.`
            : `${r.provider_name}, last 30 days: ${fmt(t.views)} views${delta ? ` (${delta} vs the month before)` : ''}, ${fmt(t.contacts)} contacts and ${fmt(t.inquiries)} patient inquiries.`);
        const methods = entries(s.contacts_by_method).slice(0, 3)
            .map(([k, n]) => `${fmt(n)} ${(METHOD[k] ?? METHOD.other)[lang]}`);
        if (methods.length) lines.push(es ? `Contactos: ${methods.join(', ')}.` : `Contacts: ${methods.join(', ')}.`);
        const sources = entries(s.sources).slice(0, 3)
            .map(([k, n]) => `${(CHANNEL[k] ?? CHANNEL.unknown)[lang]} (${fmt(n)})`);
        if (sources.length) lines.push(es ? `De dónde llegaron: ${sources.join(', ')}.` : `Where they came from: ${sources.join(', ')}.`);
        if (s.plan_lift && s.plan_lift.before_per_day > 0) {
            lines.push(es
                ? `Desde que tienes el plan: ${s.plan_lift.after_per_day} vistas por día, antes ${s.plan_lift.before_per_day}.`
                : `Since you joined the plan: ${s.plan_lift.after_per_day} views a day, up from ${s.plan_lift.before_per_day}.`);
        }
    }

    const unsubscribeUrl = `${SITE}/api/forum-notify?job=unsubscribe&t=${encodeURIComponent(r.token)}&k=reports`;
    const footer = es
        ? 'Recibes esto porque administras un perfil en MedSociety.'
        : 'You get this because you manage a listing on MedSociety.';
    const unsub = es ? 'Cancelar suscripción' : 'Unsubscribe';
    const cta = `${SITE}${ctaPath}`;

    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f6f5;padding:24px 12px">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #d6d6d3;border-radius:14px;padding:28px 26px;font:15px/1.6 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#14161a">
<p style="margin:0 0 20px;font:600 15px Georgia,serif;letter-spacing:.01em">Med<span style="color:#0f6b52">Society</span></p>
<h1 style="margin:0 0 16px;font:700 21px/1.3 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${esc(heading)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px">${esc(l)}</p>`).join('\n')}
<p style="margin:24px 0 4px"><a href="${esc(cta)}" style="display:inline-block;background:#1b1d22;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:100px">${esc(ctaLabel)} &rarr;</a></p>
</div>
<p style="max-width:560px;margin:14px auto 0;font:12px/1.5 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#6d7178;text-align:center">${esc(footer)}<br><a href="${esc(unsubscribeUrl)}" style="color:#6d7178">${unsub}</a></p>
</body></html>`;
    const text = `${heading}\n\n${lines.join('\n\n')}\n\n${ctaLabel}: ${cta}\n\n—\n${footer}\n${unsub}: ${unsubscribeUrl}`;
    return { to: r.email, subject, html, text, unsubscribeUrl };
}

async function sendMail(mails: Mail[]): Promise<number> {
    if (mails.length === 0) return 0;
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.STATS_NOTIFY_FROM || process.env.FORUM_NOTIFY_FROM || process.env.LEAD_NOTIFY_FROM;
    if (!apiKey || !from) throw new Error('Email is not configured (RESEND_API_KEY, STATS_NOTIFY_FROM)');

    const toPayload = (m: Mail) => ({
        from, to: [m.to], subject: m.subject, html: m.html, text: m.text,
        headers: {
            'List-Unsubscribe': `<${m.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
    });
    const post = (path: string, body: unknown) => fetch(`https://api.resend.com/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    let sent = 0;
    for (let i = 0; i < mails.length; i += 100) {
        const chunk = mails.slice(i, i + 100);
        const res = await post('emails/batch', chunk.map(toPayload));
        if (res.ok) { sent += chunk.length; continue; }
        console.error('[stats-mail] batch failed:', res.status, (await res.text()).slice(0, 300));
        for (const m of chunk) {
            const one = await post('emails', toPayload(m));
            if (one.ok) sent += 1;
            else console.error('[stats-mail] send failed:', one.status, (await one.text()).slice(0, 200));
        }
    }
    return sent;
}

// ── Plumbing ────────────────────────────────────────────────────────────────

function esc(value: unknown): string {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
    const n = Number(raw);
    return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function secretMatches(provided: string, expected: string): boolean {
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

function supabaseEnv() {
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (!url || !key) throw new Error('Supabase service credentials are not configured');
    return { url, key };
}

/** A REST call as the service role. Throws on a non-2xx with the body text. */
async function db<T = unknown>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
    const { url, key } = supabaseEnv();
    const res = await fetch(`${url}/rest/v1/${path}`, {
        ...init,
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`supabase ${res.status} ${path.split('?')[0]}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : null) as T;
}

function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    return db<T>(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

/** Insert-or-replace in chunks, on the given conflict columns. */
async function upsert(table: string, onConflict: string, rows: readonly object[]): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
        await db(`${table}?on_conflict=${onConflict}`, {
            method: 'POST',
            prefer: 'resolution=merge-duplicates,return=minimal',
            body: JSON.stringify(rows.slice(i, i + 500)),
        });
    }
}

export const config = { maxDuration: 60 };
