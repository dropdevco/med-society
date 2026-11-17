/**
 * CONACEM: the national register of specialty board certifications (every
 * consejo). Its search needs a doctor's name, so this is a lookup source: it
 * asks CONACEM about every doctor the hospital sources list, by their two
 * surnames, and keeps every certificate returned (name split into given name
 * and surnames, consejo, specialty, valid from/to, certificate number).
 *
 * CONACEM's firewall refuses non-browser clients and its robots.txt can't be
 * read. Its written permission lets us get the data by whatever means works,
 * so this uses a real browser with a standard identity, still sending
 * an `X-Client: MedSocietyBot` header, and calls the same JSON endpoint its own search page
 * calls. Source notes: docs/sources/conacem.md
 *
 * CONACEM limits queries ("Demasiadas consultas"): at the first 429 the run
 * stops asking and the next run picks up. Answers are kept for 30 days, so a
 * doctor is asked about once a month, not every week; certifications last 5 years.
 */
import { openBrowser, pace } from '../lib/browser';
import { lastGoodRun } from '../lib/snapshot';
import type { Collected, CollectedEntry, RegionId, SourceAdapter, SourceEntry } from '../lib/types';

const ORIGIN = 'https://conacem.org.mx';
/** consejo 0 = every consejo; "vacio" = any specialty; cursor 0 = first page. */
export const apiPath = (query: string, cursor = 0) => `/api/buscador/medico-especialista/0/vacio/${cursor}/next/${encodeURIComponent(query)}`;
/** Sources whose doctors we look up. */
export const LOOKUP_FROM = ['hospital-angeles', 'starmedica'];
const MAX_PAGES = 3;
export const REFRESH_DAYS = 30;

