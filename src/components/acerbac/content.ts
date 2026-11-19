/**
 * ACERBAC site copy (ES default, EN mirror).
 *
 * DRAFT. Written from public press coverage (see docs/acerbac-site.md), not
 * from ACERBAC. Every line marked TODO(acerbac) must be confirmed or replaced
 * by the association before the page is indexed. Never state certification
 * criteria, fees, member counts or member names until they supply them.
 */
export type AcLang = 'es' | 'en';

export interface AcContent {
    docTitle: string;
    nav: { find: string; guide: string; certify: string; join: string; about: string; contact: string };
    hero: { eyebrow: string; h1: string; lead: string; ctaFind: string; ctaJoin: string; cardH: string; cardItems: string[] };
    trust: { n: string; label: string }[];
    find: { h: string; p: string; cta: string; note: string };
    centers: { h: string; p: string; listing: string; noListing: string; source: string; todo: string };
    guide: { h: string; p: string; items: { h: string; p: string }[] };
    /** `soon` replaces a step whose text is still a TODO on the deployed page. */
    certify: { h: string; p: string; steps: { h: string; p: string }[]; note: string; soon: string };
    join: { h: string; p: string; perks: string[]; cta: string };
    about: { h: string; p: string; allies: string; allyList: string[]; board: string };
    report: { h: string; p: string; cta: string };
    contact: { h: string; p: string; whatsapp: string; email: string };
    foot: { legal: string; privacy: string; draft: string };
}

export const AC_EMAIL = 'info@dropdev.co'; // TODO(acerbac): replace with the association's contact address
export const AC_WHATSAPP = ''; // TODO(acerbac): E.164 number, digits only

/**
 * Centers the association itself named as certified, as reported by Diario
 * Tijuana on 25 June 2025 (president then: Dr. Eugenio Carrasco; the article
 * calls it the "Asociación de Centros de Recuperación Posquirúrgica de Baja
 * California"). Zen & Healthy Recovery also states ACERBAC membership on its
 * Baja Health Cluster listing. TODO(acerbac): confirm the current list.
 *
 * `providerId` links the card to the MedSociety listing (providers.id, matched
 * by name in Tijuana). `photo` stays null until the center or ACERBAC sends a
 * picture we may publish: never copy one from a center's own site or socials.
 */
export interface AcCenter {
    name: string;
    providerId: string | null;
    photo: string | null;
}

export const AC_CENTERS: AcCenter[] = [
    { name: 'Alice', providerId: null, photo: null },
    { name: 'Zen & Healthy Recovery', providerId: '7d5158a7-125e-4ad1-b991-2becc1f91dc0', photo: null },
    { name: 'Baja Premium Care', providerId: null, photo: null },
    { name: 'Bella Recovery House', providerId: '5056bb8d-1288-4fa1-b9fc-1eb9f230c718', photo: null },
    { name: 'Better Than Ever', providerId: '6f1f2c83-ca5c-418e-88f9-0e42ef7fb808', photo: null },
];

