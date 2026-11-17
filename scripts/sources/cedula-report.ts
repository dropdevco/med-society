/**
 * A read-only check of doctoralia_doctors.cedulas before the backfill trusts
 * them: scraped numbers can be phones, shared by mistake, or attached to the
 * wrong person. Prints totals only, never names or numbers.
 *
 *   SOURCES_DB_URL=http://127.0.0.1:54331 npx tsx scripts/sources/cedula-report.ts
 */
import { pathToFileURL } from 'url';
import { cedulasOf, groupPeople, heldForReview, type DoctoraliaRow } from './backfill-doctors';
import { allRows, database } from './lib/db';

export interface CedulaReport {
    records: number;
    withCedula: number;
    rawValues: number;
    droppedAsInvalid: number;
    sharedCedulas: number;
    multiRecordPeople: number;
    multiNamePeople: number;
    recordsHeldForReview: number;
    matchingPhones: number | null;
}

export function buildReport(rows: DoctoraliaRow[], phones: Set<string> | null): CedulaReport {
    const owners = new Map<string, number>();
    let rawValues = 0;
    let kept = 0;
    for (const r of rows) {
        rawValues += new Set(r.cedulas ?? []).size;
        for (const c of cedulasOf(r)) { owners.set(c, (owners.get(c) ?? 0) + 1); kept++; }
    }
    const groups = groupPeople(rows);
    const held = groups.map(heldForReview);
    return {
        records: rows.length,
        withCedula: rows.filter((r) => cedulasOf(r).length).length,
        rawValues,
        droppedAsInvalid: rawValues - kept,
        sharedCedulas: [...owners.values()].filter((n) => n > 1).length,
        multiRecordPeople: groups.filter((g) => g.length > 1).length,
        multiNamePeople: held.filter((h) => h.length).length,
        recordsHeldForReview: held.reduce((n, h) => n + h.length, 0),
        matchingPhones: phones ? [...owners.keys()].filter((c) => phones.has(c)).length : null,
    };
}

async function main() {
    const db = database();
    const rows = await allRows<DoctoraliaRow>((a, b) => db.from('doctoralia_doctors').select('doctoralia_id,name,cedulas,provider_id').eq('entity_type', 'doctor').order('doctoralia_id').range(a, b));
    let phones: Set<string> | null = null;
    try {
        const list = await allRows<{ phone_norm: string | null }>((a, b) => db.from('providers').select('phone_norm').not('phone_norm', 'is', null).order('id').range(a, b));
        phones = new Set(list.map((p) => p.phone_norm!));
    } catch { /* the sandbox copies no contact fields */ }
    const report = buildReport(rows, phones);
    for (const [k, v] of Object.entries(report)) console.log(`${k}: ${v ?? 'not available here'}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
