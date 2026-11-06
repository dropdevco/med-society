/**
 * Loads a finished run into the database (migration 0035). Every row carries
 * the run's ID. A red run is recorded and nothing else changes, so an outage
 * can't touch a badge. A source record that already has a match decision only
 * has it renewed; matching runs for new records alone, so a weekly run costs
 * the number of new doctors, not the size of the directory.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { allRows, inChunks } from './db';
import { decide, decideFacility, type FacilityCandidate, type NameCandidate } from './match';
import { nameKey, parseName } from './names';
import type { RunRecord } from './snapshot';
import type { ObservedEntry } from './types';

export interface LoadSummary {
    run: string;
    status: string;
    entries: number;
    newRecords: number;
    confirmed: number;
    probable: number;
    unmatched: number;
    badges: { renewed: number; lapsed: number } | null;
}

/** What the badge says: the hospital site, or the certified specialty. */
export function entryRow(e: ObservedEntry, source: string) {
    const x = e.extra ?? {};
    const facts = Object.fromEntries(Object.entries({ consejo: x.consejo, certificate: x.certificate, register: x.register }).filter(([, v]) => v != null));
    return {
        source_slug: source,
        external_id: e.externalId,
        name: e.name,
        label: typeof x.label === 'string' ? x.label : x.consejo ? (e.specialties[0] ?? '') : (e.sites[0]?.name ?? ''),
        specialties: e.specialties,
        cedulas: e.cedulas,
        region: e.region,
        url: e.url,
        valid_from: (x.validFrom as string | null) ?? null,
        valid_to: (x.validTo as string | null) ?? null,
        facts,
    };
}

export async function loadRun(db: SupabaseClient, run: RunRecord, entity: 'doctor' | 'facility' = 'doctor'): Promise<LoadSummary> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-7/.test(run.id)) throw new Error(`run ${run.id} has no UUIDv7 run ID, so it cannot be loaded`);
    const source = run.source;
    const summary: LoadSummary = { run: run.id, status: run.status, entries: run.entries.length, newRecords: 0, confirmed: 0, probable: 0, unmatched: 0, badges: null };

    const { error: runError } = await db.from('source_runs').upsert({
        id: run.id, source_slug: source, started_at: run.startedAt, finished_at: run.finishedAt,
        status: run.status, reasons: run.reasons, counts: run.counts, targets: run.targets,
    });
    if (runError) throw new Error(`source_runs: ${runError.message}`);
    if (run.status !== 'green') return summary;

    // Entries: keep first_seen, move last_seen, reset the miss counter.
    type Existing = { id: string; external_id: string; first_seen_run_id: string; missed_runs: number };
    const existing = await allRows<Existing>((a, b) => db.from('source_entries').select('id,external_id,first_seen_run_id,missed_runs').eq('source_slug', source).order('id').range(a, b));
    const known = new Map(existing.map((e) => [e.external_id, e]));
    const rows = run.entries.map((e) => ({
        ...entryRow(e, source),
        first_seen_run_id: known.get(e.externalId)?.first_seen_run_id ?? run.id,
        last_seen_run_id: run.id,
        missed_runs: 0,
    }));
    await inChunks(rows, 500, (c) => db.from('source_entries').upsert(c, { onConflict: 'source_slug,external_id' }));

    const ids = new Map((await allRows<{ id: string; external_id: string }>((a, b) => db.from('source_entries').select('id,external_id').eq('source_slug', source).order('id').range(a, b))).map((r) => [r.external_id, r.id]));
    const observations = run.entries.map((e) => ({ run_id: run.id, entry_id: ids.get(e.externalId)!, observed_at: e.observedAt, payload: e }));
    await inChunks(observations, 500, (c) => db.from('source_observations').upsert(c));

    // Directory sources only: a record missing from a green run counts a miss. A lookup source asks different questions each time.
    const lookup = run.targets.some((t) => t.noBaseline);
    if (!lookup) {
        const seen = new Set(run.entries.map((e) => e.externalId));
        const missed = existing.filter((e) => !seen.has(e.external_id));
        for (const n of new Set(missed.map((e) => e.missed_runs))) {
            const group = missed.filter((e) => e.missed_runs === n).map((e) => e.id);
            await inChunks(group, 200, (c) => db.from('source_entries').update({ missed_runs: n + 1 }).in('id', c));
        }
    }

    if (entity === 'facility') return matchFacilities(db, run, summary, !lookup);

    // Known records: reuse the decision. New records: match.
    const decided = new Set((await allRows<{ external_id: string }>((a, b) => db.from('doctor_source_ids').select('external_id').eq('source_slug', source).order('external_id').range(a, b))).map((r) => r.external_id));
    const seenDecided = run.entries.filter((e) => decided.has(e.externalId)).map((e) => e.externalId);
    await inChunks(seenDecided, 200, (c) => db.from('doctor_source_ids').update({ last_run_id: run.id }).eq('source_slug', source).in('external_id', c));

    const fresh = run.entries.filter((e) => !decided.has(e.externalId));
    summary.newRecords = fresh.length;
    const allCedulas = [...new Set(fresh.flatMap((e) => e.cedulas))];
    const cedulaOwner = new Map<string, string>();
    for (let i = 0; i < allCedulas.length; i += 200) {
        const { data, error } = await db.from('doctor_cedulas').select('cedula,doctor_id').in('cedula', allCedulas.slice(i, i + 200));
        if (error) throw new Error(`doctor_cedulas: ${error.message}`);
        for (const r of data ?? []) cedulaOwner.set(r.cedula, r.doctor_id);
    }

    const matches = [];
    const newCedulas = [];
    for (const e of fresh) {
        const { data, error } = await db.rpc('doctor_name_candidates', { p_name: e.name, p_name_key: nameKey(parseName(e.name)) ?? '', p_limit: 5 });
        if (error) throw new Error(`doctor_name_candidates: ${error.message}`);
        const d = decide({
            cedulaDoctors: e.cedulas.map((c) => cedulaOwner.get(c)).filter((x): x is string => !!x),
            candidates: (data ?? []) as NameCandidate[],
            region: e.region,
        });
        summary[d.status]++;
        matches.push({
            source_slug: source, external_id: e.externalId, doctor_id: d.doctorId, status: d.status, tier: d.tier,
            confidence: d.confidence, candidates: d.candidates, first_run_id: run.id, last_run_id: run.id,
        });
        if (d.status === 'confirmed') {
            for (const c of e.cedulas) if (!cedulaOwner.has(c)) {
                cedulaOwner.set(c, d.doctorId!);
                newCedulas.push({ cedula: c, doctor_id: d.doctorId!, first_source: source, verified_by: 'source_published', run_id: run.id });
            }
        }
    }
    await inChunks(matches, 500, (c) => db.from('doctor_source_ids').upsert(c, { onConflict: 'source_slug,external_id' }));
    await inChunks(newCedulas, 500, (c) => db.from('doctor_cedulas').upsert(c, { onConflict: 'cedula', ignoreDuplicates: true }));

    const { data: sync, error: syncError } = await db.rpc('sync_source_badges', { p_source: source, p_run: run.id, p_lapse: !lookup });
    if (syncError) throw new Error(`sync_source_badges: ${syncError.message}`);
    summary.badges = sync as LoadSummary['badges'];
    return summary;
}

