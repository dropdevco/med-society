/**
 * Hospital Ángeles doctor directories for the two hospitals in our regions.
 * Server-rendered, one page per city, no paging. We read the Spanish original;
 * en.hospitalangeles.com is a Weglot translation of the same pages.
 * Source notes: docs/sources/hospital-angeles.md
 */
import * as cheerio from 'cheerio';
import type { EntrySite, SourceAdapter, SourceEntry, Target } from '../lib/types';

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Honorifics the directory prints before a name; "Lic." is used for non-physician staff. */
const TITLE = /^((?:Dra?|Lic|Psic|Mtr[oa]|Enf)\.)\s+/i;

/** The site's generic "no photo" image, shown for 85 of 394 doctors on 2 Nov 2026. */
const PLACEHOLDER_PHOTO = /\/directorio-medico\.(?:jpe?g|png|webp)$/i;

export function parseDirectory(html: string, target: Target): SourceEntry[] {
    const $ = cheerio.load(html);
    const out: SourceEntry[] = [];
    $('.blog-card.secondary_blog_card').each((_, el) => {
        const card = $(el);
        const href = card.find('.blog-card-link a').attr('href') ?? '';
        const slug = href.match(/\/medico\/([^/?#]+)/)?.[1];
        if (!slug) return; // a promo or layout card, not a doctor

        const full = clean(card.find('h6').first().text());
        const title = full.match(TITLE)?.[1] ?? null;
        const name = title ? full.slice(title.length).trim() : full;
        const photo = card.find('.blog-card-thumb img').attr('src') || null;

        const sites: EntrySite[] = card.find('.hospital-pill').map((__, pill) => {
            const p = $(pill);
            return {
                name: clean(p.text()),
                address: clean(p.attr('data-dir')).replace(/,$/, '') || null,
                tower: clean(p.attr('data-torre')) || null,
                office: clean(p.attr('data-cons')) || null,
            };
        }).get();

        out.push({
            externalId: slug.toLowerCase(),
            name,
            title,
            // Several specialties come comma-separated; "Ortopedia y Traumatología" is one.
            specialties: clean(card.find('.especialidad').first().text()).split(/\s*,\s*/).filter(Boolean),
            cedulas: [], // not published by this source: every match goes to review
            sites,
            region: target.region,
            url: new URL(href, target.url).href,
            photoUrl: photo && !PLACEHOLDER_PHOTO.test(photo) ? photo : null,
        });
    });
    return out;
}

export const hospitalAngeles: SourceAdapter = {
    slug: 'hospital-angeles',
    name: 'Hospital Ángeles',
    kind: 'hospital',
    access: 'permission',
    permission: {
        grantedOn: '2026-10-30',
        scope: 'Scrape, store and display the doctor directory data',
        conditions: 'Keep it up to date: weekly runs, lapse after two missed runs (docs/adr/0004)',
        reference: 'Signed letter in the team vault; see docs/sources/README.md',
    },
    targets: [
        { key: 'tijuana', label: 'Hospital Angeles Tijuana', url: 'https://hospitalangeles.com/tijuana/directorio-medico', region: 'sandiego-tijuana' },
        { key: 'ciudadjuarez', label: 'Hospital Angeles Ciudad Juárez', url: 'https://hospitalangeles.com/ciudadjuarez/directorio-medico', region: 'elpaso-juarez' },
    ],
    parse: parseDirectory,
};
