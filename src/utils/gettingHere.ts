/**
 * The "Getting here" guide (/getting-here?region=…): which airport, how to
 * cross, what to bring. Plain facts only: no prices, no wait or drive times
 * beyond the ones already on the site, and every rule points to the official
 * source because rules change. A copy of the English text is in api/agent.ts
 * (it cannot import from src/); flights-selftest.ts checks the two agree.
 */
import { BORDER_CROSSINGS } from './borderCrossings';
import { FLIGHT_DESTINATIONS, type FlightDestination } from './flightLinks';
import type { RegionId } from './region';

export type Lang = 'en' | 'es';
type L = Record<Lang, string>;

export const OFFICIAL_LINKS = {
    cbpWaits: 'https://bwt.cbp.gov/',
    cbpDocuments: 'https://www.cbp.gov/travel/us-citizens/western-hemisphere-travel-initiative/faqs',
    inm: 'https://www.gob.mx/inm',
    cbx: 'https://www.crossborderxpress.com/',
} as const;

export interface GuideItem { text: L; href?: string }

export const GUIDE = {
    title: (city: string): L => ({ en: `Getting to ${city} for care`, es: `Cómo llegar a ${city} para tu atención` }),
    intro: (city: string): L => ({
        en: `Most patients fly into an airport on the US side and cross by land, or fly straight into ${city}. Here is how each works, and what to have with you. Rules and waits change, so each step points to the official source.`,
        es: `Casi todos los pacientes vuelan a un aeropuerto del lado de EE. UU. y cruzan por tierra, o vuelan directo a ${city}. Así funciona cada opción y qué llevar contigo. Las reglas y las esperas cambian, así que cada paso apunta a la fuente oficial.`,
    }),
    airportsTitle: { en: 'Choose where to land', es: 'Elige dónde aterrizar' } as L,
    crossTitle: { en: 'Crossing the border', es: 'Cruzar la frontera' } as L,
    cross: (crossings: string[], city: string): L => ({
        en: `From the US airport you can cross by car, rideshare or on foot at ${crossings.join(', ')}. Waits change by the hour and the day, so check the live border wait times before you leave.`
            + ` Many patients stay on the US side and cross for the day to ${city}.`,
        es: `Desde el aeropuerto de EE. UU. puedes cruzar en auto, transporte por app o a pie por ${crossings.join(', ')}. Las esperas cambian cada hora y cada día, así que revisa los tiempos de espera en vivo antes de salir.`
            + ` Muchos pacientes se hospedan del lado de EE. UU. y cruzan el mismo día a ${city}.`,
    }),
    waitsLink: { en: 'Live border wait times (CBP)', es: 'Tiempos de espera en vivo (CBP)' } as L,
    bringTitle: { en: 'What to bring', es: 'Qué llevar' } as L,
    bring: [
        { text: { en: 'Your passport. To return to the US by land, US citizens can also use a passport card, an enhanced driver’s license or a trusted traveler card; check which documents apply to you.', es: 'Tu pasaporte. Para regresar a EE. UU. por tierra, los ciudadanos estadounidenses también pueden usar tarjeta de pasaporte, licencia mejorada o tarjeta de viajero confiable; confirma qué documentos te aplican.' }, href: OFFICIAL_LINKS.cbpDocuments },
        { text: { en: 'Mexico’s entry rules, including whether you need a tourist permit (FMM), depend on how you enter, how long you stay and your nationality. Check before you go.', es: 'Las reglas de entrada de México, incluido si necesitas permiso de turista (FMM), dependen de cómo entras, cuánto te quedas y tu nacionalidad. Confírmalo antes de viajar.' }, href: OFFICIAL_LINKS.inm },
        { text: { en: 'Your appointment confirmation and the clinic’s address and phone, saved on your phone.', es: 'La confirmación de tu cita y la dirección y teléfono de la clínica, guardados en tu teléfono.' } },
        { text: { en: 'Your medicines in their original packaging, with a list of what you take.', es: 'Tus medicamentos en su empaque original, con una lista de lo que tomas.' } },
        { text: { en: 'Ask your clinic whether it can arrange pickup at the border or the airport.', es: 'Pregunta a tu clínica si puede organizar la recogida en la frontera o el aeropuerto.' } },
    ] as GuideItem[],
    cbxTitle: { en: 'Flying out of Tijuana from the US side', es: 'Volar desde Tijuana partiendo del lado de EE. UU.' } as L,
    cbx: {
        en: 'Cross Border Xpress is a pedestrian bridge between a terminal in Otay Mesa, San Diego, and the Tijuana airport, for passengers with a flight. It needs its own ticket and your flight details. Rules and prices are on its site.',
        es: 'Cross Border Xpress es un puente peatonal entre una terminal en Otay Mesa, San Diego, y el aeropuerto de Tijuana, para pasajeros con vuelo. Requiere su propio boleto y los datos de tu vuelo. Las reglas y precios están en su sitio.',
    } as L,
    cbxLink: { en: 'Cross Border Xpress', es: 'Cross Border Xpress' } as L,
    nextTitle: { en: 'Then', es: 'Después' } as L,
    hotelsMx: (city: string): L => ({ en: `Hotels in ${city}`, es: `Hoteles en ${city}` }),
    hotelsUs: (city: string): L => ({ en: `Hotels in ${city}, near the crossing`, es: `Hoteles en ${city}, cerca de la garita` }),
    doctors: (city: string): L => ({ en: `Find a doctor in ${city}`, es: `Encuentra un médico en ${city}` }),
    disclaimer: {
        en: 'General information, not legal or travel advice. Always check the official sources linked here before you travel.',
        es: 'Información general, no asesoría legal ni de viaje. Confirma siempre en las fuentes oficiales enlazadas antes de viajar.',
    } as L,
} as const;

/** The two airports for a region (US side first) and the crossings that serve it, in the language asked. */
export function guideFor(region: RegionId, lang: Lang) {
    const airports: FlightDestination[] = FLIGHT_DESTINATIONS.filter((d) => d.region === region)
        .sort((a, b) => (a.side === 'us' ? -1 : 1) - (b.side === 'us' ? -1 : 1));
    const crossings = BORDER_CROSSINGS.filter((c) => c.region === region).map((c) => c.name[lang]);
    return { airports, crossings };
}
