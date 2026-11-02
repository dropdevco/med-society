/**
 * Every run is written to disk, green or red, as one JSON file. Until the
 * database tables exist (docs/adr/0003) this is the pipeline's memory: the
 * last green run is what the next one is compared against.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { Permission, SourceEntry } from './types';
import type { TargetOutcome } from './judge';

export const DATA_DIR = process.env.SOURCES_DATA_DIR
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data');

export interface RunRecord {
    id: string;
    source: string;
    startedAt: string;
    finishedAt: string;
    status: 'green' | 'red';
    reasons: string[];
    permission: Permission | null;
    targets: TargetOutcome[];
    counts: { entries: number; added: number; removed: number };
    added: string[];
    removed: string[];
    entries: SourceEntry[];
}

const runsDir = (source: string) => path.join(DATA_DIR, source, 'runs');

/** Sortable and safe in a file name on Windows: 2026-11-02T18-30-05Z. */
export const runId = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');

export function writeRun(run: RunRecord): string {
    const dir = runsDir(run.source);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${run.id}.json`);
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
    fs.renameSync(tmp, file);
    return file;
}

export function lastGoodRun(source: string): RunRecord | null {
    const dir = runsDir(source);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse();
    for (const f of files) {
        try {
            const run = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as RunRecord;
            if (run.status === 'green') return run;
        } catch {
            // A half-written or hand-edited file is skipped, not fatal.
        }
    }
    return null;
}

export function diffIds(before: string[], after: string[]) {
    const a = new Set(before);
    const b = new Set(after);
    return {
        added: after.filter((id) => !a.has(id)),
        removed: before.filter((id) => !b.has(id)),
    };
}
