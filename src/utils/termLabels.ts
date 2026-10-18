/**
 * Human names for the ids in `searchTerms.ts`, for the demand panel a Featured
 * clinic sees ("people searched for: dental implants"). Kept apart from the
 * matcher because only the dashboard needs them.
 */
const LABELS: Record<string, { en: string; es: string }> = {
    dental_implants: { en: 'Dental implants', es: 'Implantes dentales' },
    braces: { en: 'Braces / orthodontics', es: 'Ortodoncia y brackets' },
    teeth_whitening: { en: 'Teeth whitening', es: 'Blanqueamiento dental' },
    root_canal: { en: 'Root canal', es: 'Endodoncia' },
    dental_cleaning: { en: 'Dental cleaning', es: 'Limpieza dental' },
    crowns_veneers: { en: 'Crowns & veneers', es: 'Coronas y carillas' },
    tooth_extraction: { en: 'Tooth extraction', es: 'Extracción dental' },
    dentures: { en: 'Dentures', es: 'Dentaduras' },
    all_on_4: { en: 'All-on-4', es: 'All-on-4' },
    botox_fillers: { en: 'Botox & fillers', es: 'Botox y rellenos' },
    rhinoplasty: { en: 'Rhinoplasty', es: 'Rinoplastia' },
    liposuction: { en: 'Liposuction', es: 'Liposucción' },
    breast_surgery: { en: 'Breast surgery', es: 'Cirugía de busto' },
    tummy_tuck: { en: 'Tummy tuck', es: 'Abdominoplastia' },
    bariatric: { en: 'Bariatric surgery', es: 'Cirugía bariátrica' },
    hair_removal: { en: 'Laser hair removal', es: 'Depilación láser' },
    hair_transplant: { en: 'Hair transplant', es: 'Injerto capilar' },
    skin_treatments: { en: 'Facials & skin treatments', es: 'Faciales y cuidado de la piel' },
    lasik: { en: 'LASIK', es: 'LASIK' },
    eye_exam: { en: 'Eye exam & glasses', es: 'Examen de la vista y lentes' },
    cataract_surgery: { en: 'Cataract surgery', es: 'Cirugía de cataratas' },
    pediatric_checkup: { en: 'Pediatric checkup', es: 'Chequeo pediátrico' },
    vaccines: { en: 'Vaccines', es: 'Vacunas' },
    checkup: { en: 'General checkup', es: 'Chequeo general' },
    lab_tests: { en: 'Lab tests', es: 'Estudios de laboratorio' },
    imaging: { en: 'Imaging & ultrasound', es: 'Imagen y ultrasonido' },
    urgent_care: { en: 'Urgent care', es: 'Urgencias' },
    telehealth: { en: 'Telehealth', es: 'Telemedicina' },
    prescriptions: { en: 'Prescriptions & pharmacy', es: 'Recetas y farmacia' },
    second_opinion: { en: 'Second opinion', es: 'Segunda opinión' },
    physical_therapy: { en: 'Physical therapy', es: 'Fisioterapia' },
    massage: { en: 'Massage', es: 'Masajes' },
    chiropractic: { en: 'Chiropractic', es: 'Quiropráctica' },
    acupuncture: { en: 'Acupuncture', es: 'Acupuntura' },
    nutrition: { en: 'Nutrition', es: 'Nutrición' },
    sleep_study: { en: 'Sleep study', es: 'Estudio del sueño' },
    dermatology_visit: { en: 'Dermatologist', es: 'Dermatólogo' },
    cardiology_visit: { en: 'Cardiologist', es: 'Cardiólogo' },
    orthopedic_visit: { en: 'Orthopedist', es: 'Ortopedista' },
    endoscopy: { en: 'Endoscopy / colonoscopy', es: 'Endoscopía y colonoscopía' },
    english_speaking: { en: 'English-speaking doctor', es: 'Doctor que hable inglés' },
    spanish_speaking: { en: 'Spanish-speaking doctor', es: 'Doctor que hable español' },
};

export function termLabel(id: string, lang: string): string {
    const l = LABELS[id];
    if (!l) return id.replace(/_/g, ' ');
    return lang.startsWith('es') ? l.es : l.en;
}
