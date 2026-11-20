import { fold } from './search';

/**
 * US health and dental plans, matched on the folded name. The listings already
 * name them ("BCBS", "Blue Cross Blue Shield", "Aetna", "Cigna Healthcare"),
 * but ranked by count they sat below the Mexican insurers and out of the
 * popover entirely, so a US patient never saw their own plan (17 Nov 2026).
 */
const US_PLAN = /\b(aetna|anthem|bcbs|blue cross|blue shield|cigna|united ?health\w*|united concordia|delta dental|guardian|ameritas|humana|kaiser|tricare|medicare|medi-cal|molina|health net|simnsa|dentegra|careington|ambetter|wellcare|geha|multiplan|first health)\b/;

export const isUsPlan = (name: string): boolean => US_PLAN.test(fold(name));

export interface InsurerSection {
    /** 'popular' · 'us' · 'all', or 'matches' while the user is typing. */
    key: 'popular' | 'us' | 'all' | 'matches';
    names: string[];
}

/** How many of the most-accepted insurers head the list. */
export const POPULAR_SHOWN = 6;

const az = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' });

/**
 * The insurance popover's rows, in sections.
 *
 * `insurers` arrives most-accepted first (the directory's own counts: how many
 * listings take each one, the closest thing to demand we hold until search
 * analytics feed it). With no query: the most accepted few, then every US plan
 * A–Z, then everyone else A–Z, each name once. Typing narrows to matches,
 * word-start hits first, then by how widely accepted. A selected insurer always
 * shows, or the search box could hide the filter the user is trying to clear.
 */
export function insurerSections(insurers: readonly string[], query: string, selected: readonly string[]): InsurerSection[] {
    const q = fold(query.trim());
    if (q) {
        const rank = new Map(insurers.map((n, i) => [n, i]));
        const hits = insurers.filter((n) => fold(n).includes(q));
        const startsWord = (n: string) => new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(fold(n));
        hits.sort((a, b) => Number(startsWord(b)) - Number(startsWord(a)) || rank.get(a)! - rank.get(b)!);
        const kept = selected.filter((s) => !hits.includes(s));
        return ([{ key: 'matches', names: [...kept, ...hits] }] as InsurerSection[]).filter((s) => s.names.length);
    }
    const popular = insurers.slice(0, POPULAR_SHOWN);
    const rest = insurers.slice(POPULAR_SHOWN);
    const us = rest.filter(isUsPlan).sort(az);
    const all = rest.filter((n) => !isUsPlan(n)).sort(az);
    // A selected name not in the list (a stale link) still gets a row.
    const orphans = selected.filter((s) => !insurers.includes(s));
    return ([
        { key: 'popular', names: [...orphans, ...popular] },
        { key: 'us', names: us },
        { key: 'all', names: all },
    ] as InsurerSection[]).filter((s) => s.names.length);
}
