/**
 * Global Healthcare Accreditation (GHA): every organization it accredits or
 * certifies, worldwide. One Webflow page holds them all, one tab per program
 * (hospitals, clinics, facilitators, hotels and resorts). An organization in two
 * tabs is one record with both programs.
 * Written permission, 21 Nov 2026 (docs/sources/README.md). Notes: docs/sources/gha.md
 */
import { englishDateToIso, normalizeCountry, regionOf, slugify } from '../lib/places';
import type { SourceAdapter, SourceEntry } from '../lib/types';

export const GHA_PAGE = 'https://www.globalhealthcareaccreditation.com/accredited-and-certified-organizations-healthcare-providers-and-hotels';

/** Webflow shows at most 100 items in a list without paging; a full list means records are cut off. */
const WEBFLOW_LIST_CAP = 100;

const decode = (s: string) => s
    .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const text = (html: string) => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

interface Program { program: string; since: string | null; until: string | null; category: string }

const DATE = String.raw`[A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}`;
/**
 * The date lines GHA prints under a seal: "Since September 20, 2017", "Accredited Since
 * December 10, 2024", or a term "September 18, 2017 – September 18, 2020".
 */
export function readTerm(s: string): { since: string | null; until: string | null } | null {
    const range = new RegExp(`^(?:(?:[A-Za-z]+\\s+)?Since\\s+)?(${DATE})\\s*[–—-]\\s*(${DATE})$`, 'i').exec(s);
    if (range) return { since: englishDateToIso(range[1]), until: englishDateToIso(range[2]) };
    const since = new RegExp(`^(?:[A-Za-z]+\\s+)?Since\\s+(${DATE})$`, 'i').exec(s);
    if (since) return { since: englishDateToIso(since[1]), until: null };
    const bare = new RegExp(`^${DATE}$`).exec(s);
    if (bare) return { since: englishDateToIso(s), until: null };
    return null;
}

/** "Tab 2" → "Medical Travel Accreditation", from the tab menu. */
function tabNames(html: string): Map<string, string> {
    const names = new Map<string, string>();
    for (const a of html.matchAll(/<a\b[^>]*\bw-tab-link\b[^>]*>[\s\S]*?<\/a>/g)) {
        const tab = /data-w-tab="([^"]+)"/.exec(a[0])?.[1];
        // The first tab's label is a bare <div>; the others have class="tab-description".
        const label = text(a[0]);
        if (tab && label) names.set(tab, label);
    }
    return names;
}

/** The seals on a card: each program, with the date it was granted. */
function programsOf(card: string, category: string): Program[] {
    const start = card.indexOf('seals-container-main');
    const end = card.indexOf('journal-card-description', start);
    if (start < 0) return [];
    const seals = card.slice(start, end > start ? end : undefined);
    const out: Program[] = [];
    for (const p of seals.matchAll(/class="gha-new-paragraph[^"]*"[^>]*>([\s\S]*?)<\/div>/g)) {
        const t = text(p[1]);
        if (!t) continue;
        const term = readTerm(t);
        if (term) {
            const last = out[out.length - 1];
            if (last && !last.since) Object.assign(last, term);
            // A seal with its name left blank still has its term; the tab names the program.
            else out.push({ program: category, ...term, category });
        } else {
            out.push({ program: t, since: null, until: null, category });
        }
    }
    return out;
}

const field = (card: string, cls: string) => {
    const m = new RegExp(`class="address-container ${cls}"[^>]*>\\s*<(?:div|a)[^>]*?(?:href="([^"]*)")?[^>]*>([\\s\\S]*?)</(?:div|a)>`).exec(card);
    return m ? (m[1] ? decode(m[1]) : text(m[2])) || null : null;
};

