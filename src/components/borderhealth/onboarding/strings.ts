import type { BhLang } from '../types';
import type { Specialty } from '../../../types/provider';

/**
 * Every word the onboarding step shows, in both languages.
 *
 * Kept out of src/i18n/locales on purpose: the survey is driven by its own
 * `lang` (the language the doctor answered in), not by the site's language
 * switch, and these strings only ever appear on this one flow.
 */

export type ErrorCode =
    | 'not_signed_in'
    | 'listing_not_found'
    | 'bad_name'
    | 'bad_country'
    | 'too_many_pending'
    | 'not_configured'
    | 'network'
    | 'invalid_credentials'
    | 'user_exists'
    | 'email_not_confirmed'
    | 'weak_password'
    | 'bad_email'
    | 'rate_limited'
    | 'missing_address'
    | 'unknown';

interface Strings {
    notNow: string;
    back: string;
    working: string;
    goToDashboard: string;
    checking: [string, string, string];
    checkingAria: string;

    matchTitle: string;
    matchSubtitle: (n: number) => string;
    matchedBy: string;
    reasons: Record<string, string>;
    alreadyManaged: string;
    claimThis: string;
    noneOfThese: string;

    accountTitleClaim: string;
    accountTitleListing: string;
    accountSubtitleSignUp: string;
    accountSubtitleSignIn: string;
    claimingLabel: string;
    publishingLabel: string;
    email: string;
    password: string;
    passwordHint: string;
    createAccount: string;
    signIn: string;
    haveAccount: string;
    needAccount: string;
    switchToSignIn: string;
    switchToSignUp: string;

    confirmTitle: string;
    confirmBody: (email: string) => string;
    confirmHint: string;
    confirmSignedIn: string;

    approvedTitle: string;
    approvedBody: (name: string) => string;
    pendingTitle: string;
    pendingBody: (name: string) => string;
    ownerTitle: string;
    ownerBody: (name: string) => string;

    publishTitle: string;
    publishSubtitle: string;
    publishPerks: [string, string, string];
    fPracticeName: string;
    fYourName: string;
    fSpecialty: string;
    fAddress: string;
    fAddressHint: string;
    fCity: string;
    fPhone: string;
    fEmail: string;
    fWebsite: string;
    fDescription: string;
    fDescriptionHint: string;
    optional: string;
    publishContinue: string;

    listingTitle: string;
    listingBody: string;

    thanksTitle: string;
    thanksBody: string;
    thanksDirectory: string;
    restart: string;

    resumeNothingTitle: string;
    resumeNothingBody: string;
    resumeSignInTitle: string;
    resumeSignInBody: string;
    resumeWorking: string;
    resumeFailedTitle: string;
    retry: string;

    continueAsTitle: string;
    continueAsBody: (email: string) => string;
    continueAs: string;
    notYou: string;
    mismatchTitle: string;
    mismatchBody: (current: string, expected: string) => string;
    signOut: string;

    testBadge: string;
    testTitle: string;
    testBody: string;

    errors: Record<ErrorCode, string>;
    specialties: Record<Specialty, string>;
}

