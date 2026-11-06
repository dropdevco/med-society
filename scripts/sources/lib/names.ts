/**
 * Splitting a Mexican doctor's name, for `name_key` and the doctors table.
 * Mexican names are given name(s), paternal, maternal surname. A three-word
 * name reads two ways ("Ana María López" or "Ana López Ruiz"), so the split is
 * a best guess: it feeds a search shortcut, never a doctor's identity (docs/adr/0007).
 */
const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const TITLE = /^(DRA?|DOCTORA?|LIC|LICDA?|PSIC|MTRO|MTRA|ENF)\.?\s+/;
const PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'MC', 'VAN', 'VON', 'DA', 'DI', 'SAN', 'SANTA']);

export interface ParsedName {
    given: string;
    surname1: string | null;
    surname2: string | null;
    /** Three words: the second may be a surname or a second given name. */
    ambiguous: boolean;
}

function tokens(name: string): string[] {
    let s = strip(name).toUpperCase().replace(/[^A-Z\s.]/g, ' ').replace(/\s+/g, ' ').trim();
    while (TITLE.test(s)) s = s.replace(TITLE, '');
    return s.replace(/\./g, ' ').split(/\s+/).filter(Boolean);
}

/** Group particles with the word they introduce: DE LA GARZA is one surname. */
function units(words: string[]): string[] {
    const out: string[] = [];
    let pending: string[] = [];
    for (const w of words) {
        if (PARTICLES.has(w)) pending.push(w);
        else { out.push([...pending, w].join(' ')); pending = []; }
    }
    if (pending.length) out.push(pending.join(' '));
    return out;
}

export function parseName(name: string): ParsedName | null {
    const u = units(tokens(name));
    if (u.length === 0) return null;
    if (u.length === 1) return { given: u[0], surname1: null, surname2: null, ambiguous: false };
    if (u.length === 2) return { given: u[0], surname1: u[1], surname2: null, ambiguous: false };
    if (u.length === 3) return { given: u[0], surname1: u[1], surname2: u[2], ambiguous: true };
    return { given: u.slice(0, -2).join(' '), surname1: u[u.length - 2], surname2: u[u.length - 1], ambiguous: false };
}

const first2 = (unit: string) => unit.split(' ').filter((w) => !PARTICLES.has(w)).join('').slice(0, 2);

/** First 2 letters of the given name + first 2 of the paternal surname, particles skipped. */
export function nameKey(p: { given: string; surname1: string | null } | null): string | null {
    if (!p || !p.surname1) return null;
    return `${first2(p.given)}${first2(p.surname1)}`;
}
