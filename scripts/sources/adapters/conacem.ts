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

async function collect(): Promise<Collected> {
    const runs = LOOKUP_FROM.map((slug) => lastGoodRun(slug)).filter((r): r is NonNullable<typeof r> => !!r);
    if (!runs.length) throw new Error(`no good run yet for ${LOOKUP_FROM.join(' or ')}: nothing to look up`);
    const lookups = lookupsFrom(runs);

    const open = await openBrowser(conacem.permission);
    try {
        const page = await open.context.newPage();
        await pace();
        const landing = await page.goto(`${ORIGIN}/buscador`, { waitUntil: 'networkidle', timeout: 90_000 });
        if (landing?.status() !== 200) throw new Error(`CONACEM search page answered HTTP ${landing?.status()}`);

        const entries: CollectedEntry[] = [];
        const reasons: string[] = [];
        let withResults = 0, capped = 0, failed = 0;
        for (const [query, region] of lookups) {
            let cursor = 0;
            let found = 0;
            for (let p = 0; p < MAX_PAGES; p++) {
                await pace();
                const res = await page.evaluate(async (path) => {
                    const r = await fetch(path);
                    return { status: r.status, body: r.status === 200 ? await r.json() : null };
                }, apiPath(query, cursor));
                if (res.status === 403) throw new Error('CONACEM refused a lookup (HTTP 403); stopping the run');
                if (res.status !== 200 || !res.body) { failed++; break; }
                const body = res.body as ConacemPage;
                const observedAt = new Date().toISOString();
                for (const r of body.especialistas) entries.push({ ...toEntry(r, region, query), observedAt });
                found += body.especialistas.length;
                if (!body.hay_siguiente || !body.id_ultimo) break;
                cursor = body.id_ultimo;
                if (p === MAX_PAGES - 1) capped++;
            }
            if (found) withResults++;
        }
        if (failed > lookups.size / 2) reasons.push(`${failed} of ${lookups.size} lookups failed`);
        return {
            targets: [{
                key: 'lookups', url: `${ORIGIN}/buscador`, ok: true, noBaseline: true,
                count: new Set(entries.map((e) => e.externalId)).size, fetchedAt: new Date().toISOString(),
                detail: { lookups: lookups.size, withResults, failed, stoppedAtPageLimit: capped },
            }],
            entries,
            reasons,
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
