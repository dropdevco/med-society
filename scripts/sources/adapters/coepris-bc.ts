/**
 * COEPRIS Baja California's REPSSABI register: the state health regulator's
 * list of registered establishments, served as JSON to its own register page.
 * We keep the recovery residences (class 623111) in the Tijuana area.
 * Source notes: docs/sources/coepris-bc.md
 */
import { lastGoodRun } from '../lib/snapshot';
import type { SourceAdapter, SourceEntry } from '../lib/types';
import { dmyToIso } from './padron-salud-bc';

const ORIGIN = 'https://www.coeprisbc.gob.mx';
/** The regulator's class for nursing residences, which it also labels "centros de recuperación". */
const RECOVERY_CLASS = /^623111\b/;
const OUR_AREA = /^(Tijuana|Playas de Rosarito|Rosarito|Tecate)$/i;

const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

export interface RepssabiRecord {
    Fecha: string;
    NumRegistro: string | number;
    NoExpediente: string | number;
    RazonSocial: string;
    Municipio: string;
    Direccion: string;
    Clasificacion: string;
    Emision: string;
    Vigencia: string;
    Estatus: string;
}

/** COEPRIS's own page for one record. It shows what the link carries; see the source notes. */
export function validationUrl(r: RepssabiRecord): string {
    const u = new URL(`${ORIGIN}/repssabi_validacion.php`);
    u.searchParams.set('razonsocial', clean(r.RazonSocial));
    u.searchParams.set('direccion', clean(r.Direccion));
    u.searchParams.set('fecha', clean(r.Fecha));
    u.searchParams.set('numregistro', clean(r.NumRegistro));
    u.searchParams.set('noexpediente', clean(r.NoExpediente));
    u.searchParams.set('vigencia', clean(r.Vigencia));
    return u.href;
}

export const isRecoveryCenter = (r: RepssabiRecord) =>
    RECOVERY_CLASS.test(clean(r.Clasificacion)) && OUR_AREA.test(clean(r.Municipio)) && clean(r.Estatus).toUpperCase() === 'ACTIVO';

/** `statePages`: register number → the Padrón's page, the better proof where one exists. */
export function toEntry(r: RepssabiRecord, statePages: Map<string, string>): SourceEntry {
    const register = clean(r.NumRegistro);
    return {
        externalId: register,
        name: clean(r.RazonSocial),
        title: null,
        specialties: [],
        cedulas: [],
        sites: [{ name: clean(r.RazonSocial), address: clean(r.Direccion) || null, tower: null, office: null }],
        region: 'sandiego-tijuana',
        url: statePages.get(register) ?? validationUrl(r),
        photoUrl: null,
        extra: {
            label: 'REPSSABI',
            register,
            municipality: clean(r.Municipio),
            validFrom: dmyToIso(clean(r.Emision)),
            validTo: dmyToIso(clean(r.Vigencia)),
        },
    };
}

export function parseFeed(body: string, statePages: Map<string, string>): SourceEntry[] {
    const parsed = JSON.parse(body) as { datos?: RepssabiRecord[] };
    if (!Array.isArray(parsed.datos)) throw new Error('the register feed has no "datos" list (format change?)');
    return parsed.datos.filter(isRecoveryCenter).map((r) => toEntry(r, statePages));
}

/** Register number → state page, from the Padrón's last good run. */
function statePagesFromLastRun(): Map<string, string> {
    const run = lastGoodRun('padron-salud-bc');
    return new Map((run?.entries ?? []).flatMap((e) => (typeof e.extra?.register === 'string' ? [[e.extra.register, e.url] as const] : [])));
}

export const coeprisBc: SourceAdapter = {
    slug: 'coepris-bc',
    name: 'COEPRIS REPSSABI register',
    kind: 'regulator',
    entity: 'facility',
    access: 'open',
    targets: [{ key: 'register', label: 'REPSSABI recovery residences', url: `${ORIGIN}/api_coepris.php?tipo=todos`, region: 'sandiego-tijuana' }],
    parse: (body: string) => parseFeed(body, statePagesFromLastRun()),
};