export interface ConacemRecord {
    id: number;
    titulo: string | null;
    nombre: string;
    paterno: string;
    materno: string | null;
    consejo: string;
    especialidad: string;
    inicio: string | null;
    fin: string | null;
    numero_certificado: string | null;
    libro: string | null;
    foja: string | null;
}
export interface ConacemPage {
    especialistas: ConacemRecord[];
    hay_siguiente: boolean;
    id_ultimo: number | null;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const TITLE = /^(dra?|lic|psic|mtr[oa]|enf)\.?\s+/i;

/**
 * The two surnames, accents removed (CONACEM's search ignores accents and case).
 * Mexican names end in paternal + maternal surname; "de la Prueba Núñez" → "Prueba Nunez",
 * which still matches "de la Prueba Nunez" there. Two-word names are searched whole.
 */
export function surnameQuery(fullName: string): string | null {
    const words = plain(clean(fullName).replace(TITLE, '')).split(' ').filter((w) => /[a-z]/i.test(w));
    if (words.length < 2) return null;
    return (words.length === 2 ? words : words.slice(-2)).join(' ');
}

export function toEntry(r: ConacemRecord, region: RegionId, query: string): SourceEntry {
    return {
        externalId: String(r.id),
        name: clean([r.nombre, r.paterno, r.materno].filter(Boolean).join(' ')),
        title: clean(r.titulo) || null,
        specialties: [clean(r.especialidad)].filter(Boolean),
        cedulas: [], // CONACEM publishes certificate numbers, not cédulas
        sites: [],
        region,
        url: `${ORIGIN}/buscador`,
        photoUrl: null,
        extra: {
            given: clean(r.nombre), paterno: clean(r.paterno), materno: clean(r.materno) || null,
            consejo: clean(r.consejo), certificate: r.numero_certificado, validFrom: r.inicio, validTo: r.fin,
            book: r.libro, page: r.foja, query,
        },
    };
}

/** One lookup per distinct surname pair among the hospital sources' last good runs. */
export function lookupsFrom(sources: { entries: { name: string; region: RegionId }[] }[]): Map<string, RegionId> {
    const out = new Map<string, RegionId>();
    for (const s of sources) for (const e of s.entries) {
        const q = surnameQuery(e.name);
        if (q && !out.has(q.toLowerCase())) out.set(q.toLowerCase(), e.region);
    }
    return out;
}

/**
 * What is due this run. A question answered in the last 30 days is skipped and
 * its certificates are carried over untouched; everything else is asked.
 */
export function planLookups(wanted: Map<string, RegionId>, previous: { lookups?: Record<string, string>; entries: CollectedEntry[] } | null, now: number) {
    const answered: Record<string, string> = { ...(previous?.lookups ?? {}) };
    // Runs from before the log existed: a question with certificates was answered when they were seen.
    if (previous && !previous.lookups) {
        for (const e of previous.entries) {
            const q = e.extra?.query;
            if (typeof q === 'string' && !answered[q]) answered[q] = e.observedAt;
        }
    }
    const fresh = (q: string) => !!answered[q] && now - Date.parse(answered[q]) < REFRESH_DAYS * 86_400_000;
    return {
        due: [...wanted].filter(([q]) => !fresh(q)),
        carried: (previous?.entries ?? []).filter((e) => { const q = e.extra?.query; return typeof q === 'string' && wanted.has(q) && fresh(q); }),
        answered,
    };
}

async function collect(): Promise<Collected> {
    const runs = LOOKUP_FROM.map((slug) => lastGoodRun(slug)).filter((r): r is NonNullable<typeof r> => !!r);
    if (!runs.length) throw new Error(`no good run yet for ${LOOKUP_FROM.join(' or ')}: nothing to look up`);
    const wanted = lookupsFrom(runs);
    const { due, carried, answered } = planLookups(wanted, lastGoodRun('conacem'), Date.now());

    const open = await openBrowser(conacem.permission);
    try {
        const page = await open.context.newPage();
        await pace();
        const landing = await page.goto(`${ORIGIN}/buscador`, { waitUntil: 'networkidle', timeout: 90_000 });
        if (landing?.status() !== 200) throw new Error(`CONACEM search page answered HTTP ${landing?.status()}`);

        const entries: CollectedEntry[] = [...carried];
        const reasons: string[] = [];
        const statuses: Record<string, number> = {};
        let asked = 0, withResults = 0, capped = 0, failed = 0, limited = false;
        for (const [query, region] of due) {
            let cursor = 0;
            let found = 0;
            let ok = true;
            for (let p = 0; p < MAX_PAGES; p++) {
                await pace();
                const res = await page.evaluate(async (path) => {
                    const r = await fetch(path);
                    return { status: r.status, body: r.status === 200 ? await r.json() : null };
                }, apiPath(query, cursor));
                statuses[res.status] = (statuses[res.status] ?? 0) + 1;
                if (res.status === 403) throw new Error('CONACEM refused a lookup (HTTP 403); stopping the run');
                if (res.status === 429) { limited = true; ok = false; break; }
                if (res.status !== 200 || !res.body) { failed++; ok = false; break; }
                const body = res.body as ConacemPage;
                const observedAt = new Date().toISOString();
                for (const r of body.especialistas) entries.push({ ...toEntry(r, region, query), observedAt });
                found += body.especialistas.length;
                if (!body.hay_siguiente || !body.id_ultimo) break;
                cursor = body.id_ultimo;
                if (p === MAX_PAGES - 1) capped++;
            }
            if (limited) break; // their limit: stop asking, the next run picks up
            if (ok) { asked++; answered[query] = new Date().toISOString(); }
            if (found) withResults++;
        }
        const left = due.length - asked - failed;
        if (limited && asked === 0) reasons.push('CONACEM is limiting queries (HTTP 429) and answered none this run');
        if (failed > due.length / 2) reasons.push(`${failed} of ${due.length} lookups failed`);
        return {
            targets: [{
                key: 'lookups', url: `${ORIGIN}/buscador`, ok: true, noBaseline: true,
                count: new Set(entries.map((e) => e.externalId)).size, fetchedAt: new Date().toISOString(),
                detail: { doctorsToCheck: wanted.size, askedThisRun: asked, withResults, carriedFromEarlierRuns: wanted.size - due.length, leftForNextRun: left, failed, stoppedAtPageLimit: capped, ...Object.fromEntries(Object.entries(statuses).map(([k, v]) => [`http${k}`, v])) },
            }],
            entries,
            reasons,
            lookups: answered,
        };
    } finally {
        await open.close();
    }
}

export const conacem: SourceAdapter = {
    slug: 'conacem',
    name: 'CONACEM',
    kind: 'consejo',
    access: 'permission',
    permission: {
        grantedOn: '2026-11-04',
        scope: 'Display the certified-specialist data, obtained by whatever means works (CONACEM will not change its site or add an API)',
        conditions: 'As recorded from the team on 4 Nov 2026; check against the signed letter',
        reference: 'Signed letter in the team vault; see docs/sources/README.md',
        waives: ['robots', 'block'],
    },
    targets: [{ key: 'lookups', label: 'CONACEM certified specialists', url: `${ORIGIN}/buscador`, region: 'elpaso-juarez' }],
    collect,
};
