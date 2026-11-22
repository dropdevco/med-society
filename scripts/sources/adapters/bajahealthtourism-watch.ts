/**
 * Baja California Health Tourism (bajahealthtourism.com.mx, the state Tourism
 * Secretariat's platform): a watch, not a scrape. Each run reads the four catalogue
 * lists the site's own pages read (doctors, hospitals, clinics, hotels) and keeps
 * only enough to tell a new record from a known one: its id, name, type and place.
 * The run's "added" list is the flag. Nothing here is matched or shown on the site.
 *
 * The doctors list returns whole records: contact details, licence numbers, links to
 * uploaded certification documents and the staff accounts that reviewed them, plus
 * tax (RFC) and identity fields that were empty on every record on 22 Nov 2026.
 * None of that is kept: only the fields picked in `watchEntry`
 * ever reach a run file or the database.
 * Notes: docs/sources/bajahealthtourism-watch.md
 */
import { politeGet } from '../lib/http';
import type { TargetOutcome } from '../lib/judge';
import { regionOf } from '../lib/places';
import type { Collected, CollectedEntry, SourceAdapter } from '../lib/types';

export const BHT_API = 'https://ws.bajahealthtourism.com.mx/api';
export const BHT_SITE = 'https://bajahealthtourism.com.mx';

/** What we watch, and the site's own section for each. */
export const WATCHED = [
    { kind: 'doctor', list: 'doctors', section: 'doctors' },
    { kind: 'hospital', list: 'hospitals', section: 'hospitals-clinics' },
    { kind: 'clinic', list: 'clinics', section: 'hospitals-clinics' },
    { kind: 'hotel', list: 'hotels', section: 'hotels' },
] as const;

const str = (v: unknown): string | null => {
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'number') return String(v);
    if (v && typeof v === 'object' && 'name' in v) return str((v as { name: unknown }).name);
    return null;
};

/**
 * The only fields kept from a record. Everything else the API returns (phones,
 * e-mails, licences, document links, staff accounts, and the RFC and identity
 * fields should they ever be filled) is dropped here, on purpose.
 */
export function watchEntry(kind: (typeof WATCHED)[number]['kind'], section: string, r: Record<string, unknown>, municipalities: Map<string, string>, observedAt: string): CollectedEntry | null {
    const id = str(r.id);
    const name = str(r.name) ?? str(r.full_name);
    if (!id || !name) return null;
    if (r.active !== undefined && String(r.active) !== '1' && r.active !== true) return null;
    const municipality = str(r.municipality) ?? (str(r.municipality_id) ? municipalities.get(str(r.municipality_id)!) ?? null : null);
    return {
        externalId: `${kind}:${id}`,
        name,
        title: null,
        specialties: [],
        cedulas: [],
        sites: [],
        region: regionOf('Mexico', municipality),
        url: `${BHT_SITE}/${section}`,
        photoUrl: null,
        observedAt,
        extra: {
            label: kind,
            kind,
            siteId: id,
            slug: str(r.slu),
            entityType: str(r.typeEntity),
            municipality,
            listedAt: str(r.created_at),
        },
    };
}

/** Municipality id → name, from the site's own list of places. */
export function municipalityNames(body: string): Map<string, string> {
    const parsed = JSON.parse(body) as { value?: Array<{ municipalities?: Array<{ id: unknown; name: unknown }> }> };
    const out = new Map<string, string>();
    for (const state of parsed.value ?? []) for (const m of state.municipalities ?? []) {
        const id = str(m.id), name = str(m.name);
        if (id && name) out.set(id, name);
    }
    return out;
}

async function collect(): Promise<Collected> {
    const municipalities = municipalityNames((await politeGet(`${BHT_API}/cities`)).body);
    const entries: CollectedEntry[] = [];
    const detail: Record<string, number> = {};
    for (const w of WATCHED) {
        const body = JSON.parse((await politeGet(`${BHT_API}/view-list/${w.list}?active=true`)).body) as { success?: boolean; value?: unknown };
        if (!Array.isArray(body.value)) throw new Error(`${w.list}: the catalogue answered without a list (format change?)`);
        const at = new Date().toISOString();
        const kept = (body.value as Record<string, unknown>[]).map((r) => watchEntry(w.kind, w.section, r, municipalities, at)).filter((e) => e !== null);
        detail[w.list] = kept.length;
        entries.push(...kept);
    }
    const target: TargetOutcome = { key: 'catalogue', url: `${BHT_API}/view-list`, ok: true, count: entries.length, fetchedAt: new Date().toISOString(), detail };
    return { targets: [target], entries, reasons: [] };
}

export const bajaHealthTourismWatch: SourceAdapter = {
    slug: 'bajahealthtourism-watch',
    name: 'Baja California Health Tourism catalogue (watch only)',
    kind: 'regulator',
    entity: 'watch',
    access: 'open',
    // robots.txt is read for the API host the lists come from ("Disallow:" with nothing after it: all allowed).
    targets: WATCHED.map((w) => ({ key: w.list, label: w.list, url: `${BHT_API}/view-list/${w.list}?active=true`, region: 'sandiego-tijuana' as const })),
    collect,
};
