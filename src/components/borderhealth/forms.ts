/**
 * The three intake forms, ported verbatim from the static survey
 * (borderhealth.dropdev.co, index.html `FORMS`, form_version v2).
 *
 * Option keys (`v`) and English labels are what lands in
 * bh_responses.answers, so they must never change once data exists.
 * Change only the Spanish/English copy of a label, and only with care.
 * Generated from the original source text; see the id/key diff in the port.
 */
import type { BhSegment } from './types';

export const FORM_VERSION = 'v2';

export interface Loc { es: string; en: string }
export interface Opt extends Loc {
    v: string;
    /** select only: which <optgroup> the option sits under. */
    g?: string;
}
export type QType = 'single' | 'multi' | 'text' | 'textarea' | 'top' | 'select';
/** [questionId, value or list of values] */
export type Cond = [string, string | string[]];

export interface Question extends Loc {
    id: string;
    type: QType;
    opts: Opt[] | null;
    required?: boolean;
    /** Adds "Other (type which)" with a text box, stored as `<id>_other`. */
    other?: boolean;
    /** Picking one of these clears the rest (multi). */
    exclusive?: string[];
    /** multi: pick limit. text/textarea: character limit. */
    max?: number;
    showIf?: Cond;
    hideIf?: Cond;
    /** top: the multi question whose picks become the options. */
    from?: string;
    /** select only: optgroup labels. */
    groups?: Record<string, Loc>;
    ph_es?: string;
    ph_en?: string;
    inputType?: 'text' | 'url';
}

export interface Screen extends Loc {
    id: string;
    qs: Question[];
    contact?: 'full' | 'light';
}

export type ContactField = 'name' | 'org' | 'email' | 'phone' | 'whatsapp';
export interface ContactDef extends Loc {
    type: 'text' | 'email' | 'tel';
    ac: string;
}

type QExtra = Partial<Omit<Question, 'id' | 'type' | 'es' | 'en' | 'opts'>>;

export function o(v: string, es: string, en: string): Opt { return { v, es, en }; }

function q(id: string, type: QType, es: string, en: string, opts: Opt[] | null, extra?: QExtra): Question {
    return { id, type, es, en, opts: opts || null, ...(extra || {}) };
}
/** "Which one matters most", built from whatever was picked in `from`. */
function top(from: string): Question {
    return q(from + '_top', 'top', TOP_ES, TOP_EN, null, { from, required: true });
}
/** Optional "which state are you from" dropdown, the same list on every form. */
function stateQ(es: string, en: string): Question {
    return q('state', 'select', es, en, STATES, { groups: STATE_GROUPS });
}
function sc(id: string, es: string, en: string, qs: Question[], extra?: { contact?: 'full' | 'light' }): Screen {
    return { id, es, en, qs, ...(extra || {}) };
}

export const INDUSTRY: Opt[] = [
  o('manufacturing', 'Manufactura / maquila', 'Manufacturing / maquila'),
  o('healthcare', 'Salud', 'Healthcare'),
  o('retail', 'Comercio', 'Retail'),
  o('logistics', 'Logística y transporte', 'Logistics and transport'),
  o('construction', 'Construcción', 'Construction'),
  o('professional', 'Servicios profesionales', 'Professional services'),
  o('hospitality', 'Restaurantes y hotelería', 'Restaurants and hospitality'),
  o('education', 'Educación', 'Education'),
  o('government', 'Gobierno', 'Government'),
  o('utilities', 'Servicios públicos (luz, agua, gas)', 'Utilities (power, water, gas)'),
  o('tech', 'Tecnología', 'Technology'),
  o('agriculture', 'Agricultura', 'Agriculture')
];
/* "Another border area" and "Somewhere else" were the same answer; one
   Other with a text box replaces both. */
export const PLACE: Opt[] = [
  o('juarez', 'Ciudad Juárez', 'Ciudad Juárez'),
  o('elpaso', 'El Paso', 'El Paso'),
  o('both', 'Ambos lados', 'Both sides')
];
export const RECENCY: Opt[] = [
  o('6m', 'Hace menos de 6 meses', 'Less than 6 months ago'),
  o('12m', 'Hace 6 a 12 meses', '6 to 12 months ago'),
  o('2y', 'Hace 1 a 2 años', '1 to 2 years ago'),
  o('2y_plus', 'Hace más de 2 años', 'More than 2 years ago'),
  o('dont_remember', 'No recuerdo', 'I do not remember')
];
export const YNC: Opt[] = [ o('yes', 'Sí', 'Yes'), o('no', 'No', 'No'), o('considering', 'Lo estamos considerando', 'Considering it') ];
const TOP_ES = 'De esas, ¿cuál es la más importante?';
const TOP_EN = 'Of those, which one matters most?';