/** Country and city: the plain address box reads "Thailand | Bangkok". */
function countryAndCity(card: string): [string | null, string | null] {
    // The box ends at "</div></div>": the last cell's own closing tag plus the box's.
    const m = /class="address-container"[^>]*>([\s\S]*?<\/div>)\s*<\/div>/.exec(card);
    if (!m) return [null, null];
    const parts = [...m[1].matchAll(/<div[^>]*>([\s\S]*?)<\/div>/g)].map((x) => text(x[1])).filter((x) => x && x !== '|');
    return [parts[0] ?? null, parts[1] ?? null];
}

export function parseDirectory(html: string, pageUrl = GHA_PAGE): SourceEntry[] {
    if (/w-pagination-next/.test(html)) throw new Error('a GHA list is paged now; this adapter reads one page (format change)');
    const names = tabNames(html);
    const byId = new Map<string, { entry: SourceEntry; programs: Program[] }>();

    const panes = html.split(/(?=<div\b[^>]*\bclass="w-tab-pane\b)/).slice(1);
    if (!panes.length) throw new Error('no program tabs on the GHA page (format change?)');
    for (const pane of panes) {
        const tab = /data-w-tab="([^"]+)"/.exec(pane.slice(0, 300))?.[1] ?? '';
        const category = names.get(tab) ?? tab;
        const cards = pane.split('role="listitem"').slice(1);
        if (cards.length >= WEBFLOW_LIST_CAP) throw new Error(`"${category}" shows ${cards.length} organizations, Webflow's page limit: some may be cut off`);
        for (const card of cards) {
            const h2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(card);
            const name = h2 ? text(h2[1]) : '';
            if (!name) continue; // an empty template slot
            const [rawCountry, city] = countryAndCity(card);
            const country = normalizeCountry(rawCountry);
            const id = slugify(name);
            const programs = programsOf(card, category);
            const seen = byId.get(id);
            if (seen) {
                for (const p of programs) if (!seen.programs.some((q) => q.program === p.program)) seen.programs.push(p);
                continue;
            }
            byId.set(id, {
                programs,
                entry: {
                    externalId: id,
                    name,
                    title: null,
                    specialties: [],
                    cedulas: [],
                    sites: [{ name, address: field(card, 'location'), tower: null, office: null }],
                    region: regionOf(country, city),
                    url: pageUrl,
                    photoUrl: null,
                    extra: {
                        country,
                        city,
                        languages: field(card, 'language'),
                        website: field(card, 'website'),
                    },
                },
            });
        }
    }

    return [...byId.values()].map(({ entry, programs }) => {
        const dated = programs.filter((p) => p.since).sort((a, b) => a.since!.localeCompare(b.since!));
        // Valid until the last term ends; a program with no end date keeps it open.
        const ends = programs.map((p) => p.until);
        const validTo = ends.length && ends.every((u) => u) ? (ends as string[]).sort().at(-1)! : null;
        const term = (p: Program) => (p.since && p.until ? ` (${p.since} to ${p.until})` : p.since ? ` (since ${p.since})` : '');
        return {
            ...entry,
            extra: {
                ...entry.extra,
                label: programs[0]?.program ?? 'GHA accredited',
                programs: programs.map((p) => `${p.program}${term(p)}`).join('; ') || null,
                categories: [...new Set(programs.map((p) => p.category))].join('; ') || null,
                validFrom: dated[0]?.since ?? null,
                validTo,
            },
        };
    });
}

export const gha: SourceAdapter = {
    slug: 'gha',
    name: 'Global Healthcare Accreditation, accredited and certified organizations',
    kind: 'accreditor',
    entity: 'facility',
    access: 'permission',
    permission: {
        grantedOn: '2026-11-21',
        scope: 'Scrape, store and display the accredited and certified organizations; an API may follow',
        conditions: 'Scrape until the API exists',
        reference: 'Letter of 21 Nov 2026 in the team vault: scrape, store and display until the API exists',
    },
    targets: [{ key: 'directory', label: 'All programs, worldwide', url: GHA_PAGE, region: null }],
    parse: (html: string) => parseDirectory(html),
};
