/**
 * One-off: creates a doctor for every person in doctoralia_doctors (facilities
 * excluded), so sources have someone to match against. Records that share any
 * cédula are one doctor, which also links duplicate listings. A record with no
 * cédula becomes its own doctor; a reviewer can merge it later. Safe to re-run:
 * a Doctoralia ID that already has a doctor is skipped.
 *
 *   npx tsx --env-file=.env.local scripts/sources/backfill-doctors.ts           # report only
 *   npx tsx --env-file=.env.local scripts/sources/backfill-doctors.ts --commit  # write
 */
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { allRows, database, inChunks, isSandbox } from './lib/db';
import { nameKey, parseName } from './lib/names';
import { uuidv7 } from './lib/snapshot';

export interface DoctoraliaRow {
    doctoralia_id: string;
    name: string;
    cedulas: string[] | null;
    provider_id: string | null;
}

const validCedula = (c: string) => /^[0-9]{6,9}$/.test(c);
export const cedulasOf = (r: DoctoraliaRow) => [...new Set((r.cedulas ?? []).map((c) => c.replace(/\D/g, '')).filter(validCedula))];

/** Group records into people: any shared cédula joins two records. */
export function groupPeople(rows: DoctoraliaRow[]): DoctoraliaRow[][] {
    const parent = rows.map((_, i) => i);
    const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const owner = new Map<string, number>();
    rows.forEach((r, i) => {
        for (const c of cedulasOf(r)) {
            const seen = owner.get(c);
            if (seen === undefined) owner.set(c, i);
            else parent[find(i)] = find(seen);
        }
    });
    const groups = new Map<number, DoctoraliaRow[]>();
    rows.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), r]); });
    return [...groups.values()];
}

async function main() {
    const commit = process.argv.includes('--commit');
    const db = database();
    const rows = await allRows<DoctoraliaRow>((a, b) => db.from('doctoralia_doctors').select('doctoralia_id,name,cedulas,provider_id').eq('entity_type', 'doctor').order('doctoralia_id').range(a, b));
    const done = new Set((await allRows<{ external_id: string }>((a, b) => db.from('doctor_source_ids').select('external_id').eq('source_slug', 'doctoralia').order('external_id').range(a, b))).map((r) => r.external_id));
    const todo = rows.filter((r) => !done.has(r.doctoralia_id));
    const groups = groupPeople(todo);

    const runId = uuidv7();
    const now = new Date().toISOString();
    const doctors = [];
    const cedulas = [];
    const sourceIds = [];
    const listings = new Map<string, { provider_id: string; doctor_id: string; method: string; run_id: string }>();
    for (const group of groups) {
        const id = randomUUID();
        const lead = group.find((r) => cedulasOf(r).length) ?? group[0];
        const p = parseName(lead.name);
        doctors.push({ id, display_name: lead.name, given_names: p?.given ?? null, surname1: p?.surname1 ?? null, surname2: p?.surname2 ?? null, name_key: nameKey(p), created_run_id: runId });
        for (const c of new Set(group.flatMap(cedulasOf))) cedulas.push({ cedula: c, doctor_id: id, first_source: 'doctoralia', verified_by: 'source_published', run_id: runId });
        for (const r of group) {
            sourceIds.push({ source_slug: 'doctoralia', external_id: r.doctoralia_id, doctor_id: id, status: 'confirmed', tier: 1, confidence: 1, first_run_id: runId, last_run_id: runId });
            if (r.provider_id) listings.set(r.provider_id, { provider_id: r.provider_id, doctor_id: id, method: 'doctoralia_link', run_id: runId });
        }
    }
    const merged = groups.filter((g) => new Set(g.map((r) => r.provider_id).filter(Boolean)).size > 1).length;
    console.log(`doctoralia doctors: ${rows.length} | already done: ${done.size} | new doctors: ${doctors.length} | cédulas: ${cedulas.length} | listings: ${listings.size} | doctors with several listings: ${merged}`);
    if (!commit) { console.log('report only; add --commit to write'); return; }

    const { error } = await db.from('source_runs').insert({ id: runId, source_slug: 'doctoralia', started_at: now, finished_at: new Date().toISOString(), status: 'green', counts: { doctors: doctors.length, cedulas: cedulas.length, listings: listings.size } });
    if (error) throw new Error(`source_runs: ${error.message}`);
    await inChunks(doctors, 500, (c) => db.from('doctors').insert(c));
    await inChunks(cedulas, 500, (c) => db.from('doctor_cedulas').upsert(c, { onConflict: 'cedula', ignoreDuplicates: true }));
    await inChunks(sourceIds, 500, (c) => db.from('doctor_source_ids').insert(c));
    await inChunks([...listings.values()], 500, (c) => db.from('doctor_listings').upsert(c, { onConflict: 'provider_id', ignoreDuplicates: true }));
    console.log(`written with run ${runId}${isSandbox() ? ' (sandbox)' : ''}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => { console.error(err); process.exit(1); });
}