/* Records question (Kevyn): only for people who actually get care on the
   other side, or providers who actually see patients from it. */
export const RECORDS_OPTS: Opt[] = [
  o('no_history', 'El médico no tiene mis expedientes anteriores', 'The provider does not have my previous records'),
  o('carry', 'Tengo que llevarlos o enviarlos yo', 'I have to bring or send them myself'),
  o('language', 'Están en otro idioma', 'They are in another language'),
  o('results', 'Es difícil pasar resultados de estudios', 'Test results are hard to transfer'),
  o('repeat', 'Tengo que repetir estudios o procedimientos', 'Tests or procedures have to be repeated'),
  o('no_problem', 'No he tenido problemas', 'I have not had any problems')
];


/* ------------------------------------------------------- state / region */
/* Option keys are ISO 3166-2 codes with a country prefix. They land in
   bh_responses.answers.state_key and must never change. */
const MX_STATES: [string, string, string][] = [
  ['AGU', 'Aguascalientes', 'Aguascalientes'], ['BCN', 'Baja California', 'Baja California'],
  ['BCS', 'Baja California Sur', 'Baja California Sur'], ['CAM', 'Campeche', 'Campeche'],
  ['CHP', 'Chiapas', 'Chiapas'], ['CHH', 'Chihuahua', 'Chihuahua'],
  ['CMX', 'Ciudad de México', 'Mexico City'], ['COA', 'Coahuila', 'Coahuila'],
  ['COL', 'Colima', 'Colima'], ['DUR', 'Durango', 'Durango'],
  ['MEX', 'Estado de México', 'State of Mexico'], ['GUA', 'Guanajuato', 'Guanajuato'],
  ['GRO', 'Guerrero', 'Guerrero'], ['HID', 'Hidalgo', 'Hidalgo'],
  ['JAL', 'Jalisco', 'Jalisco'], ['MIC', 'Michoacán', 'Michoacán'],
  ['MOR', 'Morelos', 'Morelos'], ['NAY', 'Nayarit', 'Nayarit'],
  ['NLE', 'Nuevo León', 'Nuevo León'], ['OAX', 'Oaxaca', 'Oaxaca'],
  ['PUE', 'Puebla', 'Puebla'], ['QUE', 'Querétaro', 'Querétaro'],
  ['ROO', 'Quintana Roo', 'Quintana Roo'], ['SLP', 'San Luis Potosí', 'San Luis Potosí'],
  ['SIN', 'Sinaloa', 'Sinaloa'], ['SON', 'Sonora', 'Sonora'],
  ['TAB', 'Tabasco', 'Tabasco'], ['TAM', 'Tamaulipas', 'Tamaulipas'],
  ['TLA', 'Tlaxcala', 'Tlaxcala'], ['VER', 'Veracruz', 'Veracruz'],
  ['YUC', 'Yucatán', 'Yucatán'], ['ZAC', 'Zacatecas', 'Zacatecas']
];
const US_STATES: [string, string, string][] = [
  ['AL', 'Alabama', 'Alabama'], ['AK', 'Alaska', 'Alaska'], ['AZ', 'Arizona', 'Arizona'],
  ['AR', 'Arkansas', 'Arkansas'], ['CA', 'California', 'California'], ['NC', 'Carolina del Norte', 'North Carolina'],
  ['SC', 'Carolina del Sur', 'South Carolina'], ['CO', 'Colorado', 'Colorado'], ['CT', 'Connecticut', 'Connecticut'],
  ['ND', 'Dakota del Norte', 'North Dakota'], ['SD', 'Dakota del Sur', 'South Dakota'], ['DE', 'Delaware', 'Delaware'],
  ['DC', 'Distrito de Columbia (Washington, D.C.)', 'District of Columbia (Washington, D.C.)'], ['FL', 'Florida', 'Florida'],
  ['GA', 'Georgia', 'Georgia'], ['HI', 'Hawái', 'Hawaii'], ['ID', 'Idaho', 'Idaho'],
  ['IL', 'Illinois', 'Illinois'], ['IN', 'Indiana', 'Indiana'], ['IA', 'Iowa', 'Iowa'],
  ['KS', 'Kansas', 'Kansas'], ['KY', 'Kentucky', 'Kentucky'], ['LA', 'Luisiana', 'Louisiana'],
  ['ME', 'Maine', 'Maine'], ['MD', 'Maryland', 'Maryland'], ['MA', 'Massachusetts', 'Massachusetts'],
  ['MI', 'Míchigan', 'Michigan'], ['MN', 'Minnesota', 'Minnesota'], ['MS', 'Misisipi', 'Mississippi'],
  ['MO', 'Misuri', 'Missouri'], ['MT', 'Montana', 'Montana'], ['NE', 'Nebraska', 'Nebraska'],
  ['NV', 'Nevada', 'Nevada'], ['NH', 'Nuevo Hampshire', 'New Hampshire'], ['NJ', 'Nueva Jersey', 'New Jersey'],
  ['NM', 'Nuevo México', 'New Mexico'], ['NY', 'Nueva York', 'New York'], ['OH', 'Ohio', 'Ohio'],
  ['OK', 'Oklahoma', 'Oklahoma'], ['OR', 'Oregón', 'Oregon'], ['PA', 'Pensilvania', 'Pennsylvania'],
  ['RI', 'Rhode Island', 'Rhode Island'], ['TN', 'Tennessee', 'Tennessee'], ['TX', 'Texas', 'Texas'],
  ['UT', 'Utah', 'Utah'], ['VT', 'Vermont', 'Vermont'], ['VA', 'Virginia', 'Virginia'],
  ['WV', 'Virginia Occidental', 'West Virginia'], ['WA', 'Washington', 'Washington'],
  ['WI', 'Wisconsin', 'Wisconsin'], ['WY', 'Wyoming', 'Wyoming']
];
export const STATES: Opt[] = [
  ...MX_STATES.map(([c, es, en]): Opt => ({ v: 'MX-' + c, es, en, g: 'MX' })),
  ...US_STATES.map(([c, es, en]): Opt => ({ v: 'US-' + c, es, en, g: 'US' })),
  { v: 'other_country', es: 'Otro país', en: 'Another country', g: 'XX' }
];
const STATE_GROUPS: Record<string, Loc> = {
  MX: { es: 'México', en: 'Mexico' },
  US: { es: 'Estados Unidos', en: 'United States' },
  XX: { es: 'Otro', en: 'Other' }
};

