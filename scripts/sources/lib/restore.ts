/**
 * A fresh machine (a GitHub Actions runner, a new laptop) has no run files, so
 * every source would look like a first run: no drop check, COEPRIS without the
 * Padrón's links, CONACEM with nothing to look up. Every loaded run is also in
 * the database (`source_runs` plus one `source_observations` row per record,
 * whose payload is the record as the run saw it), so the last green run is
 * rebuilt from there and written to disk. From then on lastGoodRun() reads it
 * like any other run file (docs/adr/0011).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { allRows } from './db';
import { lastGoodRun, writeRun, type RunRecord } from './snapshot';
import type { ObservedEntry } from './types';

export interface RunRow {
    id: string;
    source_slug: string;
    started_at: string;
    finished_at: string | null;
    status: 'green' | 'red';
    reasons: string[] | null;
    counts: Partial<RunRecord['counts']> | null;
    targets: RunRecord['targets'] | null;
}

/** The run file a database run stands for. Added and removed were not kept, so they read as empty. */
export function recordFromRows(run: RunRow, payloads: ObservedEntry[]): RunRecord {
    const entries = [...payloads].sort((a, b) => a.externalId.localeCompare(b.externalId));
    return {
        id: run.id,
        source: run.source_slug,
        startedAt: new Date(run.started_at).toISOString(),
        finishedAt: new Date(run.finished_at ?? run.started_at).toISOString(),
        status: run.status,
        reasons: run.reasons ?? [],
        permission: null,
        targets: run.targets ?? [],
        counts: { entries: entries.length, added: run.counts?.added ?? 0, removed: run.counts?.removed ?? 0 },
        added: [],
        removed: [],
        entries,
        restoredFrom: 'database',
    };
}

/**
 * For each source with no green run on disk, write its last green run from the
 * database. Returns what was restored; a source the database has never seen is skipped.
 */
export async function restoreFromDatabase(db: SupabaseClient, sources: string[]): Promise<Array<{ source: string; run: string; entries: number }>> {
    const restored = [];
    for (const source of sources) {
        if (lastGoodRun(source)) continue;
        const { data, error } = await db.from('source_runs')
            .select('id,source_slug,started_at,finished_at,status,reasons,counts,targets')
            .eq('source_slug', source).eq('status', 'green')
            .order('started_at', { ascending: false }).limit(1);
        if (error) throw new Error(`source_runs: ${error.message}`);
        const run = (data ?? [])[0] as RunRow | undefined;
        if (!run) continue;
        const rows = await allRows<{ payload: ObservedEntry }>((a, b) => db.from('source_observations')
            .select('payload,entry_id').eq('run_id', run.id).order('entry_id').range(a, b));
        if (!rows.length) continue; // a green run with no records cannot be compared against
        const record = recordFromRows(run, rows.map((r) => r.payload));
        writeRun(record);
        restored.push({ source, run: run.id, entries: record.entries.length });
    }
    return restored;
}
