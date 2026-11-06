/**
 * The rules behind organization badges, kept apart from the component so
 * scripts/badges-selftest.ts can check them without a browser.
 */
import type { ProviderBadge } from '../types/provider';

export type BadgeGroup = 'credential' | 'affiliation' | 'facility';

const GROUP_OF: Record<ProviderBadge['kind'], BadgeGroup> = {
    consejo: 'credential',
    hospital: 'affiliation',
    colegio: 'affiliation',
    association: 'affiliation',
    regulator: 'facility',
    accreditor: 'facility',
};

/** The order groups appear in: what was verified comes before who someone belongs to. */
export const GROUPS: BadgeGroup[] = ['credential', 'facility', 'affiliation'];

export const groupOf = (b: ProviderBadge): BadgeGroup => GROUP_OF[b.kind] ?? 'affiliation';
export const idOf = (b: ProviderBadge) => `${b.org}:${b.label}`;

/** Letters for an organization whose logo we may not show yet: "Star Médica" → SM, "CONACEM" → CON. */
export function monogram(name: string): string {
    const words = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().split(/\s+/).filter(Boolean);
    return words.length > 1 ? words.slice(0, 2).map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
}

export interface BadgeLink {
    href: string;
    /** 'source' shows this doctor or clinic; 'about' explains the organization (docs/badges.md). */
    kind: 'source' | 'about';
}

export function badgeLink(b: ProviderBadge): BadgeLink | null {
    if (b.url) return { href: b.url, kind: 'source' };
    if (b.info_url) return { href: b.info_url, kind: 'about' };
    return null;
}

export const AFFILIATIONS_ON_CARD = 2;

/** The row on a search card: everything verified, a separator, two affiliations, then "+N". */
export function cardRow(badges: ProviderBadge[]) {
    const verified = badges.filter((b) => groupOf(b) !== 'affiliation');
    const affiliations = badges.filter((b) => groupOf(b) === 'affiliation');
    return {
        verified,
        shown: affiliations.slice(0, AFFILIATIONS_ON_CARD),
        hidden: Math.max(0, affiliations.length - AFFILIATIONS_ON_CARD),
    };
}