/* ------------------------------------------------------------- forms */
export const FORMS: Record<BhSegment, Screen[]> = {
  employer: [
    sc('org', 'Su empresa', 'Your organization', [
      q('industry', 'single', '¿En qué industria está su empresa?', 'What industry is your organization in?', INDUSTRY, { required: true, other: true }),
      q('size', 'single', '¿Cuántas personas trabajan ahí?', 'How many people work there?', [
        o('1_10', '1 a 10', '1 to 10'), o('11_50', '11 a 50', '11 to 50'), o('51_250', '51 a 250', '51 to 250'),
        o('251_1000', '251 a 1,000', '251 to 1,000'), o('1000_plus', 'Más de 1,000', 'More than 1,000')
      ], { required: true }),
      q('where', 'single', '¿Dónde está la mayoría de su personal?', 'Where are most of your employees based?', PLACE, { required: true, other: true }),
      stateQ('¿En qué estado está su empresa?', 'Which state is your company based in?'),
      q('role', 'single', '¿Cuál es su rol?', 'What is your role?', [
        o('owner', 'Dueño o socio', 'Owner or partner'), o('hr', 'Recursos humanos', 'HR'),
        o('manager', 'Gerente o director', 'Manager or director'), o('finance', 'Finanzas o administración', 'Finance or admin')
      ], { required: true, other: true })
    ]),
    sc('coverage', 'Cobertura de salud hoy', 'Health coverage today', [
      q('coverage', 'multi', '¿Qué cobertura de salud tiene su personal?', 'What health coverage do your employees have?', [
        o('public_only', 'Solo la pública (IMSS, ISSSTE)', 'Public only (IMSS, ISSSTE)'),
        o('private_employer', 'Seguro privado que paga la empresa', 'Private insurance the company pays for'),
        o('us_plan', 'Plan de seguro de Estados Unidos', 'A US-based insurance plan'),
        o('direct_docs', 'Convenio directo con médicos o clínicas', 'Direct arrangement with doctors or clinics'),
        o('none', 'Nada más allá de lo que exige la ley', 'Nothing beyond what the law requires'),
        o('unsure', 'No estoy seguro', 'Not sure'),
        o('private', 'Prefiero no decir', 'Prefer not to say')
      ], { required: true, exclusive: ['none', 'unsure', 'private'], other: true }),
      q('insurers', 'text', '¿Con qué aseguradora o plan?', 'Which insurer or plan?', null, { ph_es: 'Por ejemplo: Seguros Monterrey, GNP, AXA, Blue Cross', ph_en: 'For example: Seguros Monterrey, GNP, AXA, Blue Cross' }),
      q('crossing', 'single', '¿Su personal cruza la frontera para atenderse?', 'Do your employees cross the border for care?', [
        o('often', 'Seguido', 'Often'), o('sometimes', 'A veces', 'Sometimes'), o('rarely', 'Casi nunca', 'Rarely'), o('unsure', 'No sé', 'Not sure')
      ], { required: true })
    ]),
    sc('practice', 'Cuando alguien necesita atención', 'When someone needs care', [
      q('help_how', 'multi', 'Cuando un empleado necesita atención médica, ¿cómo le ayuda hoy su empresa?', 'When an employee needs medical care, how does your company help them today?', [
        o('insurance', 'Lo canaliza al seguro', 'Points them to the insurance'),
        o('onsite', 'Médico o enfermería en la empresa', 'On-site doctor or nurse'),
        o('refer', 'Le recomienda médicos o clínicas', 'Recommends doctors or clinics'),
        o('time_off', 'Le da permiso para ir a consulta', 'Gives time off for the appointment'),
        o('reimburse', 'Le reembolsa o adelanta el pago', 'Reimburses or advances the cost'),
        o('own', 'El empleado lo resuelve por su cuenta', 'The employee handles it on their own'),
        o('unsure', 'No sé', 'Not sure')
      ], { required: true, exclusive: ['own', 'unsure'], other: true }),
      q('difficulties', 'multi', '¿Qué es lo más difícil de ese proceso?', 'What is the hardest part of that process?', [
        o('cost', 'El costo', 'Cost'),
        o('availability', 'Que haya médicos disponibles', 'Provider availability'),
        o('paperwork', 'Trámites y papeleo', 'Paperwork'),
        o('language', 'El idioma', 'Language barriers'),
        o('coverage_limits', 'La cobertura no alcanza', 'Limited coverage'),
        o('info', 'Falta de información', 'Lack of information'),
        o('absence', 'Las faltas al trabajo', 'Time away from work'),
        o('none', 'Ninguna', 'None'),
        o('unsure', 'No sé', 'Not sure')
      ], { required: true, max: 3, exclusive: ['none', 'unsure'], other: true }),
      top('difficulties'),
      q('change', 'textarea', 'Si pudiera cambiar una cosa de cómo su equipo recibe atención médica, ¿cuál sería?', 'If you could change one thing about how your team gets healthcare, what would it be?', null, { max: 600 })
    ]),
    sc('contact', 'Para darle seguimiento', 'So we can follow up', [], { contact: 'full' })
  ],

  employee: [
    sc('you', 'Sobre usted', 'About you', [
      q('industry', 'single', '¿En qué industria trabaja?', 'What industry do you work in?',
        [...INDUSTRY, o('not_working', 'No trabajo actualmente', 'I do not currently work')], { required: true, other: true }),
      q('work_where', 'single', '¿Dónde trabaja?', 'Where do you work?',
        [...PLACE, o('not_working', 'No trabajo actualmente', 'I do not currently work')], { required: true, other: true }),
      q('live_where', 'single', '¿Dónde vive?', 'Where do you live?', [
        o('juarez', 'Ciudad Juárez', 'Ciudad Juárez'), o('elpaso', 'El Paso', 'El Paso')
      ], { required: true, other: true }),
      stateQ('¿De qué estado es usted?', 'Which state are you from?')
    ]),
    sc('coverage', 'Su cobertura', 'Your coverage', [
      q('coverage', 'multi', '¿Qué cobertura de salud tiene hoy?', 'What health coverage do you have today?', [
        o('public', 'IMSS, ISSSTE u otra pública', 'IMSS, ISSSTE or other public'),
        o('employer_private', 'Seguro privado por mi trabajo', 'Private insurance through my job'),
        o('self_private', 'Seguro privado que pago yo', 'Private insurance I pay for myself'),
        o('us_insurance', 'Seguro de Estados Unidos', 'US insurance'),
        o('medicaid_medicare', 'Medicaid o Medicare', 'Medicaid or Medicare'),
        o('none', 'Ninguna', 'None'), o('unsure', 'No estoy seguro', 'Not sure')
      ], { required: true, exclusive: ['none', 'unsure'] }),
      q('tier', 'single', 'Si su trabajo ofrece planes, ¿cuál eligió?', 'If your job offers plans, which did you choose?', [
        o('cheapest', 'El más barato', 'The cheapest'), o('middle', 'El intermedio', 'The middle one'),
        o('highest', 'El más completo', 'The most complete'), o('no_choice', 'No hubo opción', 'There was no choice'),
        o('na', 'No aplica', 'Not applicable')
      ]),
      /* Pay comes in the currency of where you work: pesos in Juárez,
         dollars everywhere else. One currency per answer, no conversions. */
      q('deduction', 'single', 'Aproximadamente, ¿cuánto le descuentan al mes por la cobertura de salud?', 'Roughly, how much comes out of your pay each month for health coverage?', [
        o('none', 'Nada', 'Nothing'), o('under500', 'Menos de $500 pesos', 'Under 500 pesos'),
        o('500_1500', '$500 a $1,500 pesos', '500 to 1,500 pesos'),
        o('1500_3000', '$1,500 a $3,000 pesos', '1,500 to 3,000 pesos'),
        o('over3000', 'Más de $3,000 pesos', 'Over 3,000 pesos'),
        o('unsure', 'No sé', 'Not sure'), o('private', 'Prefiero no decir', 'Prefer not to say')
      ], { showIf: ['work_where', 'juarez'] }),
      q('deduction_usd', 'single', 'Aproximadamente, ¿cuánto le descuentan al mes por la cobertura de salud?', 'Roughly, how much comes out of your pay each month for health coverage?', [
        o('none', 'Nada', 'Nothing'), o('under25', 'Menos de $25 dólares', 'Under $25'),
        o('25_80', '$25 a $80 dólares', '$25 to $80'), o('80_160', '$80 a $160 dólares', '$80 to $160'),
        o('160_400', '$160 a $400 dólares', '$160 to $400'), o('over400', 'Más de $400 dólares', 'Over $400'),
        o('unsure', 'No sé', 'Not sure'), o('private', 'Prefiero no decir', 'Prefer not to say')
      ], { showIf: ['work_where', ['elpaso', 'both', 'other']] })
    ]),
    sc('care', 'La última vez que necesitó atención', 'The last time you needed care', [
      q('last_doctor', 'single', '¿Cuándo fue su última consulta con un médico (sin contar urgencias)?', 'When did you last see a doctor (not counting emergencies)?', RECENCY, { required: true }),
      q('last_dentist', 'single', '¿Y su última visita al dentista?', 'And your last dental visit?', RECENCY, { required: true }),
      q('last_what', 'single', 'La última vez que necesitó atención médica, ¿qué hizo para recibirla?', 'The last time you needed medical care, what did you do to get it?', [
        o('own_doctor', 'Fui con mi médico de siempre', 'Went to my usual doctor'),
        o('public', 'Fui al IMSS o a una clínica pública', 'Went to IMSS or a public clinic'),
        o('pharmacy', 'Fui a un consultorio de farmacia', 'Went to a pharmacy clinic'),
        o('urgent', 'Fui a urgencias', 'Went to urgent care or the ER'),
        o('crossed', 'Crucé la frontera para atenderme', 'Crossed the border for care'),
        o('virtual', 'Tuve una consulta en línea', 'Had a virtual visit'),
        o('waited', 'Esperé o no fui', 'Waited or did not go'),
        o('dont_remember', 'No recuerdo', 'I do not remember')
      ], { required: true, other: true }),
      q('last_hardest', 'multi', '¿Qué fue lo más difícil de ese proceso?', 'What was the hardest part of that process?', [
        o('finding', 'Encontrar un médico', 'Finding a provider'),
        o('coverage', 'Confirmar qué cubre mi seguro', 'Confirming my coverage'),
        o('scheduling', 'Conseguir cita', 'Getting an appointment'),
        o('paying', 'Pagar', 'Paying'),
        o('transport', 'Transporte o el cruce', 'Transportation or the crossing'),
        o('communication', 'Comunicarme con el médico', 'Communicating with the provider'),
        o('paperwork', 'Trámites y papeleo', 'Paperwork'),
        o('time_off', 'Pedir permiso en el trabajo', 'Getting time off work'),
        o('nothing', 'Nada, fue fácil', 'Nothing, it was easy'),
        o('dont_remember', 'No recuerdo', 'I do not remember')
      ], { required: true, max: 3, exclusive: ['nothing', 'dont_remember'], other: true }),
      top('last_hardest'),
      q('workaround', 'multi', '¿Cómo lo resolvió?', 'How did you deal with it?', [
        o('crossed', 'Crucé la frontera', 'Crossed the border'),
        o('out_of_pocket', 'Pagué de mi bolsa', 'Paid out of pocket'),
        o('asked_help', 'Le pedí ayuda a alguien', 'Asked someone for help'),
        o('delayed', 'Lo dejé para después', 'Put off the care'),
        o('went_without', 'Me quedé sin atención', 'Went without care'),
        o('unsure', 'No sé', 'Not sure')
      ], { exclusive: ['unsure'], other: true, hideIf: ['last_hardest', ['nothing', 'dont_remember']] }),
      q('crossed', 'single', '¿Ha cruzado la frontera para atención médica o dental?', 'Have you crossed the border for medical or dental care?', [
        o('regularly', 'Sí, seguido', 'Yes, regularly'), o('few_times', 'Algunas veces', 'A few times'), o('never', 'Nunca', 'Never')
      ], { required: true }),
      q('records', 'multi', 'Cuando recibe atención médica en otro país, ¿qué dificultades tiene para acceder, compartir o dar seguimiento a sus expedientes médicos?', 'When you get care in another country, what problems do you have accessing, sharing, or following up on your medical records?',
        RECORDS_OPTS, { required: true, exclusive: ['no_problem'], other: true, showIf: ['crossed', ['regularly', 'few_times']] }),
      q('change', 'textarea', 'Si una sola cosa de conseguir atención médica fuera más fácil, ¿cuál sería?', 'If one thing about getting healthcare were easier, what would it be?', null, { max: 600 })
    ]),
    sc('contact', 'Solo si quiere que le contactemos', 'Only if you want us to follow up', [], { contact: 'light' })
  ],

  provider: [
    sc('practice', 'Su consultorio', 'Your practice', [
      q('practice_type', 'single', '¿Qué tipo de práctica tiene?', 'What kind of practice is it?', [
        o('gp', 'Medicina general', 'General practice'), o('specialist', 'Especialidad', 'Specialist'),
        o('dental', 'Dental', 'Dental'), o('vision', 'Optometría u oftalmología', 'Optometry or ophthalmology'),
        o('imaging_lab', 'Laboratorio o imagenología', 'Lab or imaging'), o('hospital', 'Hospital', 'Hospital'),
        o('pharmacy', 'Farmacia', 'Pharmacy')
      ], { required: true, other: true }),
      q('specialty', 'text', '¿Cuál especialidad?', 'Which specialty?', null, { showIf: ['practice_type', 'specialist'], ph_es: 'Por ejemplo: ortopedia', ph_en: 'For example: orthopedics' }),
      q('city', 'single', '¿Dónde está ubicado principalmente su consultorio?', 'Where is your practice mainly located?', [
        o('juarez', 'Ciudad Juárez', 'Ciudad Juárez'), o('elpaso', 'El Paso', 'El Paso'),
        o('tijuana', 'Tijuana', 'Tijuana'), o('sandiego', 'San Diego', 'San Diego'),
        o('chihuahua_city', 'Ciudad de Chihuahua', 'Chihuahua City')
      ], { required: true, other: true }),
      stateQ('¿En qué estado está su consultorio?', 'Which state is your practice in?'),
      q('size', 'single', '¿Cuántos médicos o profesionales atienden ahí?', 'How many doctors or clinicians see patients there?', [
        o('solo', 'Solo yo', 'Just me'), o('2_5', '2 a 5', '2 to 5'), o('6_20', '6 a 20', '6 to 20'), o('20_plus', 'Más de 20', 'More than 20')
      ], { required: true }),
      q('us_patients', 'single', 'Aproximadamente, ¿qué parte de sus pacientes viene del otro lado de la frontera?', 'Roughly what share of your patients come from across the border?', [
        o('none', 'Ninguno', 'None'), o('under10', 'Menos del 10%', 'Under 10%'), o('10_25', '10% a 25%', '10% to 25%'),
        o('25_50', '25% a 50%', '25% to 50%'), o('over50', 'Más del 50%', 'Over 50%'), o('unsure', 'No sé', 'Not sure')
      ], { required: true })
    ]),
    sc('find', 'Cómo lo encuentran y agendan', 'How patients find and book you', [
      q('presence', 'multi', '¿Dónde lo pueden encontrar los pacientes en línea?', 'Where can patients find you online?', [
        o('website', 'Sitio web', 'Website'), o('google', 'Perfil de Google', 'Google Business profile'),
        o('social', 'Facebook o Instagram', 'Facebook or Instagram'), o('whatsapp_business', 'WhatsApp Business', 'WhatsApp Business'),
        o('directory', 'Directorio médico (Doctoralia u otro)', 'Medical directory (Doctoralia or other)'), o('none', 'En ningún lado', 'Nowhere')
      ], { required: true, exclusive: ['none'] }),
      q('website', 'text', 'Su sitio web o perfil', 'Your website or profile', null, { ph_es: 'www.', ph_en: 'www.', inputType: 'url' }),
      q('booking', 'multi', '¿Cómo agendan los pacientes?', 'How do patients book?', [
        o('phone', 'Por teléfono', 'By phone'), o('whatsapp', 'Por WhatsApp', 'By WhatsApp'), o('walkin', 'Llegan sin cita', 'Walk in'),
        o('online', 'En línea', 'Online booking'), o('hospital', 'A través del hospital', 'Through the hospital'), o('referral', 'Por referencia', 'By referral')
      ], { required: true, other: true }),
      q('english', 'single', '¿Pueden atender a pacientes en inglés?', 'Can patients be seen in English?', [
        o('fluent', 'Sí, sin problema', 'Yes, without a problem'), o('some', 'Algo', 'Somewhat'), o('none', 'No', 'No')
      ], { required: true }),
      q('virtual', 'single', '¿Ofrecen consultas virtuales?', 'Do you offer virtual visits?', YNC, { required: true })
    ]),
    sc('ops', 'De la cita al pago', 'From booking to payment', [
      q('payments', 'multi', '¿Cómo pueden pagar los pacientes?', 'How can patients pay?', [
        o('cash', 'Efectivo', 'Cash'), o('card', 'Tarjeta', 'Card'), o('transfer', 'Transferencia', 'Bank transfer'),
        o('mx_insurance', 'Seguro mexicano', 'Mexican insurance'), o('us_insurance', 'Seguro de EE. UU.', 'US insurance'),
        o('plans', 'A plazos', 'Payment plans'), o('online', 'Pago en línea', 'Online payment')
      ], { required: true, other: true }),
      q('insurers', 'text', '¿Con qué aseguradoras trabaja?', 'Which insurers do you work with?', null, { ph_es: 'Por ejemplo: GNP, AXA, Seguros Monterrey', ph_en: 'For example: GNP, AXA, Seguros Monterrey' }),
      q('imaging', 'multi', '¿Qué estudios hacen en sitio?', 'What can you do on site?', [
        o('xray', 'Rayos X', 'X-ray'), o('ultrasound', 'Ultrasonido', 'Ultrasound'), o('ct_mri', 'Tomografía o resonancia', 'CT or MRI'),
        o('lab', 'Laboratorio', 'Lab work'), o('none', 'Nada, referimos', 'Nothing, we refer out')
      ], { exclusive: ['none'] }),
      q('process', 'textarea', 'Cuando un paciente necesita atención, ¿cómo se coordina hoy el proceso desde la cita hasta el pago?', 'When a patient needs care, how does the process run today, from booking to payment?', null, { max: 600 }),
      q('process_hardest', 'single', '¿En qué parte del proceso se presenta la mayor dificultad?', 'Which part of that process is the hardest?', [
        o('booking', 'Agendar la cita', 'Booking the appointment'),
        o('no_shows', 'Que el paciente llegue', 'Getting the patient to show up'),
        o('coverage', 'Verificar el seguro', 'Checking insurance'),
        o('records', 'Conseguir los expedientes previos', 'Getting prior records'),
        o('billing', 'Cobrar', 'Getting paid'),
        o('follow_up', 'El seguimiento después de la consulta', 'Follow-up after the visit'),
        o('none', 'Ninguna en particular', 'None in particular')
      ], { required: true, other: true }),
      q('bottlenecks', 'multi', '¿Qué problemas afectan más a su consultorio hoy?', 'Which problems affect your practice most today?', [
        o('no_shows', 'Pacientes que no llegan', 'No-shows'), o('billing', 'Cobranza', 'Billing and collections'),
        o('new_patients', 'Conseguir pacientes nuevos', 'Getting new patients'), o('admin', 'Administración y papeleo', 'Admin and paperwork'),
        o('claims', 'Reclamos de seguros', 'Insurance claims'), o('records', 'Expedientes', 'Medical records'),
        o('staffing', 'Personal', 'Staffing'), o('none', 'Nada en particular', 'Nothing in particular')
      ], { required: true, max: 3, exclusive: ['none'], other: true }),
      top('bottlenecks'),
      q('records', 'multi', 'Cuando atiende a pacientes que vienen del otro lado de la frontera, ¿qué dificultades tiene para recibir, interpretar o compartir sus expedientes médicos?', 'When you treat patients from across the border, what problems do you have receiving, reading, or sharing their medical records?', [
        o('no_history', 'El paciente no trae expedientes previos', 'The patient has no prior records'),
        o('language', 'Vienen en otro idioma', 'They are in another language'),
        o('format', 'Llegan en papel o en formatos difíciles de usar', 'They arrive on paper or in hard-to-use formats'),
        o('results', 'Es difícil recibir resultados de estudios', 'Test results are hard to receive'),
        o('repeat', 'Tenemos que repetir estudios', 'We have to repeat tests'),
        o('send_back', 'Es difícil enviar la información de vuelta', 'It is hard to send information back'),
        o('no_problem', 'No hemos tenido problemas', 'We have not had any problems')
      ], { required: true, exclusive: ['no_problem'], other: true, showIf: ['us_patients', ['under10', '10_25', '25_50', 'over50', 'unsure']] }),
      q('referrals', 'single', '¿Está abierto a recibir pacientes referidos por una red de clínicas?', 'Are you open to receiving patients referred by a network of clinics?', [
        o('yes', 'Sí', 'Yes'), o('depends', 'Depende de las condiciones', 'Depends on the terms'), o('no', 'No', 'No')
      ], { required: true })
    ]),
    sc('contact', 'Para darle seguimiento', 'So we can follow up', [], { contact: 'full' })
  ]
};

