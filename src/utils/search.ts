/**
 * The directory's search engine.
 *
 * Everything runs client-side over the selected region's providers (4–7k), so this
 * has to be cheap enough to run on every keystroke. The shape is:
 *
 *   buildSearchIndex(providers, labelOf)  →  once per [providers, language]
 *   scoreDoc(doc, terms)                  →  per provider, per query
 *
 * Folding the haystack up front is the whole point: the previous
 * implementation rebuilt and re-normalised every field inside the filter loop.
 */

import type { Provider, Specialty } from '../types/provider';
import { SpecialtyLabels } from '../types/provider';

/** Case/accent-insensitive, so "juarez" finds "Juárez" and "pediatria" finds "Pediatría". */
export function fold(s: string): string {
    let out = '';
    // Decompose, then drop the combining-diacritic block (U+0300–U+036F).
    for (const ch of s.toLowerCase().normalize('NFD')) {
        const code = ch.codePointAt(0)!;
        if (code >= 0x300 && code <= 0x36f) continue;
        out += ch;
    }
    return out;
}

/**
 * Words that carry no signal in either language. "Dr" and "Dra" matter here
 * specifically — nearly every provider name starts with one, so leaving them
 * in makes "dr ana" score every doctor in Juárez.
 */
const STOPWORDS = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'en', 'a', 'un', 'una',
    'the', 'of', 'and', 'in', 'at', 'for',
    'dr', 'dra', 'drs', 'doctor', 'doctora', 'lic', 'mtro', 'mtra',
]);

/**
 * Split a query into folded, meaningful terms.
 *
 * A term must survive stopword removal to count; a query that is nothing but
 * stopwords ("the doctor") yields [], which callers treat as "no query" rather
 * than "no results".
 */
export function tokenize(query: string): string[] {
    return fold(query)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 0 && !STOPWORDS.has(w))
        // A single leftover character is noise, not a prefix worth matching.
        .filter((w) => w.length > 1 || /\d/.test(w));
}

/**
 * Cross-language and colloquial names for a *kind of doctor*.
 *
 * This is what makes the engine bilingual in practice. A patient in Juárez
 * types "muela" or "dentista"; the directory stores "dentist". Neither
 * substring nor prefix matching bridges that, and edit distance never will —
 * the words simply aren't similar. An explicit table is cheap and predictable,
 * and it doubles as the vocabulary the autocomplete suggests from.
 *
 * Procedure names are deliberately absent. "Blanqueamiento" belongs to the
 * clinics that actually list it, and putting it here would expand it to all 756
 * dentists — precision traded away for recall nobody asked for. Procedures are
 * already searchable: they land in the `service` field on their own.
 *
 * Members are matched as needles against folded fields, so a stem like
 * "odontolog" covers odontología/odontólogo/odontológica in one entry, and a
 * multi-word member like "medicina general" matches a phrase in a label.
 */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
    ['dentist', 'dentista', 'dental', 'odontolog', 'muela', 'muelas', 'diente', 'dientes'],
    ['orthodontist', 'ortodoncia', 'ortodoncista', 'brackets', 'braces', 'frenos'],
    ['plastic_surgery', 'plastica', 'plastic', 'cirujano', 'cirugia', 'aesthetic'],
    ['aesthetician', 'estetica', 'dermatolog', 'piel', 'skin'],
    ['obgyn', 'ginecolog', 'gineco', 'obstetra', 'obstetricia', 'embarazo', 'pregnancy',
        'women', 'mujer', 'prenatal'],
    ['physical_therapy', 'fisioterapia', 'fisioterapeuta', 'rehabilitacion', 'rehab',
        'physio', 'terapia fisica'],
    ['massage', 'masaje', 'masajista', 'quiropractico', 'chiropract'],
    ['optometry', 'optometrista', 'optometria', 'oculista', 'oftalmolog', 'ojos',
        'eyes', 'vista', 'lentes', 'glasses', 'optica'],
    ['general', 'medicina general', 'medico general', 'family', 'familiar', 'primary', 'primaria'],
    ['pediatrics', 'pediatra', 'pediatria', 'ninos', 'nino', 'kids', 'children', 'child', 'infantil'],
    ['cardiology', 'cardiolog', 'corazon', 'heart', 'cardio'],
    ['urgent_care', 'urgencias', 'urgencia', 'urgente', 'urgent', 'emergencia', 'emergency'],
    ['mental_health', 'psicolog', 'psiquiatr', 'psycholog', 'psychiatr', 'salud mental',
        'ansiedad', 'depresion', 'therapy', 'counseling'],
    ['pharmacy', 'farmacia', 'botica', 'medicamentos', 'drugstore'],
    ['telehealth', 'telemedicina', 'en linea', 'online', 'virtual', 'videoconsulta'],
    ['neurology', 'neurolog', 'neurocirug', 'neurocirujano', 'neurosurg', 'cerebro', 'brain',
        'migrana', 'migraine', 'jaqueca', 'cabeza', 'headache', 'epilepsia', 'epilepsy',
        'convulsion', 'seizure'],
    ['otolaryngology', 'otorrino', 'otorrinolaringolog', 'oido', 'oidos', 'garganta', 'throat',
        'nariz', 'sinusitis', 'amigdalas', 'tonsils', 'audiolog', 'hearing', 'sordera'],
    ['orthopedics', 'ortoped', 'orthoped', 'traumatolog', 'hueso', 'huesos', 'bone', 'fractura',
        'fracture', 'rodilla', 'knee', 'columna', 'spine', 'cadera'],
];

