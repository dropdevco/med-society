/**
 * Joint Commission International (JCI): every JCI-accredited organization outside the
 * United States. The public page fills its list from Sitecore Discover, JCI's search
 * service, with a browser key it ships in its own script; this adapter reads the page,
 * takes that key from the script each run (nothing of it is stored here), and pages
 * through the same search the page makes.
 * Written permission, 21 Nov 2026 (docs/sources/README.md). Notes: docs/sources/jci.md
 */
import { politeGet, politePost } from '../lib/http';
import type { TargetOutcome } from '../lib/judge';
import { normalizeCountry, regionOf } from '../lib/places';
import type { Collected, CollectedEntry, SourceAdapter } from '../lib/types';

export const JCI_ORIGIN = 'https://www.jointcommission.org';
export const JCI_PAGE = `${JCI_ORIGIN}/en-us/about-us/recognizing-excellence/find-accredited-international-organizations`;
const DISCOVER = 'https://discover.sitecorecloud.io/discover/v2';
/** The page's results widget and the two content sources it searches (read off the page's own request). */
const WIDGET = 'rfkid_7';
const SOURCES = ['1127011', '1140855'];
const PAGE_SIZE = 100;
/** A safety stop: JCI lists about a thousand organizations, so far more pages means paging is broken. */
const MAX_PAGES = 60;

/** The page script's Discover settings: `customerKey:"<id>-<domain>",apiKey:"01-..."`. */
export function discoverConfig(appScript: string): { domain: string; apiKey: string } | null {
    const m = /customerKey:"(\d+)-(\d+)",apiKey:"(0\d-[A-Za-z0-9-]+)"/.exec(appScript);
    return m ? { domain: m[2], apiKey: m[3] } : null;
}

/** The page's main script, where the settings live. */
export function appScriptUrl(pageHtml: string): string | null {
    const m = /\/_next\/static\/chunks\/pages\/_app-[a-f0-9]+\.js/.exec(pageHtml);
    return m ? `${JCI_ORIGIN}${m[0]}` : null;
}

export function searchBody(offset: number, limit = PAGE_SIZE) {
    return {
        widget: { items: [{ rfk_id: WIDGET, entity: 'content', search: { content: {}, limit, offset, sort: { value: [{ name: 'by_relevance_desc' }] } }, sources: SOURCES }] },
        context: { page: { uri: JCI_PAGE }, locale: { language: 'en', country: 'us' } },
    };
}

/** Program, decision and date from one of JCI's accreditation or certification items, whatever its key names. */
type Titled = { title?: { value?: string } };
type ProgramItem = Record<string, { program?: Titled; jsonValue?: { value?: string } } | undefined>;
export function programLine(item: ProgramItem): { program: string; decision: string; date: string | null } | null {
    const titles: string[] = [];
    let date: string | null = null;
    for (const v of Object.values(item)) {
        const t = v?.program?.title?.value;
        if (t) titles.push(t);
        const d = v?.jsonValue?.value;
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) date = d.slice(0, 10);
    }
    return titles.length ? { program: titles[0], decision: titles[1] ?? '', date } : null;
}

export interface JciRecord {
    hco_id?: string; id?: string; name?: string; city?: string | null; state?: string | null; country?: string | null;
    web_address?: string | null; type?: string; is_domestic?: boolean; acc_org_status_code?: string;
    acc_org_jci_accreditation?: ProgramItem[] | null; acc_org_jci_certification?: ProgramItem[] | null;
}