/** docs/adr/0008: only confirmed and rejected are final, so a listing added later is still found. */
async function matchFacilities(db: SupabaseClient, run: RunRecord, summary: LoadSummary, lapse: boolean): Promise<LoadSummary> {
    const source = run.source;
    type Known = { external_id: string; status: string; first_run_id: string | null };
    const known = new Map((await allRows<Known>((a, b) => db.from('facility_source_ids').select('external_id,status,first_run_id').eq('source_slug', source).order('external_id').range(a, b))).map((r) => [r.external_id, r]));
    const final = (id: string) => ['confirmed', 'rejected'].includes(known.get(id)?.status ?? '');

    const seen = run.entries.filter((e) => final(e.externalId)).map((e) => e.externalId);
    await inChunks(seen, 200, (c) => db.from('facility_source_ids').update({ last_run_id: run.id }).eq('source_slug', source).in('external_id', c));

    // The register number ties a record to the listing COEPRIS's record was confirmed on.
    const { data: owners, error: ownerError } = await db.from('facility_source_ids').select('external_id,provider_id').eq('source_slug', 'coepris-bc').eq('status', 'confirmed');
    if (ownerError) throw new Error(`facility_source_ids: ${ownerError.message}`);
    const byRegister = new Map((owners ?? []).map((o) => [o.external_id as string, o.provider_id as string]));

    const fresh = run.entries.filter((e) => !final(e.externalId));
    summary.newRecords = fresh.filter((e) => !known.has(e.externalId)).length;
    const matches = [];
    for (const e of fresh) {
        const { data, error } = await db.rpc('facility_name_candidates', { p_name: e.name, p_region: e.region, p_limit: 5 });
        if (error) throw new Error(`facility_name_candidates: ${error.message}`);
        const register = typeof e.extra?.register === 'string' ? e.extra.register : null;
        const d = decideFacility({ registerListing: register ? byRegister.get(register) ?? null : null, candidates: (data ?? []) as FacilityCandidate[] });
        summary[d.status]++;
        matches.push({
            source_slug: source, external_id: e.externalId, provider_id: d.providerId, status: d.status, tier: d.tier,
            confidence: d.confidence, candidates: d.candidates, first_run_id: known.get(e.externalId)?.first_run_id ?? run.id, last_run_id: run.id,
        });
    }
    await inChunks(matches, 500, (c) => db.from('facility_source_ids').upsert(c, { onConflict: 'source_slug,external_id' }));

    const { data: sync, error: syncError } = await db.rpc('sync_facility_badges', { p_source: source, p_run: run.id, p_lapse: lapse });
    if (syncError) throw new Error(`sync_facility_badges: ${syncError.message}`);
    summary.badges = sync as LoadSummary['badges'];
    return summary;
}