const SYNONYM_LOOKUP = new Map<string, readonly string[]>();
for (const group of SYNONYM_GROUPS) {
    for (const member of group) SYNONYM_LOOKUP.set(member, group);
}

/**
 * A term plus everything it should also match.
 *
 * The scan runs in both directions, and both directions earn their keep:
 *
 *   member.startsWith(term)  — a half-typed word ("ginec", "dentis") reaches
 *                              its group while the user is still typing.
 *   term.startsWith(member)  — an inflected word reaches a stem entry.
 *                              "ginecologo" and "ginecologia" both extend
 *                              "ginecolog", which is the whole point of
 *                              storing stems; without this, "ginecologo"
 *                              matched six clinics by name instead of 286
 *                              by specialty.
 */
/**
 * Every word that names a given specialty, including its key.
 *
 * Lets the autocomplete offer "Orthodontist" for a typed "orto" even while the
 * interface is in English — otherwise the suggestion list is blind to exactly
 * the bilingual queries the ranked results already handle.
 */
export function synonymsOf(specialty: string): readonly string[] {
    return SYNONYM_LOOKUP.get(specialty) ?? [specialty];
}

export function expandTerm(term: string): readonly string[] {
    const exact = SYNONYM_LOOKUP.get(term);
    if (exact) return exact;

    if (term.length >= 4) {
        for (const group of SYNONYM_GROUPS) {
            for (const member of group) {
                if (member.startsWith(term)) return group;
                // Guard the length, or a three-letter stem would swallow
                // unrelated words that happen to share an opening.
                if (member.length >= 4 && term.startsWith(member)) return group;
            }
        }
    }
    return [term];
}

/** Weight per field, and the multiplier for how squarely a term landed in it. */
const FIELD_WEIGHTS = {
    name: 100,
    specialty: 45,
    service: 35,
    city: 20,
    address: 15,
    insurance: 10,
} as const;

type FieldKey = keyof typeof FIELD_WEIGHTS;

const ALL_FIELDS = Object.keys(FIELD_WEIGHTS) as FieldKey[];

/**
 * Fields a synonym may be matched against.
 *
 * Names, cities and streets are excluded on purpose. A synonym stands for a
 * concept, and concepts do not rename people: searching "denti" was surfacing
 * Dra. Muela Gabaldón above every actual dentist, because "muela" is a synonym
 * for the concept and her surname scored as a full name hit.
 */
const CONCEPT_FIELDS: FieldKey[] = ['specialty', 'service', 'insurance'];

/** Exact field · word-start · anywhere. A word-start hit is what live typing produces. */
const EXACT = 1;
const PREFIX = 0.6;
const SUBSTRING = 0.3;

/** A hit found only through the synonym table ranks below the literal word. */
const SYNONYM_PENALTY = 0.8;

/** One provider, pre-folded. Field values are joined with '|' as a cheap separator. */
export interface SearchDoc {
    id: string;
    name: string;
    specialty: string;
    service: string;
    city: string;
    address: string;
    insurance: string;
    /** Rating/reviews/verified rolled into one multiplier, computed once. */
    quality: number;
    promoted: boolean;
}