export const AC: Record<AcLang, AcContent> = {
    es: {
        docTitle: 'ACERBAC · Asociación de Centros de Recuperación de Baja California',
        nav: { find: 'Centros', guide: 'Guía', certify: 'Certificación', join: 'Afíliate', about: 'Nosotros', contact: 'Contacto' },
        hero: {
            eyebrow: 'Tijuana · Baja California',
            h1: 'Recupérate con seguridad después de tu cirugía.',
            lead:
                'ACERBAC reúne a los centros de recuperación de Baja California y trabaja para que cada paciente elija un lugar con estándares claros, personal capacitado y respaldo verificable.',
            ctaFind: 'Encuentra un centro',
            ctaJoin: 'Afilia tu centro',
            cardH: 'Antes de reservar, pregunta',
            cardItems: ['¿Tiene licencia y certificación vigentes?', '¿Hay enfermería las 24 horas?', '¿Qué hospital atiende una emergencia?'],
        },
        trust: [
            { n: '2026–2028', label: 'Mesa directiva presidida por Marla Luna' },
            { n: 'Cotuco · Baja Health Cluster', label: 'Convenio marco de colaboración, julio de 2026' },
            { n: 'Reglamento municipal', label: 'Estándares mínimos para centros postoperatorios en Tijuana' },
        ],
        find: {
            h: 'Centros de recuperación',
            p: 'Consulta el directorio de centros de recuperación postoperatoria en Tijuana y su región.',
            cta: 'Ver el directorio',
            note: 'TODO(acerbac): el sello “Certificado” solo aparecerá en centros que ACERBAC confirme por escrito.',
        },
        centers: {
            h: 'Centros certificados',
            p: 'Los centros que la asociación ha presentado como certificados.',
            listing: 'Ver ficha',
            noListing: 'Ficha próximamente',
            source: 'Fuente: la asociación, citada por Diario Tijuana el 25 de junio de 2025.',
            todo: 'TODO(acerbac): confirmar la lista vigente y enviar una foto de cada centro con su permiso.',
        },
        guide: {
            h: 'Guía para pacientes y familias',
            p: 'Antes de reservar, haz estas preguntas. Un centro serio responde todas con gusto.',
            items: [
                { h: 'Pregunta por su licencia y certificación', p: 'Pide ver el aviso de funcionamiento y cualquier certificación vigente, y comprueba que sean de ese domicilio.' },
                { h: 'Conoce quién te cuida', p: '¿Hay enfermería las 24 horas? ¿Qué formación tiene el personal y quién atiende una emergencia?' },
                { h: 'Aclara el traslado y la emergencia', p: 'Confirma cómo llegas desde la clínica, qué hospital te recibe y cómo se contacta a tu cirujano.' },
                { h: 'Desconfía de las promesas imposibles', p: 'Precios muy por debajo del mercado, presión para pagar por adelantado o cirujanos sin cédula son señales de alerta.' },
                { h: 'Planea el cruce y el regreso', p: 'Viaja acompañado, lleva tus documentos y define con tu cirujano cuándo puedes volver a casa.' },
            ],
        },
        certify: {
            h: 'Certificación',
            p: 'La asociación cuenta con el respaldo de COEPRIS, la Comisión Estatal para la Protección contra Riesgos Sanitarios de Baja California. Con el Baja Health Cluster impulsa programas de certificación, protocolos de atención y proyectos de investigación para fortalecer la seguridad del paciente.',
            steps: [
                { h: 'Acércate', p: 'Los centros sin certificación pueden acercarse a ACERBAC para recibir capacitación y acompañamiento.' },
                { h: 'Capacítate', p: 'TODO(acerbac): contenido, duración y costo de la capacitación.' },
                { h: 'Certifica', p: 'TODO(acerbac): confirmar quién certifica (COEPRIS estatal o COFEPRIS federal), qué criterios se revisan y vigencia del sello.' },
            ],
            note: 'Los criterios los publica ACERBAC; esta página no los inventa.',
            soon: 'Detalles próximamente.',
        },
        join: {
            h: 'Afilia tu centro',
            p: 'Si diriges un centro de recuperación en Baja California, súmate a la asociación que está definiendo el estándar.',
            perks: [
                'Presencia en el directorio de centros',
                'Capacitación y acompañamiento hacia la certificación',
                'Voz ante autoridades y aliados del sector',
            ],
            cta: 'Solicitar afiliación',
        },
        about: {
            h: 'Quiénes somos',
            p: 'La Asociación de Centros de Recuperación de Baja California agrupa a quienes cuidan a los pacientes en las horas más delicadas después de una cirugía.',
            allies: 'Aliados',
            allyList: ['COEPRIS Baja California', 'Comité de Turismo y Convenciones de Tijuana (Cotuco)', 'Baja Health Cluster'],
            board: 'Presidenta 2026–2028: Marla Luna',
        },
        report: {
            h: '¿Un centro o clínica sospechosa?',
            p: 'Si conoces un lugar que opera sin licencia o promete lo que no puede cumplir, cuéntanos. Revisamos cada reporte.',
            cta: 'Reportar',
        },
        contact: {
            h: 'Contacto',
            p: 'Escríbenos y te respondemos.',
            whatsapp: 'WhatsApp',
            email: 'Correo',
        },
        foot: {
            legal: 'Asociación de Centros de Recuperación de Baja California',
            privacy: 'Aviso de privacidad',
            draft: 'Borrador: contenido pendiente de confirmación por ACERBAC.',
        },
    },
    en: {
        docTitle: 'ACERBAC · Baja California Recovery Centers Association',
        nav: { find: 'Centers', guide: 'Guide', certify: 'Certification', join: 'Join', about: 'About', contact: 'Contact' },
        hero: {
            eyebrow: 'Tijuana · Baja California',
            h1: 'Recover safely after your surgery.',
            lead:
                'ACERBAC brings together Baja California’s recovery centers and works so every patient can choose a place with clear standards, trained staff and verifiable backing.',
            ctaFind: 'Find a center',
            ctaJoin: 'Join as a center',
            cardH: 'Before you book, ask',
            cardItems: ['Are the license and certification current?', 'Is there nursing around the clock?', 'Which hospital handles an emergency?'],
        },
        trust: [
            { n: '2026–2028', label: 'Board led by president Marla Luna' },
            { n: 'Cotuco · Baja Health Cluster', label: 'Framework collaboration agreement, July 2026' },
            { n: 'Municipal regulation', label: 'Minimum standards for post-surgery centers in Tijuana' },
        ],
        find: {
            h: 'Recovery centers',
            p: 'Browse the directory of post-surgery recovery centers in Tijuana and the region.',
            cta: 'Open the directory',
            note: 'TODO(acerbac): the “Certified” badge will only appear on centers ACERBAC confirms in writing.',
        },
        centers: {
            h: 'Certified centers',
            p: 'The centers the association has presented as certified.',
            listing: 'View listing',
            noListing: 'Listing coming soon',
            source: 'Source: the association, quoted by Diario Tijuana on 25 June 2025.',
            todo: 'TODO(acerbac): confirm the current list and send a photo of each center with its permission.',
        },
        guide: {
            h: 'Guide for patients and families',
            p: 'Ask these before you book. A serious center is glad to answer every one.',
            items: [
                { h: 'Ask for their license and certification', p: 'Ask to see the operating notice and any current certification, and check they are for that address.' },
                { h: 'Know who is caring for you', p: 'Is there nursing around the clock? What training does the staff have, and who handles an emergency?' },
                { h: 'Settle transfer and emergency plans', p: 'Confirm how you get there from the clinic, which hospital receives you and how your surgeon is reached.' },
                { h: 'Be wary of impossible promises', p: 'Prices far below market, pressure to pay upfront or surgeons without a license number are red flags.' },
                { h: 'Plan the crossing and the trip home', p: 'Travel with someone, bring your documents and agree with your surgeon when you can go home.' },
            ],
        },
        certify: {
            h: 'Certification',
            p: 'The association is backed by COEPRIS, Baja California’s state commission for protection against health risks. With the Baja Health Cluster it is advancing certification programs, care protocols and research projects to strengthen patient safety.',
            steps: [
                { h: 'Reach out', p: 'Centers without certification can contact ACERBAC for training and guidance.' },
                { h: 'Train', p: 'TODO(acerbac): training content, length and cost.' },
                { h: 'Certify', p: 'TODO(acerbac): confirm who certifies (state COEPRIS or federal COFEPRIS), which criteria are reviewed and how long the seal lasts.' },
            ],
            note: 'ACERBAC publishes the criteria; this page does not make them up.',
            soon: 'Details coming soon.',
        },
        join: {
            h: 'Join as a center',
            p: 'If you run a recovery center in Baja California, join the association that is setting the standard.',
            perks: [
                'A place in the centers directory',
                'Training and guidance toward certification',
                'A voice with authorities and sector partners',
            ],
            cta: 'Request membership',
        },
        about: {
            h: 'About us',
            p: 'The Baja California Recovery Centers Association groups the people who care for patients in the most delicate hours after surgery.',
            allies: 'Partners',
            allyList: ['COEPRIS Baja California', 'Tijuana Tourism and Convention Committee (Cotuco)', 'Baja Health Cluster'],
            board: 'President 2026–2028: Marla Luna',
        },
        report: {
            h: 'A suspicious center or clinic?',
            p: 'If you know a place that operates without a license or promises what it cannot deliver, tell us. We review every report.',
            cta: 'Report',
        },
        contact: {
            h: 'Contact',
            p: 'Write to us and we will reply.',
            whatsapp: 'WhatsApp',
            email: 'Email',
        },
        foot: {
            legal: 'Baja California Recovery Centers Association',
            privacy: 'Privacy notice',
            draft: 'Draft: content pending confirmation by ACERBAC.',
        },
    },
};