const es: Strings = {
    notNow: 'Ahora no',
    back: 'Atrás',
    working: 'Un momento…',
    goToDashboard: 'Ir a mi panel',
    checking: [
        'Guardamos sus respuestas…',
        'Buscando su consultorio en MedSociety…',
        'Comparando nombre, teléfono y correo…',
    ],
    checkingAria: 'Buscando su consultorio',

    matchTitle: '¿Es este su consultorio?',
    matchSubtitle: (n) => n === 1
        ? 'Encontramos un perfil en MedSociety que se parece al suyo.'
        : `Encontramos ${n} perfiles en MedSociety que se parecen al suyo.`,
    matchedBy: 'Coincide por',
    reasons: { phone: 'teléfono', email: 'correo', name: 'nombre', city: 'ciudad' },
    alreadyManaged: 'Este perfil ya tiene un administrador; su solicitud pasará a revisión.',
    claimThis: 'Sí, es mío — reclamar',
    noneOfThese: 'Ninguno es mío',

    accountTitleClaim: 'Reclame su perfil',
    accountTitleListing: 'Un último paso',
    accountSubtitleSignUp: 'Cree su cuenta gratuita de MedSociety para administrar su perfil.',
    accountSubtitleSignIn: 'Inicie sesión con su cuenta de MedSociety.',
    claimingLabel: 'Reclamando',
    publishingLabel: 'Publicando',
    email: 'Correo electrónico',
    password: 'Contraseña',
    passwordHint: 'Mínimo 6 caracteres.',
    createAccount: 'Crear cuenta y continuar',
    signIn: 'Iniciar sesión y continuar',
    haveAccount: '¿Ya tiene cuenta?',
    needAccount: '¿No tiene cuenta?',
    switchToSignIn: 'Inicie sesión',
    switchToSignUp: 'Créela aquí',

    confirmTitle: 'Revise su correo',
    confirmBody: (email) => `Le enviamos un enlace de confirmación a ${email}. Ábralo y volverá aquí para terminar automáticamente.`,
    confirmHint: '¿Ya lo confirmó en otra pestaña? Inicie sesión aquí y continuamos.',
    confirmSignedIn: 'Cuenta confirmada. Terminando…',

    approvedTitle: 'Su perfil es suyo',
    approvedBody: (name) => `${name} ya está a su cargo. Actualice fotos, horarios y servicios desde su panel.`,
    pendingTitle: 'Recibimos su solicitud',
    pendingBody: (name) => `Verificaremos que ${name} es suyo en 1–2 días hábiles y le avisaremos por correo.`,
    ownerTitle: 'Ya administra este perfil',
    ownerBody: (name) => `${name} ya está vinculado a su cuenta.`,

    publishTitle: 'Publique su consultorio en MedSociety',
    publishSubtitle: 'No encontramos su consultorio en el directorio. Publicarlo es gratis.',
    publishPerks: [
        'Perfil gratuito, sin comisiones',
        'Pacientes de ambos lados de la frontera lo encuentran',
        'Usted controla fotos, horarios y servicios',
    ],
    fPracticeName: 'Nombre del consultorio',
    fYourName: 'Su nombre',
    fSpecialty: 'Especialidad',
    fAddress: 'Dirección',
    fAddressHint: 'Calle, número y colonia — así lo ubican sus pacientes en el mapa.',
    fCity: 'Ciudad',
    fPhone: 'Teléfono / WhatsApp',
    fEmail: 'Correo del consultorio',
    fWebsite: 'Sitio web o perfil',
    fDescription: 'Descripción breve',
    fDescriptionHint: 'Qué atiende y qué lo distingue. Puede completarla después.',
    optional: 'opcional',
    publishContinue: 'Continuar',

    listingTitle: 'Enviado',
    listingBody: 'Lo revisamos y lo publicamos pronto. Mientras tanto, complete su perfil desde su panel.',

    thanksTitle: '¡Gracias!',
    thanksBody: 'Sus respuestas ya quedaron guardadas. Puede reclamar o publicar su consultorio en MedSociety cuando guste.',
    thanksDirectory: 'Ver el directorio',
    restart: 'Llenar otra encuesta',

    resumeNothingTitle: 'Nada pendiente',
    resumeNothingBody: 'No hay ninguna solicitud por terminar en este navegador. Si ya la envió, la encontrará en su panel.',
    resumeSignInTitle: 'Inicie sesión para terminar',
    resumeSignInBody: 'Su cuenta ya está confirmada. Inicie sesión y terminamos su solicitud.',
    resumeWorking: 'Terminando su solicitud…',
    resumeFailedTitle: 'No pudimos terminar',
    retry: 'Intentar de nuevo',

    continueAsTitle: '¿Continuar con esta cuenta?',
    continueAsBody: (email) => `Hay una sesión abierta como ${email}.`,
    continueAs: 'Continuar',
    notYou: '¿No es usted? Usar otra cuenta',
    mismatchTitle: 'Otra cuenta está abierta',
    mismatchBody: (current, expected) => `Inició sesión como ${current}, pero esta solicitud la inició ${expected}. Cierre sesión e inicie sesión como ${expected} para terminarla.`,
    signOut: 'Cerrar sesión',

    testBadge: 'Prueba',
    testTitle: 'Modo de prueba: no se reclamó ni se publicó nada',
    testBody: 'Esta encuesta es de prueba, así que el flujo termina aquí sin tocar el directorio.',

    errors: {
        not_signed_in: 'Su sesión expiró. Inicie sesión de nuevo para continuar.',
        listing_not_found: 'Ese perfil ya no está disponible en el directorio. Puede publicar su consultorio como nuevo.',
        bad_name: 'El nombre del consultorio debe tener entre 3 y 160 caracteres.',
        bad_country: 'No reconocimos el país de esa ciudad. Elija una ciudad de México o de EE. UU.',
        too_many_pending: 'Ya tiene 3 consultorios en revisión. Espere a que los aprobemos antes de enviar otro.',
        not_configured: 'Este servicio no está disponible en este momento. Intente más tarde.',
        network: 'No pudimos conectarnos. Revise su conexión e intente de nuevo.',
        invalid_credentials: 'Correo o contraseña incorrectos.',
        user_exists: 'Ya existe una cuenta con ese correo. Inicie sesión.',
        email_not_confirmed: 'Aún no confirma su correo. Abra el enlace que le enviamos e intente de nuevo.',
        weak_password: 'La contraseña debe tener al menos 6 caracteres.',
        bad_email: 'Ese correo no parece válido.',
        rate_limited: 'Demasiados intentos. Espere un minuto e intente de nuevo.',
        missing_address: 'Escriba la dirección del consultorio.',
        unknown: 'Algo salió mal. Intente de nuevo.',
    },
    specialties: {
        dentist: 'Odontología',
        orthodontist: 'Ortodoncia',
        plastic_surgery: 'Cirugía plástica',
        aesthetician: 'Medicina estética',
        obgyn: 'Ginecología y obstetricia',
        physical_therapy: 'Fisioterapia',
        massage: 'Masoterapia',
        optometry: 'Optometría',
        general: 'Medicina general y familiar',
        pediatrics: 'Pediatría',
        cardiology: 'Cardiología',
        urgent_care: 'Urgencias',
        mental_health: 'Salud mental',
        pharmacy: 'Farmacia',
        telehealth: 'Telemedicina',
        neurology: 'Neurología',
        otolaryngology: 'Otorrinolaringología',
        orthopedics: 'Ortopedia y traumatología',
        gastroenterology: 'Gastroenterología',
    },
};

