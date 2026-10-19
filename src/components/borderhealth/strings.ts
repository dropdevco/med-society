/**
 * The survey's own UI copy, ported from the static page's `T`.
 *
 * The survey deliberately does not use the site's i18next catalogue: its copy
 * was reviewed line by line in both languages (David for English, Kevyn for
 * Spanish) and belongs to the study, not to the directory. The page still
 * tells i18next which language is active so the navbar follows along.
 *
 * I-Corps framing: nothing here mentions Health Atlas, AWS, or AI.
 */
import type { BhLang, BhSegment } from './types';

export interface BhStrings {
    hsub: string;
    /** Header line when the visitor arrived from "Get listed free" (?by=listing). */
    listSub: string;
    title: string;
    lede: string;
    about: string;
    who: string;
    segs: Record<BhSegment, [string, string]>;
    time: string;
    step: (n: number, m: number) => string;
    next: string;
    back: string;
    send: string;
    sending: string;
    switchSeg: string;
    switchTitle: string;
    optional: string;
    choose: string;
    all: string;
    otherLabel: string;
    otherPh: string;
    errPick: string;
    errText: string;
    errContact: string;
    reach: string;
    upTo: (n: number) => string;
    errMax: (n: number) => string;
    errSend: string;
    sendnote: string;
    restored: string;
    doneH: string;
    doneP: string;
    doneF: string;
    again: string;
    foot: string;
    yes: string;
    no: string;
    docTitle: string;
}

export const T: Record<BhLang, BhStrings> = {
    es: {
        hsub: 'Estudio sobre acceso a la salud en la frontera',
        listSub: 'Publique su consultorio gratis · unos 4 minutos',
        title: '¿Cómo consigue atención médica la gente en la frontera?',
        lede: 'Unos 4 minutos. No hay respuestas correctas. Lo que nos cuente orienta un estudio, no una venta.',
        about: 'Quiénes somos: MedSociety es un directorio médico de la frontera entre México y Estados Unidos, en Ciudad Juárez y El Paso, y en Tijuana y San Diego. Por qué preguntamos: queremos entender cómo consigue atención médica la gente de los dos lados, y en qué parte del proceso se complica.',
        who: '¿Quién responde?',
        segs: {
            employer: ['Empleador', 'Soy dueño, gerente o de recursos humanos'],
            employee: ['Empleado o paciente', 'Trabajo en una empresa u organización, o busco atención médica'],
            provider: ['Proveedor de salud', 'Soy médico, dentista o administro una clínica o laboratorio'],
        },
        time: 'Sus respuestas se guardan en este dispositivo mientras avanza, por si se corta la señal.',
        step: (n, m) => 'Paso ' + n + ' de ' + m,
        next: 'Continuar', back: 'Atrás', send: 'Enviar respuestas', sending: 'Enviando…',
        switchSeg: 'Cambiar', switchTitle: 'Responder como otro tipo de persona',
        optional: '(opcional)', choose: 'Elija un estado', all: 'Marque todas las que apliquen', otherLabel: 'Otro (escriba cuál)',
        otherPh: 'Escriba aquí',
        errPick: 'Elija una opción para continuar.',
        errText: 'Escriba una respuesta para continuar.',
        errContact: 'Necesitamos un correo, un teléfono o un WhatsApp para darle seguimiento.',
        reach: 'Con un correo, un teléfono o un WhatsApp basta.',
        upTo: (n) => 'Elija hasta ' + n,
        errMax: (n) => 'Puede elegir hasta ' + n + '. Quite una para cambiarla.',
        errSend: 'No se envió. Revise su señal y vuelva a intentar.',
        sendnote: 'Al enviar, sus respuestas pasan al equipo del estudio. Nada se comparte con su empleador ni con aseguradoras.',
        restored: 'Retomamos donde se quedó.',
        doneH: 'Gracias.',
        doneP: 'Lo que nos contó ayuda a entender cómo la gente de la frontera consigue atención médica, y dónde se atora.',
        doneF: 'Como aceptó que le contactemos, le escribiremos pronto.',
        again: 'Responder otro formulario',
        foot: 'Estudio conducido por MedSociety. Sus respuestas las ve solo el equipo del estudio. Nunca se venden ni se comparten con su empleador ni con aseguradoras. Preguntas: hello@medsociety.one',
        yes: 'Sí', no: 'No',
        docTitle: 'Estudio de acceso a la salud en la frontera · MedSociety',
    },
    en: {
        hsub: 'Border healthcare access study',
        listSub: 'Get your practice listed free · about 4 minutes',
        title: 'How do people on the border actually get healthcare?',
        lede: 'About 4 minutes. There are no right answers. What you tell us guides a study, not a sale.',
        about: 'Who we are: MedSociety is a medical directory for the US–Mexico border: El Paso and Ciudad Juárez, and San Diego and Tijuana. Why we ask: we want to understand how people on both sides get healthcare, and where the process gets hard.',
        who: 'Who is answering?',
        segs: {
            employer: ['Employer', 'I own or run a business, or handle HR'],
            employee: ['Employee or patient', 'I work for a company or organization, or I am seeking care'],
            provider: ['Healthcare provider', 'I am a doctor, dentist, or run a clinic or lab'],
        },
        time: 'Your answers are saved on this device as you go, in case the signal drops.',
        step: (n, m) => 'Step ' + n + ' of ' + m,
        next: 'Continue', back: 'Back', send: 'Send answers', sending: 'Sending…',
        switchSeg: 'Change', switchTitle: 'Answer as a different kind of person',
        optional: '(optional)', choose: 'Choose a state', all: 'Pick all that apply', otherLabel: 'Other (type which)',
        otherPh: 'Type here',
        errPick: 'Pick an option to continue.',
        errText: 'Type an answer to continue.',
        errContact: 'We need an email, a phone, or a WhatsApp number to follow up.',
        reach: 'An email, a phone, or a WhatsApp number is enough, any one.',
        upTo: (n) => 'Pick up to ' + n,
        errMax: (n) => 'You can pick up to ' + n + '. Remove one to swap it.',
        errSend: 'That did not go through. Check your signal and tap send again.',
        sendnote: 'When you send, your answers go to the study team. Nothing is shared with your employer or an insurer.',
        restored: 'Picked up where you left off.',
        doneH: 'Thank you.',
        doneP: 'What you told us helps explain how people on the border get healthcare, and where it gets stuck.',
        doneF: 'Since you said yes to a follow-up, we will reach out soon.',
        again: 'Fill out another form',
        foot: 'A study conducted by MedSociety. Only the study team sees your answers. They are never sold or shared with your employer or an insurer. Questions: hello@medsociety.one',
        yes: 'Yes', no: 'No',
        docTitle: 'Border healthcare access study · MedSociety',
    },
};
