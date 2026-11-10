/**
 * What a doctor's website can emphasise, by kind of practice.
 *
 * KEEP IN STEP with SITE_ARCHETYPE_OF / SITE_PRIORITIES in api/agent.ts: the
 * renderer there is self-contained (api/ cannot import from src/), so the same
 * defaults live in both places. The renderer is the authority; this copy only
 * pre-fills the form so what the owner sees matches what the site will do.
 */
export type Archetype = 'stay' | 'specialist' | 'procedures' | 'routine' | 'therapy' | 'multi';
export type ExtraKey = 'rooms' | 'amenities' | 'day' | 'packages' | 'conditions' | 'affiliations' | 'recovery' | 'financing' | 'approach' | 'sessions' | 'access' | 'credentials' | 'technology' | 'results' | 'team';

export const ARCHETYPES: Archetype[] = ['stay', 'specialist', 'procedures', 'routine', 'therapy', 'multi'];

export const ARCHETYPE_OF: Record<string, Archetype> = {
    cardiology: 'specialist', gastroenterology: 'specialist', neurology: 'specialist', orthopedics: 'specialist', otolaryngology: 'specialist', obgyn: 'specialist',
    plastic_surgery: 'procedures', aesthetician: 'procedures', orthodontist: 'procedures',
    dentist: 'routine', optometry: 'routine', pediatrics: 'routine', general: 'routine', urgent_care: 'routine', telehealth: 'routine',
    mental_health: 'therapy', physical_therapy: 'therapy', massage: 'therapy',
    pharmacy: 'multi',
};

/** The archetype a listing starts from: its kind ('stay') first, then its first specialty. */
export function archetypeFor(specialty: string[] | undefined, kind?: string | null): Archetype {
    if (kind === 'stay') return 'stay';
    return ARCHETYPE_OF[specialty?.[0] ?? ''] ?? 'routine';
}

export const PRIORITIES: Record<Archetype, string[]> = {
    stay: ['photos', 'rooms', 'reviews', 'amenities', 'day', 'packages', 'services', 'about', 'team', 'steps', 'faq'],
    specialist: ['credentials', 'technology', 'conditions', 'about', 'services', 'reviews', 'results', 'affiliations', 'team', 'faq', 'photos', 'steps'],
    procedures: ['results', 'photos', 'services', 'recovery', 'credentials', 'financing', 'reviews', 'about', 'steps', 'faq'],
    routine: ['services', 'access', 'reviews', 'about', 'photos', 'team', 'steps', 'faq'],
    therapy: ['about', 'approach', 'sessions', 'services', 'reviews', 'credentials', 'steps', 'faq', 'photos'],
    multi: ['services', 'team', 'photos', 'reviews', 'about', 'faq', 'steps'],
};

/** The proof blocks worth asking about for each kind of practice (the listing cannot supply these). */
export const EXTRAS_FOR: Record<Archetype, ExtraKey[]> = {
    stay: ['rooms', 'amenities', 'day', 'packages', 'team'],
    specialist: ['credentials', 'technology', 'conditions', 'affiliations', 'results'],
    procedures: ['credentials', 'results', 'recovery', 'financing'],
    routine: ['team', 'access'],
    therapy: ['credentials', 'approach', 'sessions'],
    multi: ['team'],
};

export const EXTRA_KEYS: ExtraKey[] = ['rooms', 'amenities', 'day', 'packages', 'conditions', 'affiliations', 'recovery', 'financing', 'approach', 'sessions', 'access', 'credentials', 'technology', 'results', 'team'];

/** The saved order, then anything the archetype lists that the owner never ranked. */
export function orderFor(archetype: Archetype, saved: string[] | undefined): string[] {
    return [...new Set([...(saved ?? []), ...PRIORITIES[archetype]])];
}
