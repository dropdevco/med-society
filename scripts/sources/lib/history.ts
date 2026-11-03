/**
 * Read access to past runs, for the dashboard. Today it reads the run files;
 * once runs are loaded into Supabase (roadmap phase 2, docs/adr/0003) this
 * module reads `source_runs` / `source_observations` instead and the
 * dashboard does not change.
 */
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR, type RunRecord } from './snapshot';

export type RunSummary = Omit<RunRecord, 'entries' | 'added' | 'removed'>;

const runsDir = (source: string) => path.join(DATA_DIR, source, 'runs');

/** Run files, newest first. Names start with the run's start time, so a name sort is a time sort. */
export function runFiles(source: string): string[] {
    const dir = runsDir(source);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => path.join(dir, f));
}

function read(file: string): RunRecord | null {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf-8')) as RunRecord;
    } catch {
        return null; // half-written or hand-edited: skip it
    }
}

export function summarize(run: RunRecord): RunSummary {
    const { entries: _e, added: _a, removed: _r, ...rest } = run;
    void _e; void _a; void _r;
    return rest;
}

/** Newest runs first, without their entries. */
export function recentRuns(source: string, limit = 26): RunSummary[] {
    const out: RunSummary[] = [];
    for (const f of runFiles(source)) {
        const run = read(f);
        if (run) out.push(summarize(run));
        if (out.length >= limit) break;
    }
    return out;
}

/** One full run, by its run ID, or the newest when `id` is "latest". */
export function findRun(source: string, id: string): RunRecord | null {
    for (const f of runFiles(source)) {
        if (id !== 'latest' && !path.basename(f).includes(id)) continue;
        const run = read(f);
        if (run && (id === 'latest' || run.id === id)) return run;
    }
    return null;
}
