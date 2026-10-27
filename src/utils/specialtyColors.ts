/**
 * One hue per specialty, used wherever a specialty needs to be identifiable
 * at a glance rather than merely labelled — map pins, the category rail, the
 * monogram fallback on a card with no photo.
 *
 * Deliberately muted: these sit next to `--accent` on the same screen, and a
 * saturated palette would turn the map into confetti and start competing with
 * the promoted tier for attention. Each is a mid-tone that holds >= 3:1 on
 * both the light (#f0f0ee) and dark (#121316) map fills, so a pin reads in
 * either theme without a per-theme table.
 *
 * The two keys with no colour of their own — `general` and `telehealth` —
 * still get an entry rather than a fallback, because a `Record<Specialty, …>`
 * is what makes adding a specialty to the union a compile error here.
 */
export const SPECIALTY_COLORS: Record<string, string> = {
    dentist: '#2f7fb5',
    orthodontist: '#4a6fc4',
    plastic_surgery: '#a8558f',
    aesthetician: '#c06a9c',
    obgyn: '#c2567a',
    physical_therapy: '#c47a2f',
    massage: '#b8873a',
    optometry: '#3f8f9c',
    general: '#0f6b52',
    pediatrics: '#3f9a63',
    cardiology: '#c0483f',
    urgent_care: '#d1552c',
    mental_health: '#7a63c0',
    pharmacy: '#2f8a70',
    telehealth: '#5a7a8f',
    neurology: '#5b5fb8',
    otolaryngology: '#2f8f8f',
    orthopedics: '#8a6a3f',
    gastroenterology: '#9a8330',
};

/** The colour for a specialty key, or the house accent for anything unknown. */
export function specialtyColor(specialty: string | undefined): string {
    return (specialty && SPECIALTY_COLORS[specialty]) || '#0f6b52';
}
