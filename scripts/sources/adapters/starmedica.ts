/**
 * Star Médica Ciudad Juárez doctor directory (no Star Médica in Tijuana).
 * A Salesforce site: cards only exist after JavaScript runs, so this reads it
 * with a real browser. One search returns at most 100 doctors, so the run
 * searches the hospital once per specialty (the full list is read from the
 * site's own search box each run) and merges by the card's Salesforce ID.
 * Source notes: docs/sources/starmedica.md
 */
import type { Page } from 'playwright';
import { openBrowser, pace } from '../lib/browser';
import type { Collected, CollectedEntry, SourceAdapter, SourceEntry } from '../lib/types';

export const HOSPITAL = 'Star Médica Ciudad Juárez';
export const RESULT_CAP = 100;
const BASE = 'https://www.starmedica.com/s/';
export const listUrl = (specialty: string) =>
    `${BASE}directorio-medico?hospital=${encodeURIComponent(HOSPITAL)}${specialty ? `&especialidad=${encodeURIComponent(specialty)}` : ''}`;

/** One doctor's own card: the directory page reads `doctorId` and shows only that record. */
export const doctorUrl = (externalId: string) => `${BASE}directorio-medico?doctorId=${encodeURIComponent(externalId)}`;

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** What the page gives us per card, before interpretation. */
export interface RawCard {
    /** The name span's id: the Salesforce record ID plus a "-NN" render suffix. */
    id: string;
    name: string;
    specialty: string;
    /** The card's visible text, line by line. */
    text: string;
}

export function parseCard(card: RawCard): SourceEntry | null {
    const externalId = card.id.replace(/-\d+$/, '');
    if (!externalId || !clean(card.name)) return null;
    const lines = card.text.split('\n').map(clean).filter(Boolean);
    const office = lines.map((l) => l.match(/^Consultorio\s+(.+)$/i)?.[1]).find(Boolean) ?? null;
    const cedLine = lines.find((l) => /Ced\.?\s*Prof/i.test(l)) ?? '';
    const cedulas = [...new Set((cedLine.match(/\d{6,9}/g) ?? []))];
    return {
        externalId,
        name: clean(card.name),
        title: null, // the cards print no "Dr." / "Dra."
        specialties: clean(card.specialty).split(/\s*\/+\s*/).filter(Boolean),
        cedulas,
        sites: [{ name: lines.find((l) => /^Star M[eé]dica/i.test(l)) ?? HOSPITAL, address: null, tower: null, office }],
        region: 'elpaso-juarez',
        url: doctorUrl(externalId),
        photoUrl: null, // a generic avatar on every card
    };
}

/** The specialty list from the site's search box: about 120 values, typos included. */
async function specialties(page: Page): Promise<string[]> {
    await pace();
    await page.goto(`${BASE}directorio-medico-header`, { waitUntil: 'networkidle', timeout: 90_000 });
    const before = new Set(await page.locator('li, [role=option]').allInnerTexts());
    await page.getByText('Especialidad', { exact: true }).first().click();
    await page.waitForTimeout(1500);
    const after = await page.locator('li, [role=option]').allInnerTexts();
    return [...new Set(after.map(clean))].filter((t) => t && !before.has(t)
        && !/^(Star M[eé]dica|Hospital|Especialidad|Subespecialidad)/i.test(t));
}

async function cardsOnPage(page: Page): Promise<RawCard[]> {
    // Wait until the number of cards stops changing: results arrive in pieces.
    let last = -1;
    for (let i = 0; i < 10; i++) {
        const n = await page.locator('span.nombre').count();
        if (n === last) break;
        last = n;
        await page.waitForTimeout(1200);
    }
    // Plain script text, not a function: tsx's compiled helpers don't exist inside the page.
    return page.evaluate<RawCard[]>(CARDS_SCRIPT);
}

/** Collect every card, walking into Salesforce's shadow roots. */
const CARDS_SCRIPT = `(() => {
    const out = [];
    const walk = (root) => {
        root.querySelectorAll('span.nombre').forEach((n) => {
            let card = n;
            for (let i = 0; i < 10 && card && !(card.classList && card.classList.contains('container-card')); i++) {
                card = card.parentElement || (card.getRootNode() && card.getRootNode().host) || null;
            }
            const spec = card && card.querySelector('.especialidad');
            out.push({ id: n.id, name: n.textContent || '', specialty: spec ? spec.textContent || '' : '', text: card ? card.innerText || '' : '' });
        });
        root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) walk(e.shadowRoot); });
    };
    walk(document);
    return out;
})()`;

async function collect(): Promise<Collected> {
    const open = await openBrowser(starMedica.permission);
    try {
        const page = await open.context.newPage();
        const list = await specialties(page);
        if (list.length < 50) throw new Error(`specialty list has only ${list.length} values (layout change?)`);

        const entries: CollectedEntry[] = [];
        const detail: Record<string, number> = {};
        const reasons: string[] = [];
        for (const specialty of list) {
            await pace();
            await page.goto(listUrl(specialty), { waitUntil: 'networkidle', timeout: 90_000 });
            const raw = await cardsOnPage(page);
            const observedAt = new Date().toISOString();
            detail[specialty] = raw.length;
            if (raw.length >= RESULT_CAP) reasons.push(`"${specialty}" returned ${raw.length} doctors, the site's cap: some may be missing`);
            for (const card of raw) {
                const e = parseCard(card);
                if (e) entries.push({ ...e, observedAt });
            }
        }
        const unique = new Set(entries.map((e) => e.externalId)).size;
        return {
            targets: [{ key: 'ciudadjuarez', url: listUrl(''), ok: true, count: unique, fetchedAt: new Date().toISOString(), detail }],
            entries,
            reasons,
        };
    } finally {
        await open.close();
    }
}

export const starMedica: SourceAdapter = {
    slug: 'starmedica',
    name: 'Star Médica',
    kind: 'hospital',
    access: 'permission',
    permission: {
        grantedOn: '2026-11-04',
        scope: 'Scrape, store and display the doctor directory data',
        conditions: 'As recorded from the team on 4 Nov 2026; weekly runs keep it current',
        reference: 'Signed letter in the team vault; see docs/sources/README.md',
    },
    targets: [{ key: 'ciudadjuarez', label: HOSPITAL, url: listUrl(''), region: 'elpaso-juarez' }],
    collect,
};
