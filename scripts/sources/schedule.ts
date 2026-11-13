/**
 * The weekly timer. A long-running process that sleeps until the next slot
 * (Mondays 06:00 Mexico City by default, lib/schedule.ts), runs every source
 * one after another, and goes back to sleep. Runs the same under Docker on a
 * laptop or on the VM (docs/adr/0006):
 *
 *   docker compose up -d scheduler
 *   npm run sources:schedule               # same, in the foreground
 *   npm run sources:schedule -- --now      # run one cycle immediately, then keep the timer
 *
 * If the machine was off at the slot, the missed cycle runs at start-up.
 * It writes its state (next run, heartbeat, last cycle) to schedule.json in
 * the data folder; the dashboard reads it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { ADAPTERS } from './adapters';
import { mayRun, runSource } from './run';
import { database } from './lib/db';
import { recentRuns } from './lib/history';
import { loadRun } from './lib/load';
import { describeSchedule, nextRunAt, previousRunAt, scheduleFromEnv, type WeeklySchedule } from './lib/schedule';
import { DATA_DIR } from './lib/snapshot';

export const STATE_FILE = path.join(DATA_DIR, 'schedule.json');
/** How often the scheduler proves it is alive while it waits. The dashboard calls it stopped after 3 missed beats. */
export const HEARTBEAT_MS = 10 * 60_000;

export interface CycleResult {
    source: string;
    runId?: string;
    status: 'green' | 'red' | 'skipped' | 'error';
    entries?: number;
    error?: string;
}

export interface SchedulerState {
    schedule: WeeklySchedule;
    description: string;
    startedAt: string;
    heartbeatAt: string;
    nextRunAt: string;
    running: boolean;
    lastCycle: { reason: string; startedAt: string; finishedAt: string; results: CycleResult[] } | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function readState(): SchedulerState | null {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as SchedulerState;
    } catch {
        return null;
    }
}

function writeState(state: SchedulerState) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
}

async function cycle(state: SchedulerState, reason: string) {
    const startedAt = new Date().toISOString();
    state.running = true;
    state.heartbeatAt = startedAt;
    writeState(state);
    console.log(`[${startedAt}] cycle (${reason}) starting`);

    const results: CycleResult[] = [];
    for (const adapter of Object.values(ADAPTERS)) {
        if (!mayRun(adapter)) {
            results.push({ source: adapter.slug, status: 'skipped', error: 'permission not recorded' });
            continue;
        }
        try {
            const { run } = await runSource(adapter);
            // SOURCES_LOAD=1: also load each run into the database.
            if (process.env.SOURCES_LOAD === '1') await loadRun(database(), run, adapter.entity);
            results.push({ source: adapter.slug, runId: run.id, status: run.status, entries: run.counts.entries });
            console.log(`  ${adapter.slug}: ${run.status} ${run.counts.entries} entries, run ${run.id}`);
        } catch (err) {
            // One broken source never stops the others.
            results.push({ source: adapter.slug, status: 'error', error: (err as Error).message });
            console.error(`  ${adapter.slug}: error ${(err as Error).message}`);
        }
    }
    state.running = false;
    state.lastCycle = { reason, startedAt, finishedAt: new Date().toISOString(), results };
    state.heartbeatAt = state.lastCycle.finishedAt;
    writeState(state);
}

async function main() {
    const schedule = scheduleFromEnv();
    const previous = readState();
    const now = Date.now();
    const state: SchedulerState = {
        schedule,
        description: describeSchedule(schedule),
        startedAt: new Date(now).toISOString(),
        heartbeatAt: new Date(now).toISOString(),
        nextRunAt: new Date(nextRunAt(now, schedule)).toISOString(),
        running: false,
        lastCycle: previous?.lastCycle ?? null,
    };
    writeState(state);
    console.log(`scheduler: ${state.description}; next run ${state.nextRunAt}`);

    // Catch up only for a source with no run since the last slot (the machine
    // was off, or the source is new). A manual run on Sunday counts.
    const lastSlot = previousRunAt(now, schedule);
    const stale = Object.values(ADAPTERS).filter((a) => {
        const latest = recentRuns(a.slug, 1)[0];
        return mayRun(a) && (!latest || Date.parse(latest.startedAt) < lastSlot);
    });
    if (process.argv.includes('--now')) await cycle(state, 'manual');
    else if (stale.length) await cycle(state, `catch-up: ${stale.map((a) => a.slug).join(', ')}`);

    for (;;) {
        const next = nextRunAt(Date.now(), schedule);
        state.nextRunAt = new Date(next).toISOString();
        writeState(state);
        while (Date.now() < next) {
            await sleep(Math.min(next - Date.now(), HEARTBEAT_MS));
            state.heartbeatAt = new Date().toISOString();
            writeState(state);
        }
        await cycle(state, 'scheduled');
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