/**
 * How squarely `needle` lands in `field`, 0 when it misses.
 *
 * Word-start beats mid-word because "orto" should rank Ortodoncia above
 * Deportología — the same reason a phone book is ordered by first letter.
 */
function matchStrength(field: string, needle: string): number {
    if (!field || !needle) return 0;
    const at = field.indexOf(needle);
    if (at === -1) return 0;
    if (field.length === needle.length) return EXACT;
    // Start of the field, or start of a word inside it.
    if (at === 0 || !/[a-z0-9]/.test(field[at - 1])) return PREFIX;
    return SUBSTRING;
}

/**
 * Relevance of one provider for one query, or 0 when it does not match.
 *
 * Terms are ANDed: every term must land in *some* field. That is the fix for
 * the old behaviour, where "dentista centro" was matched as one literal string
 * against each field separately and so found nothing.
 */
export function scoreDoc(doc: SearchDoc, terms: readonly string[]): number {
    if (!terms.length) return 0;

    let total = 0;

    for (const term of terms) {
        let best = 0;

        const consider = (field: FieldKey, needle: string, penalty: number) => {
            const strength = matchStrength(doc[field], needle);
            if (strength === 0) return;
            const score = FIELD_WEIGHTS[field] * strength * penalty;
            if (score > best) best = score;
        };

        // What the user literally typed, against everything.
        for (const field of ALL_FIELDS) consider(field, term, 1);

        // What they might have meant, against concepts only.
        for (const needle of expandTerm(term)) {
            if (needle === term) continue;
            for (const field of CONCEPT_FIELDS) consider(field, needle, SYNONYM_PENALTY);
        }

        // One unmatched term disqualifies the provider entirely.
        if (best === 0) return 0;
        total += best;
    }

    return total * doc.quality;
}

/**
 * Rating, review volume and credentials, as a gentle multiplier.
 *
 * Deliberately narrow (roughly 1.0–1.4). Quality should break ties between
 * comparable matches, never float a weak match above a strong one — a clinic
 * with 900 reviews still should not outrank the doctor you typed the name of.
 *
 * The credential term reads `licensed`, not `verified`: `verified` now means
 * "is paying", and a paid plan buying a nudge in *text relevance* is not a
 * deal anyone agreed to. Placement is what a plan buys, and that is applied
 * once, visibly, in applyFilters.
 */
function qualityOf(p: Provider): number {
    const reviews = Math.log1p(Math.max(0, p.reviewCount || 0)) / Math.log1p(1000); // ~0–1
    const rating = Math.max(0, Math.min(2, (p.rating || 0) - 3)) / 2;               // 0–1
    return 1 + 0.15 * reviews + 0.15 * rating + (p.licensed ? 0.05 : 0);
}

/**
 * Every service name a provider publishes, in both languages.
 *
 * The directory loads the lean `provider_list` view, which carries the names
 * pre-flattened as `service_names` (Spanish and English, de-duplicated). Mock
 * data and full rows carry the `services` menu instead; both shapes answer
 * the same question here.
 */
export function serviceNamesOf(p: Pick<Provider, 'serviceNames' | 'services'>): string[] {
    if (p.serviceNames) return p.serviceNames;
    const out: string[] = [];
    for (const s of p.services ?? []) {
        if (s.name) out.push(s.name);
        if (s.nameEn && s.nameEn !== s.name) out.push(s.nameEn);
    }
    return out;
}

/**
 * Fold every searchable field of every provider, once.
 *
 * `labelOf` resolves a specialty key to its label in the active UI language;
 * the English label is always folded in as well, so "dentist" and "dentista"
 * both work no matter which language the interface is in.
 */
export function buildSearchIndex(
    providers: readonly Provider[],
    labelOf: (s: Specialty) => string,
): Map<string, SearchDoc> {
    const index = new Map<string, SearchDoc>();

    for (const p of providers) {
        const specialtyParts: string[] = [];
        for (const s of p.specialty) {
            specialtyParts.push(s, labelOf(s), SpecialtyLabels[s] ?? s);
        }

        index.set(p.id, {
            id: p.id,
            name: fold(p.name ?? ''),
            specialty: fold(specialtyParts.join('|')),
            service: fold(serviceNamesOf(p).join('|')),
            city: fold(p.city ?? ''),
            address: fold(p.address ?? ''),
            insurance: fold((p.insurances ?? []).join('|')),
            quality: qualityOf(p),
            promoted: p.promoted,
        });
    }

    return index;
}
