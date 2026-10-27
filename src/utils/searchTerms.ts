import { fold } from './search';
import type { Specialty } from '../types/provider';

/**
 * A fixed vocabulary of *services*, so demand can be reported without ever
 * sending what someone typed.
 *
 * A search box on a health directory collects symptoms, so its text never goes
 * into an analytics event (see lib/posthog.ts). This is the compromise: the text
 * is matched on the device against the list below, and only the ids of the terms
 * that matched are sent. "cuanto cuesta un implante dental" becomes `implants`;
 * anything not in the list becomes nothing.
 *
 * Two rules for what may be added here:
 *   • Services, procedures and kinds of doctor only. Never a diagnosis, a
 *     condition or a symptom ("diabetes", "depression", "back pain"): tied to a
 *     signed-in person, that is a statement about their health.
 *   • Keep it to things a clinic could plausibly offer, because the point is to
 *     tell a clinic what people want that it can sell.
 *   • Nothing in reproductive, sexual or mental health (no fertility, contraception,
 *     prenatal, vasectomy, therapy). Those are the searches most worth protecting
 *     if an analytics record were ever tied to a person, and the specialty-level
 *     signal (OB/GYN, mental health) already says enough to a clinic.
 *
 * Words are matched as folded (lower-case, accent-free) whole-word prefixes, so
 * "implant" covers implante/implantes/implants.
 */
const TERMS: ReadonlyArray<readonly [id: string, words: readonly string[], specialties: readonly Specialty[]]> = [
    // Dental
    ['dental_implants', ['implante', 'implantes', 'implant', 'implants'], ['dentist']],
    ['braces', ['brackets', 'braces', 'frenos', 'ortodoncia', 'orthodontic', 'invisalign'], ['orthodontist', 'dentist']],
    ['teeth_whitening', ['blanqueamiento', 'whitening'], ['dentist']],
    ['root_canal', ['endodoncia', 'root canal', 'conducto'], ['dentist']],
    ['dental_cleaning', ['limpieza dental', 'dental cleaning', 'profilaxis'], ['dentist']],
    ['crowns_veneers', ['corona', 'coronas', 'crown', 'crowns', 'carilla', 'carillas', 'veneer', 'veneers'], ['dentist']],
    ['tooth_extraction', ['extraccion', 'extraction', 'muela del juicio', 'wisdom'], ['dentist']],
    ['dentures', ['dentadura', 'dentaduras', 'denture', 'dentures', 'protesis dental'], ['dentist']],
    ['all_on_4', ['all on 4', 'all-on-4', 'all on four'], ['dentist']],
    // Cosmetic / surgery
    ['botox_fillers', ['botox', 'relleno', 'rellenos', 'filler', 'fillers', 'acido hialuronico'], ['aesthetician', 'plastic_surgery']],
    ['rhinoplasty', ['rinoplastia', 'rhinoplasty', 'nose job'], ['plastic_surgery']],
    ['liposuction', ['liposuccion', 'liposuction'], ['plastic_surgery']],
    ['breast_surgery', ['aumento de busto', 'mamoplastia', 'breast', 'implantes mamarios'], ['plastic_surgery']],
    ['tummy_tuck', ['abdominoplastia', 'tummy tuck'], ['plastic_surgery']],
    ['bariatric', ['bariatrica', 'bariatric', 'manga gastrica', 'gastric sleeve', 'bypass'], ['general', 'gastroenterology']],
    ['hair_removal', ['depilacion laser', 'laser hair', 'hair removal'], ['aesthetician']],
    ['hair_transplant', ['injerto capilar', 'hair transplant', 'trasplante capilar'], ['plastic_surgery', 'aesthetician']],
    ['skin_treatments', ['facial', 'peeling', 'microneedling', 'microdermoabrasion'], ['aesthetician']],
    // Eyes
    ['lasik', ['lasik', 'cirugia laser ojos', 'laser eye'], ['optometry']],
    ['eye_exam', ['examen de la vista', 'eye exam', 'lentes', 'glasses', 'anteojos', 'contact lenses'], ['optometry']],
    ['cataract_surgery', ['cataratas', 'cataract'], ['optometry']],
    // Family
    ['pediatric_checkup', ['pediatra', 'pediatrician', 'chequeo infantil', 'well child'], ['pediatrics']],
    ['vaccines', ['vacuna', 'vacunas', 'vaccine', 'vaccines', 'vaccination'], ['general', 'pediatrics']],
    // Everyday medicine
    ['checkup', ['chequeo', 'checkup', 'check-up', 'revision general', 'physical exam'], ['general']],
    ['lab_tests', ['laboratorio', 'lab test', 'analisis de sangre', 'blood test'], ['general']],
    ['imaging', ['ultrasonido', 'ultrasound', 'rayos x', 'x-ray', 'xray', 'resonancia', 'mri', 'tomografia'], ['general']],
    ['urgent_care', ['urgencias', 'urgent care', 'emergencia', 'emergency', 'walk in', 'walk-in'], ['urgent_care']],
    ['telehealth', ['telemedicina', 'telehealth', 'consulta en linea', 'online consult', 'virtual visit'], ['telehealth']],
    ['prescriptions', ['receta', 'recetas', 'prescription', 'farmacia', 'pharmacy', 'medicamentos'], ['pharmacy']],
    ['second_opinion', ['segunda opinion', 'second opinion'], ['general']],
    // Therapy and wellness
    ['physical_therapy', ['fisioterapia', 'physical therapy', 'rehabilitacion', 'rehab'], ['physical_therapy']],
    ['massage', ['masaje', 'masajes', 'massage', 'masoterapia'], ['massage']],
    ['chiropractic', ['quiropractico', 'chiropractor', 'chiropractic', 'quiropraxia'], ['physical_therapy']],
    ['acupuncture', ['acupuntura', 'acupuncture'], ['physical_therapy']],
    ['nutrition', ['nutriologo', 'nutricionista', 'nutritionist', 'dietitian', 'nutricion'], ['general']],
    ['sleep_study', ['estudio del sueno', 'sleep study'], ['neurology']],
    // Procedures people shop around for across the border
    ['dermatology_visit', ['dermatologo', 'dermatologist', 'dermatologia'], ['aesthetician']],
    ['cardiology_visit', ['cardiologo', 'cardiologist', 'electrocardiograma', 'ecg'], ['cardiology']],
    ['orthopedic_visit', ['ortopedista', 'orthopedic', 'traumatologo'], ['orthopedics']],
    ['endoscopy', ['endoscopia', 'endoscopy', 'colonoscopia', 'colonoscopy'], ['gastroenterology']],
    ['english_speaking', ['habla ingles', 'english speaking', 'speaks english'], []],
    ['spanish_speaking', ['habla espanol', 'spanish speaking'], []],
];

