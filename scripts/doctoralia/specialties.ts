import type { Specialty } from '../../src/types/provider';

/**
 * Every Doctoralia specialty slug that has a Ciudad Juárez landing page (86 as
 * of the sitemap read on 2026-08-25) or a Tijuana one (15 more, 2026-10-08), mapped onto the `Specialty` union in
 * src/types/provider.ts. Neurology, ENT and orthopedics were added later
 * (they used to fall into 'general'); the rows already loaded were re-tagged
 * by supabase/migrations/0019_new_specialties.sql.
 *
 * `Provider.specialty` is an array, so sub-specialties can carry two tags —
 * `cardiologo-pediatrico` is both cardiology and pediatrics, and a patient
 * filtering on either should find them.
 *
 * The raw Spanish specialization strings are preserved verbatim on the
 * doctoralia_doctors row; this mapping only drives the marketplace filters.
 */
export const SPECIALTY_MAP: Record<string, Specialty[]> = {
  // Dental
  'dentista-odontologo': ['dentist'],
  endodoncia: ['dentist'],
  periodoncia: ['dentist'],
  implantologo: ['dentist'],
  'odontologo-pediatra': ['dentist', 'pediatrics'],
  ortodoncista: ['orthodontist'],
  'cirujano-maxilofacial': ['dentist', 'plastic_surgery'],

  // Aesthetic & plastic
  'cirujano-plastico': ['plastic_surgery'],
  'cirujano-estetico-y-cosmetico': ['plastic_surgery'],
  'medico-estetico': ['aesthetician'],
  dermatologo: ['aesthetician', 'general'],

  // Women's health
  ginecologo: ['obgyn'],
  'ginecologo-oncologico': ['obgyn'],
  'urologia-ginecologica': ['obgyn'],

  // Rehab & bodywork
  fisioterapeuta: ['physical_therapy'],
  'especialista-en-rehabilitacion-y-medicina-fisica': ['physical_therapy'],
  quiropractico: ['physical_therapy'],
  'especialista-en-medicina-del-deporte': ['physical_therapy'],
  acupuntor: ['massage'],
  'terapeuta-complementario': ['massage'],
  naturista: ['massage'],
  'terapeuta-ocupacional': ['physical_therapy'],

  // Vision
  oftalmologo: ['optometry'],
  optometrista: ['optometry'],
  'especialista-en-retina-medica-y-quirurgica': ['optometry'],

  // Pediatrics
  pediatra: ['pediatrics'],
  neonatologo: ['pediatrics'],
  'cirujano-pediatrico': ['pediatrics'],
  'endocrinologo-pediatrico': ['pediatrics'],
  'gastroenterologo-pediatrico': ['pediatrics'],
  'hematologo-pediatra': ['pediatrics'],
  'nefrologo-pediatra': ['pediatrics'],
  'neurologo-infantil': ['neurology', 'pediatrics'],
  'cardiologo-pediatrico': ['cardiology', 'pediatrics'],
  'dermatologo-pediatrico': ['aesthetician', 'general', 'pediatrics'],
  'infectologo-pediatra': ['general', 'pediatrics'],
  'neumologo-pediatra': ['general', 'pediatrics'],
  'oncologo-pediatrico': ['general', 'pediatrics'],
  'ortopedista-infantil': ['orthopedics', 'pediatrics'],

  // Cardiology & vascular
  cardiologo: ['cardiology'],
  'cirujano-cardiovascular-y-toracico': ['cardiology'],
  angiologo: ['cardiology'],
  'cirujano-vascular': ['cardiology'],

  // Urgent / critical
  urgenciologo: ['urgent_care'],
  'especialista-en-medicina-critica-y-terapia-intensiva': ['urgent_care'],

  // Mental health
  psicologo: ['mental_health'],
  psiquiatra: ['mental_health'],
  psicoanalista: ['mental_health'],
  psicopedagogo: ['mental_health'],
  sexologo: ['mental_health'],

  // Primary, internal & everything else clinical
  'medico-general': ['general'],
  'medico-de-familia': ['general'],
  internista: ['general'],
  'especialista-en-medicina-integrada': ['general'],
  'especialista-en-medicina-del-trabajo': ['general'],
  geriatra: ['general'],
  homeopata: ['general'],
  enfermero: ['general'],
  nutricionista: ['general'],
  nutriologo: ['general'],
  'nutriologo-clinico': ['general'],
  'especialista-en-obesidad-y-delgadez': ['general'],
  diabetologo: ['general'],
  endocrinologo: ['general'],
  gastroenterologo: ['general'],
  hematologo: ['general'],
  infectologo: ['general'],
  inmunologo: ['general'],
  alergologo: ['general'],
  algologo: ['general'],
  nefrologo: ['general'],
  neumologo: ['general'],
  neurologo: ['neurology'],
  neurocirujano: ['neurology'],
  neurofisiologo: ['neurology'],
  otorrinolaringologo: ['otolaryngology'],
  reumatologo: ['general'],
  urologo: ['general'],
  proctologo: ['general'],
  traumatologo: ['orthopedics'],
  ortopedista: ['orthopedics'],
  'cirujano-de-la-mano': ['orthopedics'],
  podiatra: ['orthopedics'],
  podologo: ['orthopedics'],
  'cirujano-general': ['general'],
  'cirujano-toracico': ['general'],
  'analista-clinico': ['general'],
  'cirujano-bariatra': ['general'],
  'cirujano-oncologo': ['general'],
  'oncologo-medico': ['general'],
  'radio-oncologo': ['general'],
  radioterapeuta: ['general'],
  radiologo: ['general'],
  anestesiologo: ['general'],
  anatomopatologo: ['general'],
  patologo: ['general'],
  audiologo: ['otolaryngology'],
  foniatra: ['otolaryngology'],
  logopeda: ['otolaryngology'],
  genetista: ['general'],
  endoscopista: ['general'],

  // Clinic ("centro médico") landing pages use their own slug namespace.
  'clinicas/odontologia': ['dentist'],
  'clinicas/cirugia-maxilofacial': ['dentist', 'plastic_surgery'],
  'clinicas/cirugia-plastica-estetica-y-reconstructiva': ['plastic_surgery'],
  'clinicas/ginecologia-y-obstetricia': ['obgyn'],
  'clinicas/fisioterapia': ['physical_therapy'],
  'clinicas/rehabilitacion-y-medicina-fisica': ['physical_therapy'],
  'clinicas/medicina-complementaria': ['massage'],
  'clinicas/oftalmologia': ['optometry'],
  'clinicas/pediatria': ['pediatrics'],
  'clinicas/cirugia-pediatrica': ['pediatrics'],
  'clinicas/cardiologia': ['cardiology'],
  'clinicas/angiologia-y-cirugia-vascular': ['cardiology'],
  'clinicas/medicina-critica-y-terapia-intensiva': ['urgent_care'],
  'clinicas/psicologia': ['mental_health'],
  'clinicas/psiquiatria': ['mental_health'],
  'clinicas/medicina-general': ['general'],
  'clinicas/medicina-familiar': ['general'],
  'clinicas/medicina-interna': ['general'],
  'clinicas/alergologia': ['general'],
  'clinicas/anestesiologia': ['general'],
  'clinicas/cirugia-general': ['general'],
  'clinicas/gastroenterologia': ['general'],
  'clinicas/nefrologia': ['general'],
  'clinicas/neumologia': ['general'],
  'clinicas/neurocirugia': ['neurology'],
  'clinicas/nutriologia-clinica': ['general'],
  'clinicas/nutrologia': ['general'],
  'clinicas/oncologia-medica': ['general'],
  'clinicas/ortopedia': ['orthopedics'],
  'clinicas/otorrinolaringologia': ['otolaryngology'],
  'clinicas/reumatologia': ['general'],
  'clinicas/urologia': ['general'],
  'clinicas/cirugia-estetica-y-cosmetica': ['plastic_surgery'],
  'clinicas/medicina-estetica': ['aesthetician'],
  'clinicas/dermatologia': ['aesthetician', 'general'],
  'clinicas/traumatologia': ['orthopedics'],
  'clinicas/cirugia-oncologica': ['general'],
  'clinicas/geriatria': ['general'],
  'clinicas/hematologia': ['general'],
  'clinicas/radiologia': ['general'],
};

/** Slugs whose landing page exists in the scraped city but which we have not classified yet. */
export function unmappedSlugs(slugs: string[]): string[] {
  return slugs.filter((s) => !SPECIALTY_MAP[s]);
}

export function mapSpecialties(slugs: string[]): Specialty[] {
  const out = new Set<Specialty>();
  for (const slug of slugs) {
    for (const s of SPECIALTY_MAP[slug] ?? ['general']) out.add(s);
  }
  return [...out];
}
