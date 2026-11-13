/**
 * Baja California's Padrón Estatal de Salud (bajahealthtourism.com): the state's
 * public catalog. Its residences category holds the recovery centers. Each has a
 * page that shows its REPSSABI number and expiry, so the page is also the proof
 * for the COEPRIS badge. Server-rendered: one list page, then one page per record.
 * Source notes: docs/sources/padron-salud-bc.md
 */
import * as cheerio from 'cheerio';
import { politeGet } from '../lib/http';
import type { Collected, CollectedEntry, SourceAdapter, SourceEntry } from '../lib/types';

const ORIGIN = 'https://bajahealthtourism.com';
/** The site's own spelling of the category. */
const LIST_URL = `${ORIGIN}/catalogo?tipo=assiting-living`;
const OUTSIDE_OUR_AREA = /\b(Mexicali|Ensenada|San Quint[ií]n)\b/i;

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** "03/09/2028" → "2028-09-03". Null for anything else: a bad date never reaches the badge. */
export function dmyToIso(s: string): string | null {
    const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function parseList(html: string): string[] {
    const $ = cheerio.load(html);
    const slugs = new Set<string>();
    $('a[href*="/catalogo/"]').each((_, a) => {
        const slug = ($(a).attr('href') ?? '').match(/\/catalogo\/([a-z0-9-]+)\/?$/i)?.[1];
        if (slug) slugs.add(slug);
    });
    return [...slugs];
}

/** One record's page. Null for a page outside our regions or without a name. */
export function parseDetail(html: string, slug: string): SourceEntry | null {
    const $ = cheerio.load(html);
    const name = clean($('h1.dp-name').first().text());
    if (!name) return null;
    const address = clean($('.dp-loc span').first().text()) || null;
    if (address && OUTSIDE_OUR_AREA.test(address)) return null;

    // The "Registros y Vigencias" block: one row per register.
    const row = $('p').filter((_, p) => /^Repssabi\b/i.test(clean($(p).text()))).first().parent();
    // Line by line: joined text would run "Vigente" into "No." when the page has no space between them.
    const text = row.find('p').map((__, p) => clean($(p).text())).get().join(' ');
    const register = text.match(/No\.\s*(\d+)/)?.[1] ?? null;
    const current = /(?<!no\s)\bvigente\b/i.test(text);
    const expiry = text.match(/Vigencia:\s*(\d{2}\/\d{2}\/\d{4})/)?.[1] ?? null;

    return {
        externalId: slug,
        name,
        title: null,
        specialties: [],
        cedulas: [],
        sites: [{ name, address, tower: null, office: null }],
        region: 'sandiego-tijuana',
        url: `${ORIGIN}/catalogo/${slug}`,
        photoUrl: null,
        extra: {
            label: 'Padrón Estatal de Salud',
            register,
            // The expiry applies while the state shows it current; a badge must not outlive it.
            validTo: current && expiry ? dmyToIso(expiry) : null,
        },
    };
}

async function collect(): Promise<Collected> {
    const list = await politeGet(LIST_URL);
    const slugs = parseList(list.body);
    const entries: CollectedEntry[] = [];
    const reasons: string[] = [];
    for (const slug of slugs) {
        const page = await politeGet(`${ORIGIN}/catalogo/${slug}`);
        const observedAt = new Date().toISOString();
        const entry = parseDetail(page.body, slug);
        if (entry) entries.push({ ...entry, observedAt });
    }
    if (slugs.length && !entries.length) reasons.push('no record page could be read (layout change?)');
    return { targets: [{ key: 'residences', url: LIST_URL, ok: true, count: entries.length, fetchedAt: new Date().toISOString() }], entries, reasons };
}

export const padronSaludBc: SourceAdapter = {
    slug: 'padron-salud-bc',
    name: 'Padrón Estatal de Salud',
    kind: 'regulator',
    entity: 'facility',
    access: 'open',
    targets: [{ key: 'residences', label: 'Residences and recovery centers', url: LIST_URL, region: 'sandiego-tijuana' }],
    collect,
};
