/**
 * Baja Health Cluster's directory of recovery centers. Membership in an industry
 * association, not a safety check: the badge reads as an affiliation.
 * One server-rendered page; each center links to its own page.
 * Source notes: docs/sources/baja-health-cluster.md
 */
import * as cheerio from 'cheerio';
import type { SourceAdapter, SourceEntry, Target } from '../lib/types';

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();
const SLUG = /\/institucion\/([a-z0-9-]+)\/?$/i;

export function parseDirectory(html: string, target: Target): SourceEntry[] {
    const $ = cheerio.load(html);
    const out = new Map<string, SourceEntry>();
    $('a[href*="/institucion/"]').each((_, a) => {
        const href = $(a).attr('href') ?? '';
        const slug = href.match(SLUG)?.[1];
        if (!slug || out.has(slug)) return;
        // Climb to the largest block that is still only this center, then read its heading.
        let card = $(a);
        for (let parent = card.parent(); parent.length; parent = parent.parent()) {
            const others = parent.find('a[href*="/institucion/"]').filter((__, x) => !($(x).attr('href') ?? '').includes(`/${slug}`));
            if (others.length) break;
            card = parent;
        }
        const name = clean(card.find('h1,h2,h3,h4,h5,h6').first().text());
        if (!name) return;
        out.set(slug, {
            externalId: slug,
            name,
            title: null,
            specialties: [],
            cedulas: [],
            sites: [],
            region: target.region,
            url: new URL(href, target.url).href,
            photoUrl: null,
            extra: { label: 'Recovery centers' },
        });
    });
    return [...out.values()];
}

export const bajaHealthCluster: SourceAdapter = {
    slug: 'baja-health-cluster',
    name: 'Baja Health Cluster',
    kind: 'association',
    entity: 'facility',
    access: 'open',
    targets: [{ key: 'recovery-centers', label: 'Recovery centers', url: 'https://bajahealthcluster.mx/general-directory/recovery-centers/', region: 'sandiego-tijuana' }],
    parse: parseDirectory,
};
