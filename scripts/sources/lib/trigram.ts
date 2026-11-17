/**
 * The name comparison the database uses, in TypeScript, for read-only reports
 * that must not write a helper function to production: bh_norm (migration
 * 0005b) and pg_trgm's similarity(). The self-test holds them to known values.
 */
const STOP_WORDS = new Set(('dr dra doctor doctora lic mtro mtra clinica clinicas consultorio centro medico medica medicos hospital salud grupo '
    + 'especialidades dental dentista odontologia de del la el los las y en sa cv s a c v clinic clinics medical center centre family health care '
    + 'group services the of at and pllc llc pa md dds inc').split(' '));

export function bhNorm(text: string | null | undefined): string {
    return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .split(/[^a-z0-9]+/).filter((w) => w && !STOP_WORDS.has(w)).join(' ');
}

export function trigrams(text: string): Set<string> {
    const out = new Set<string>();
    for (const word of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
        const padded = `  ${word} `;
        for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
    }
    return out;
}

export function setSimilarity(a: Set<string>, b: Set<string>): number {
    if (!a.size || !b.size) return 0;
    let shared = 0;
    for (const t of a) if (b.has(t)) shared++;
    return shared / (a.size + b.size - shared);
}

export const similarity = (a: string, b: string) => setSimilarity(trigrams(a), trigrams(b));
