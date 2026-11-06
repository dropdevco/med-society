/**
 * Every run is written to disk, green or red, as one JSON file. Until the
 * database tables exist (docs/adr/0003) this is the pipeline's memory: the
 * last green run is what the next one is compared against.
 */
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { ObservedEntry, Permission } from './types';
import type { TargetOutcome } from './judge';

export const DATA_DIR = process.env.SOURCES_DATA_DIR
    ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.data');

export interface RunRecord {
    /** UUIDv7: unique across sources, machines and time, and ordered by when the run started. */
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
    entries: ObservedEntry[];
    /** Lookup sources: question → when it was last answered. */
    lookups?: Record<string, string>;
}

const runsDir = (source: string) => path.join(DATA_DIR, source, 'runs');

/**
 * A UUIDv7 (RFC 9562): 48 bits of Unix milliseconds, then random bits.
 * Unique without coordination between machines, and time-ordered, so it
 * sorts and indexes well when there are millions of rows behind it.
 */
export function uuidv7(ms = Date.now()): string {
    const b = randomBytes(16);
    b.writeUIntBE(ms, 0, 6);
    b[6] = (b[6] & 0x0f) | 0x70; // version 7
    b[8] = (b[8] & 0x3f) | 0x80; // RFC 9562 variant
    const h = b.toString('hex');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The run file's name: start time first so a directory listing reads in order, then the run ID. */
export const runFileName = (run: Pick<RunRecord, 'id' | 'startedAt'>) =>
    `${run.startedAt.replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')}_${run.id}.json`;

export function writeRun(run: RunRecord): string {
    const dir = runsDir(run.source);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, runFileName(run));
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
