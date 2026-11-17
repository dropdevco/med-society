/**
 * A write-once list of one UUID per source record, so a doctor created from a
 * review keeps the same doctors.id however many times the runs are read. An
 * existing ID is never changed. Kept in .data (git-ignored): it holds source IDs.
 *
 *   npx tsx scripts/sources/doctor-registry.ts [--source=hospital-angeles]
 */
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { DATA_DIR, type RunRecord } from './lib/snapshot';

export interface RegistryEntry { doctorId: string; firstRunId: string; createdAt: string }
export type Registry = Record<string, RegistryEntry>;

/** Adds what is new. Runs are read oldest first, so firstRunId is where a record first appeared. */
export function extendRegistry(registry: Registry, runs: Pick<RunRecord, 'id' | 'startedAt' | 'status' | 'entries'>[], makeId: () => string = randomUUID) {
    const next: Registry = { ...registry };
    let added = 0;
    for (const run of [...runs].filter((r) => r.status === 'green').sort((a, b) => a.id.localeCompare(b.id))) {
        for (const e of run.entries) {
            if (next[e.externalId]) continue;
            next[e.externalId] = { doctorId: makeId(), firstRunId: run.id, createdAt: run.startedAt };
            added++;
        }
    }
    return { registry: next, added };
}

/** Empty when the registry only grew. */
export function changedIds(before: Registry, after: Registry): string[] {
    return Object.keys(before).filter((k) => after[k]?.doctorId !== before[k].doctorId);
}

const registryFile = (source: string) => join(DATA_DIR, 'doctor-registry', `${source}.json`);

function readRuns(source: string): RunRecord[] {
    const dir = join(DATA_DIR, source, 'runs');
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as RunRecord);
}

function main() {
    const source = process.argv.find((a) => a.startsWith('--source='))?.slice(9) ?? 'hospital-angeles';
    const file = registryFile(source);
    const before: Registry = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    const runs = readRuns(source);
    const { registry, added } = extendRegistry(before, runs);
    const changed = changedIds(before, registry);
    if (changed.length) throw new Error(`${changed.length} existing IDs would change; refusing to write`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(registry, null, 1));
    renameSync(`${file}.tmp`, file);
    console.log(`${source}: ${runs.length} runs | ${Object.keys(registry).length} IDs | ${added} new | 0 changed`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