/* Contact screen fields. Phone and WhatsApp are separate: not every number
   is on WhatsApp and not every clinic wants to be reached there. */
export const CONTACT: Record<ContactField, ContactDef> = {
  name:  { es: 'Nombre', en: 'Name', type: 'text', ac: 'name' },
  org:   { es: 'Empresa o clínica', en: 'Company or clinic', type: 'text', ac: 'organization' },
  email: { es: 'Correo', en: 'Email', type: 'email', ac: 'email' },
  phone: { es: 'Teléfono', en: 'Phone', type: 'tel', ac: 'tel' },
  whatsapp: { es: 'WhatsApp (si es otro número)', en: 'WhatsApp (if a different number)', type: 'tel', ac: 'off' }
};
/* Follow-up (Kevyn): three answers, so "send me something first" is not
   lost as a no. Both yeses count as follow_up = true. */
export const FOLLOW: Loc = {
  es: 'Algunas respuestas nos ayudan a encontrar cómo mejorar este proceso. ¿Le gustaría que le contactemos para conocer más sobre su experiencia?',
  en: 'Some answers help us find ways to improve this process. Would you like us to contact you to hear more about your experience?'
};
export const FOLLOW_OPTS: Opt[] = [
  o('yes', 'Sí, acepto una conversación breve (15 minutos)', 'Yes, a short conversation (15 minutes)'),
  o('info_first', 'Sí, pero prefiero recibir información primero', 'Yes, but send me information first'),
  o('no', 'No por ahora', 'Not right now')
];