export function toEntry(r: JciRecord, observedAt: string): CollectedEntry | null {
    const id = String(r.hco_id ?? r.id ?? '').trim();
    const name = (r.name ?? '').replace(/\s+/g, ' ').trim();
    if (!id || !name) return null;
    const country = normalizeCountry(r.country);
    const city = r.city?.trim() || null;
    const acc = (r.acc_org_jci_accreditation ?? []).map(programLine).filter((x) => x !== null);
    const cert = (r.acc_org_jci_certification ?? []).map(programLine).filter((x) => x !== null);
    const line = (p: { program: string; decision: string; date: string | null }) => `${p.program}: ${p.decision}${p.date ? ` (${p.date})` : ''}`;
    const dates = acc.map((p) => p.date).filter((d): d is string => !!d).sort();
    return {
        externalId: id,
        name,
        title: null,
        specialties: [],
        cedulas: [],
        sites: [{ name, address: [city, r.state, country].filter(Boolean).join(', ') || null, tower: null, office: null }],
        region: regionOf(country, city),
        url: JCI_PAGE,
        photoUrl: null,
        observedAt,
        extra: {
            label: acc[0]?.program ?? cert[0]?.program ?? 'JCI accredited',
            hcoId: id,
            country,
            city,
            state: r.state?.trim() || null,
            website: r.web_address?.trim() || null,
            accreditations: acc.map(line).join('; ') || null,
            certifications: cert.map(line).join('; ') || null,
            validFrom: dates[0] ?? null,
        },
    };
}

interface DiscoverResponse { widgets?: Array<{ content?: JciRecord[]; total_item?: number }> }

async function collect(): Promise<Collected> {
    const targets: TargetOutcome[] = [];
    const reasons: string[] = [];
    const entries: CollectedEntry[] = [];
    const outcome = (key: string, url: string, ok: boolean, count: number, error?: string) =>
        targets.push({ key, url, ok, count, fetchedAt: new Date().toISOString(), ...(error ? { error } : {}) });

    const page = await politeGet(JCI_PAGE);
    const scriptUrl = appScriptUrl(page.body);
    if (!scriptUrl) throw new Error('the JCI page no longer names its main script (format change?)');
    const config = discoverConfig((await politeGet(scriptUrl)).body);
    if (!config) throw new Error('the JCI script no longer carries its search settings (format change?)');

    const url = `${DISCOVER}/${config.domain}`;
    let total: number | null = null;
    for (let n = 0; n < MAX_PAGES; n++) {
        const res = JSON.parse((await politePost(url, searchBody(n * PAGE_SIZE), { Authorization: config.apiKey })).body) as DiscoverResponse;
        const widget = res.widgets?.[0];
        if (!widget || !Array.isArray(widget.content)) throw new Error('the JCI search answered without a result list (format change?)');
        total ??= typeof widget.total_item === 'number' ? widget.total_item : null;
        const at = new Date().toISOString();
        for (const r of widget.content) {
            const e = toEntry(r, at);
            if (e) entries.push(e);
        }
        if (widget.content.length < PAGE_SIZE) break;
    }

    const unique = new Set(entries.map((e) => e.externalId)).size;
    outcome('organizations', JCI_PAGE, true, unique);
    if (total === null) reasons.push('the JCI search did not say how many organizations it has, so the list cannot be checked as complete');
    else if (unique < total) reasons.push(`JCI lists ${total} organizations but ${unique} were read (paging stopped early)`);
    if (entries.some((e) => e.extra?.country === 'United States')) reasons.push('United States records appeared: the search is no longer the international list');
    return { targets, entries, reasons };
}

export const jci: SourceAdapter = {
    slug: 'jci',
    name: 'Joint Commission International, accredited organizations',
    kind: 'accreditor',
    entity: 'facility',
    access: 'permission',
    permission: {
        grantedOn: '2026-11-21',
        scope: 'Scrape, store and display the accredited organizations; an API may follow',
        conditions: 'Scrape until the API exists',
        reference: 'Written permission, as reported by Emilio on 21 Nov 2026; file the letter in the team vault',
    },
    // robots.txt is read on JCI's site, which allows our agent; the search host is an API with no robots.txt.
    targets: [{ key: 'organizations', label: 'International accredited organizations', url: JCI_PAGE, region: null }],
    collect,
};
