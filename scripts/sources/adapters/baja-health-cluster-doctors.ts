/**
 * Baja Health Cluster's directory of doctors and dentists (the recovery centers
 * are a separate source, ./baja-health-cluster.ts). Membership in an industry
 * cluster, not a credential check: the badge reads as an affiliation.
 *
 * Two server-rendered list pages give every member's name, profile link and
 * specialty tags; each profile page adds the specialties in Spanish, the office
 * address, and, for a few members, a cédula. On 16 Nov 2026 only 4 of 106
 * profiles showed one, so almost every match goes to review or the AI scorer
 * (docs/adr/0012): a name alone never confirms (docs/adr/0004).
 *
 * Phones, e-mails and social links on the profiles are not read.
 * Source notes: docs/sources/baja-health-cluster.md
 */
import * as cheerio from 'cheerio';
import { politeGet } from '../lib/http';
import { robotsVerdict } from '../lib/robots';
import type { Collected, CollectedEntry, EntrySite, SourceAdapter, SourceEntry, Target } from '../lib/types';

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();

const PROFILE = /\/directorio\/([a-z0-9-]+)\/?$/i;
/** Honorifics printed before a name; kept apart from it for matching. */
const TITLE = /^((?:Dra?|Psic|Lic|Mtr[oa]|Odont|C\.D|CD|Q\.F\.B)\.?)\s+/i;
/** A cédula is printed as "Cédula profesional: 1234567", "Céd. Prof. 1234567" and the like. */
const CEDULA = /c[ée]d(?:ula|\.)?\s*(?:prof(?:esional|\.)?)?(?:\s*de\s+especialidad)?[^0-9\n]{0,30}?(\d{6,8})(?!\d)/gi;
/** Headings on a profile that are labels, not specialties. */
const NOT_SPECIALTY = /^(especialista certificado|certified specialist|directory|directorio)$/i;
/** "Hospital Angeles", "Hospital del Prado": capitalised words up to the first full stop. */
const HOSPITAL = /\b(Hospital\s+(?:(?:de|del)\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*(?:\s+(?:(?:de|del)\s+)?[A-ZÁÉÍÓÚÑ][\wÁÉÍÓÚÑáéíóúñ]*){0,3})/;

/** One card on a list page, before the profile is read. */
export interface ListCard {
    slug: string;
    url: string;
    name: string;
    tags: string[];
}

export function parseList(html: string, base: string): ListCard[] {
    const $ = cheerio.load(html);
    const out = new Map<string, ListCard>();
    $('.e-loop-item').each((_, el) => {
        const card = $(el);
        const href = card.find('a[href*="/directorio/"]').first().attr('href') ?? '';
        const slug = href.match(PROFILE)?.[1]?.toLowerCase();
        const name = clean(card.find('h1,h2,h3,h4').first().text());
        if (!slug || !name || out.has(slug)) return;
        const tags = card.find('.elementor-icon-list-text').map((__, t) => clean($(t).text())).get().filter(Boolean);
        out.set(slug, { slug, url: new URL(href, base).href, name, tags: [...new Set(tags)] });
    });
    return [...out.values()];
}

/** What a profile page adds to its card. */
export interface ProfileFacts {
    specialties: string[];
    cedulas: string[];
    address: string | null;
    hospital: string | null;
}

export function parseProfile(html: string): ProfileFacts {
    const $ = cheerio.load(html);
    $('script,style,noscript,svg,header,footer,nav').remove();
    const specialties = $('h2.elementor-heading-title').map((_, h) => clean($(h).text())).get()
        .filter((t) => t && !NOT_SPECIALTY.test(t) && t.length < 80);
    // The office address is the map's title; the map is the one place every profile prints it.
    const address = clean($('iframe[src*="maps.google"]').first().attr('title')) || null;
    const text = clean($('body').text());
    const cedulas = [...new Set([...text.matchAll(CEDULA)].map((m) => m[1]))];
    return { specialties: [...new Set(specialties)], cedulas, address, hospital: address?.match(HOSPITAL)?.[1]?.replace(/\.$/, '') ?? null };
}

export function toEntry(card: ListCard, facts: ProfileFacts | null, target: Target): SourceEntry {
    const title = card.name.match(TITLE)?.[1] ?? null;
    const name = title ? card.name.slice(card.name.match(TITLE)![0].length).trim() : card.name;
    const sites: EntrySite[] = facts?.address ? [{ name: facts.hospital ?? 'Consultorio', address: facts.address, tower: null, office: null }] : [];
    return {
        externalId: card.slug,
        name,
        title,
        specialties: facts?.specialties.length ? facts.specialties : card.tags,
        cedulas: facts?.cedulas ?? [],
        sites,
        region: target.region,
        url: card.url,
        photoUrl: null,
        extra: { label: target.key === 'dentists' ? 'Member dentist' : 'Member doctor', tags: card.tags.join(', ') || null, profileRead: facts ? 1 : 0 },
    };
}

async function collect(): Promise<Collected> {
    const targets: Collected['targets'] = [];
    const entries: CollectedEntry[] = [];
    const reasons: string[] = [];
    const cards: Array<{ card: ListCard; target: Target }> = [];

    for (const target of bajaHealthClusterDoctors.targets) {
        try {
            const res = await politeGet(target.url);
            const found = parseList(res.body, res.url);
            targets.push({ key: target.key, url: target.url, ok: found.length > 0, count: found.length, fetchedAt: new Date().toISOString() });
            if (!found.length) reasons.push(`${target.label}: no cards found (layout change?)`);
            for (const card of found) cards.push({ card, target });
        } catch (err) {
            targets.push({ key: target.key, url: target.url, ok: false, count: 0, fetchedAt: new Date().toISOString(), error: (err as Error).message });
        }
    }

    // A member listed as both doctor and dentist keeps its first card.
    const seen = new Set<string>();
    const unique = cards.filter(({ card }) => !seen.has(card.slug) && seen.add(card.slug));

    const robots = await robotsVerdict(unique.map(({ card }) => card.url));
    if (!robots.allowed) reasons.push(robots.reason!);

    let unread = 0;
    for (const { card, target } of unique) {
        let facts: ProfileFacts | null = null;
        if (robots.allowed) {
            try {
                facts = parseProfile((await politeGet(card.url)).body);
            } catch {
                unread++;
            }
        }
        entries.push({ ...toEntry(card, facts, target), observedAt: new Date().toISOString() });
    }
    // A few unreadable profiles still give names; many mean the site is struggling.
    if (unread > Math.max(3, unique.length * 0.1)) reasons.push(`${unread} of ${unique.length} profiles could not be read`);
    return { targets, entries, reasons };
}

export const bajaHealthClusterDoctors: SourceAdapter = {
    slug: 'baja-health-cluster-doctors',
    name: 'Baja Health Cluster (doctors)',
    kind: 'cluster',
    entity: 'doctor',
    access: 'open',
    targets: [
        { key: 'doctors', label: 'Doctors', url: 'https://bajahealthcluster.mx/general-directory/doctors/', region: 'sandiego-tijuana' },
        { key: 'dentists', label: 'Dentists', url: 'https://bajahealthcluster.mx/general-directory/dentists/', region: 'sandiego-tijuana' },
    ],
    collect,
};