const en: Strings = {
    notNow: 'Not now',
    back: 'Back',
    working: 'One moment…',
    goToDashboard: 'Go to my dashboard',
    checking: [
        'Saving your answers…',
        'Looking for your practice on MedSociety…',
        'Comparing name, phone and email…',
    ],
    checkingAria: 'Looking for your practice',

    matchTitle: 'Is this your practice?',
    matchSubtitle: (n) => n === 1
        ? 'We found a MedSociety listing that looks like yours.'
        : `We found ${n} MedSociety listings that look like yours.`,
    matchedBy: 'Matched by',
    reasons: { phone: 'phone', email: 'email', name: 'name', city: 'city' },
    alreadyManaged: 'This listing already has a manager; your request will go to review.',
    claimThis: 'Yes, claim it',
    noneOfThese: 'None of these',

    accountTitleClaim: 'Claim your listing',
    accountTitleListing: 'One last step',
    accountSubtitleSignUp: 'Create your free MedSociety account to manage your listing.',
    accountSubtitleSignIn: 'Sign in to your MedSociety account.',
    claimingLabel: 'Claiming',
    publishingLabel: 'Publishing',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 6 characters.',
    createAccount: 'Create account and continue',
    signIn: 'Sign in and continue',
    haveAccount: 'Already have an account?',
    needAccount: 'No account yet?',
    switchToSignIn: 'Sign in',
    switchToSignUp: 'Create one',

    confirmTitle: 'Check your email',
    confirmBody: (email) => `We sent a confirmation link to ${email}. Open it and you will land back here to finish automatically.`,
    confirmHint: 'Already confirmed in another tab? Sign in here and we will continue.',
    confirmSignedIn: 'Account confirmed. Finishing up…',

    approvedTitle: 'Your listing is yours',
    approvedBody: (name) => `You now manage ${name}. Update photos, hours and services from your dashboard.`,
    pendingTitle: 'We received your request',
    pendingBody: (name) => `We will verify that ${name} is yours within 1–2 business days and email you.`,
    ownerTitle: 'You already manage this listing',
    ownerBody: (name) => `${name} is already linked to your account.`,

    publishTitle: 'Publish your practice on MedSociety',
    publishSubtitle: 'We could not find your practice in the directory. Listing it is free.',
    publishPerks: [
        'Free listing, no commissions',
        'Patients from both sides of the border find you',
        'You control photos, hours and services',
    ],
    fPracticeName: 'Practice name',
    fYourName: 'Your name',
    fSpecialty: 'Specialty',
    fAddress: 'Address',
    fAddressHint: 'Street, number and neighborhood — how patients find you on the map.',
    fCity: 'City',
    fPhone: 'Phone / WhatsApp',
    fEmail: 'Practice email',
    fWebsite: 'Website or profile',
    fDescription: 'Short description',
    fDescriptionHint: 'What you treat and what sets you apart. You can finish it later.',
    optional: 'optional',
    publishContinue: 'Continue',

    listingTitle: 'Submitted',
    listingBody: 'We will review it and publish it soon. Meanwhile, complete your profile from your dashboard.',

    thanksTitle: 'Thank you!',
    thanksBody: 'Your answers are already saved. You can claim or publish your practice on MedSociety whenever you like.',
    thanksDirectory: 'Browse the directory',
    restart: 'Fill in another survey',

    resumeNothingTitle: 'Nothing pending',
    resumeNothingBody: 'There is no request waiting to be finished in this browser. If you already sent it, you will find it in your dashboard.',
    resumeSignInTitle: 'Sign in to finish',
    resumeSignInBody: 'Your account is confirmed. Sign in and we will finish your request.',
    resumeWorking: 'Finishing your request…',
    resumeFailedTitle: 'We could not finish',
    retry: 'Try again',

    continueAsTitle: 'Continue with this account?',
    continueAsBody: (email) => `You are signed in as ${email}.`,
    continueAs: 'Continue',
    notYou: 'Not you? Use another account',
    mismatchTitle: 'A different account is signed in',
    mismatchBody: (current, expected) => `You are signed in as ${current}, but this request was started by ${expected}. Sign out and sign in as ${expected} to finish it.`,
    signOut: 'Sign out',

    testBadge: 'Test',
    testTitle: 'Test mode: nothing was claimed or published',
    testBody: 'This is a test survey, so the flow stops here without touching the directory.',

    errors: {
        not_signed_in: 'Your session expired. Sign in again to continue.',
        listing_not_found: 'That listing is no longer in the directory. You can publish your practice as a new one.',
        bad_name: 'The practice name must be between 3 and 160 characters.',
        bad_country: 'We could not tell which country that city is in. Choose a city in Mexico or the US.',
        too_many_pending: 'You already have 3 practices in review. Please wait for them to be approved before sending another.',
        not_configured: 'This service is unavailable right now. Please try again later.',
        network: 'We could not connect. Check your connection and try again.',
        invalid_credentials: 'Wrong email or password.',
        user_exists: 'An account with that email already exists. Please sign in.',
        email_not_confirmed: 'Your email is not confirmed yet. Open the link we sent you and try again.',
        weak_password: 'The password must be at least 6 characters.',
        bad_email: 'That email does not look valid.',
        rate_limited: 'Too many attempts. Wait a minute and try again.',
        missing_address: 'Please enter the practice address.',
        unknown: 'Something went wrong. Please try again.',
    },
    specialties: {
        dentist: 'Dentistry',
        orthodontist: 'Orthodontics',
        plastic_surgery: 'Plastic surgery',
        aesthetician: 'Aesthetics',
        obgyn: "OB/GYN & women's health",
        physical_therapy: 'Physical therapy',
        massage: 'Massage therapy',
        optometry: 'Vision & optometry',
        general: 'Primary & family care',
        pediatrics: 'Pediatrics',
        cardiology: 'Cardiology',
        urgent_care: 'Urgent care',
        mental_health: 'Mental health',
        pharmacy: 'Pharmacy',
        telehealth: 'Telehealth',
        neurology: 'Neurology',
        otolaryngology: 'Ear, nose & throat',
        orthopedics: 'Orthopedics & trauma',
        gastroenterology: 'Gastroenterology',
    },
};

export const STRINGS: Record<BhLang, Strings> = { es, en };

export function stringsFor(lang: BhLang | string | undefined): Strings {
    return lang === 'en' ? en : es;
}