/** Pre-folded once so matching a query costs a few substring checks. */
const COMPILED = TERMS.map(([id, words, specialties]) => ({ id, words: words.map(fold), specialties }));

/**
 * Does `needle` start a word in `haystack`? Longer needles may continue into a
 * longer word ("implant" hits "implantes"); short ones (four characters or
 * fewer: "diu", "mri", "fiv") must be the whole word, or "diu" would hit
 * "diurno".
 */
function hasWord(haystack: string, needle: string): boolean {
    const whole = needle.length <= 4;
    let at = haystack.indexOf(needle);
    while (at !== -1) {
        const before = at === 0 || !/[a-z0-9]/.test(haystack[at - 1]);
        const end = at + needle.length;
        const after = end === haystack.length || !/[a-z0-9]/.test(haystack[end]);
        if (before && (!whole || after)) return true;
        at = haystack.indexOf(needle, at + 1);
    }
    return false;
}

/**
 * The dictionary terms a search mentions (at most `max`), with the specialties
 * those services belong to. Both empty when the text names nothing in the
 * vocabulary — the common case, and fine.
 */
export function matchSearchTerms(text: string, max = 5): { terms: string[]; specialties: Specialty[] } {
    const folded = fold(text).replace(/[^a-z0-9 -]+/g, ' ');
    if (folded.trim().length < 3) return { terms: [], specialties: [] };
    const terms: string[] = [];
    const specialties = new Set<Specialty>();
    for (const { id, words, specialties: hint } of COMPILED) {
        if (words.some((w) => hasWord(folded, w))) {
            terms.push(id);
            hint.forEach((s) => specialties.add(s));
            if (terms.length >= max) break;
        }
    }
    return { terms, specialties: [...specialties] };
}
