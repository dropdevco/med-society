/**
 * Run one source: check access and robots.txt, fetch each target, parse,
 * judge green or red against the last good run, and write the run to disk.
 *
 *   npm run sources -- --source=hospital-angeles
 *   npm run sources -- --all
 *   npm run sources -- --list
 *   npm run sources -- --source=starmedica --commit   # scrape, then load into the database
 *   npm run sources -- --all --load                   # no scraping: load each source's last good run
 *
 * Exit code: 0 green, 2 red (the run is still written), 1 could not run.
 * With --all, the worst of the sources' codes.
 */
import { pathToFileURL } from 'url';
import { ADAPTERS } from './adapters';
import { database } from './lib/db';
import { BlockedError, politeGet } from './lib/http';
import { judgeRun, mergeEntries, type TargetOutcome } from './lib/judge';
import { loadRun } from './lib/load';
import { robotsVerdict } from './lib/robots';
import { diffIds, lastGoodRun, uuidv7, writeRun, type RunRecord } from './lib/snapshot';
import type { ObservedEntry, SourceAdapter, SourceEntry } from './lib/types';

function arg(name: string): string | true | undefined {
    for (const a of process.argv.slice(2)) {
        if (a === `--${name}`) return true;
        if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
    }
    return undefined;
}

export async function runSource(adapter: SourceAdapter): Promise<{ run: RunRecord; file: string }> {
    const started = new Date();
    const id = uuidv7(started.getTime());
    const targets: TargetOutcome[] = [];
    const parsed: ObservedEntry[] = [];
    const reasons: string[] = [];
    let lookups: Record<string, string> | undefined;

    // robots.txt is read every run unless the recorded permission names it as waived (docs/adr/0002).
    const robotsWaived = adapter.permission?.waives?.includes('robots') ?? false;
    const robots = robotsWaived ? { allowed: true } : await robotsVerdict(adapter.targets.map((t) => t.url));
    if (!robots.allowed) reasons.push(robots.reason!);

    if (robots.allowed && adapter.collect) {
        try {
            const got = await adapter.collect();
            targets.push(...got.targets);
            reasons.push(...got.reasons);
            parsed.push(...got.entries.map((e) => ({ ...e, runId: e.runId ?? id })));
            lookups = got.lookups;
        } catch (err) {
            targets.push({ key: 'collect', url: adapter.targets[0]?.url ?? '', ok: false, count: 0, fetchedAt: new Date().toISOString(), error: (err as Error).message });
        }
    } else if (robots.allowed && adapter.parse) {
        for (const t of adapter.targets) {
            try {
                const page = await politeGet(t.url);
                const fetchedAt = new Date().toISOString();
                const rows: SourceEntry[] = adapter.parse(page.body, t);
                parsed.push(...rows.map((r) => ({ ...r, runId: id, observedAt: fetchedAt })));
                targets.push({ key: t.key, url: t.url, ok: true, count: new Set(rows.map((r) => r.externalId)).size, fetchedAt });
            } catch (err) {
                const blocked = err instanceof BlockedError;
                const error = blocked
                    ? `${(err as Error).message}; do not retry with other tools, ask the organization (docs/adr/0002)`
                    : (err as Error).message;
                targets.push({ key: t.key, url: t.url, ok: false, count: 0, fetchedAt: new Date().toISOString(), error });
                if (blocked) break; // one "no" is enough; don't knock on the other doors
            }
        }
    }

    const entries = mergeEntries(parsed);
    const previous = lastGoodRun(adapter.slug);
    const lastCounts = previous ? Object.fromEntries(previous.targets.map((t) => [t.key, t.count])) : null;
    const verdict = judgeRun(targets, entries, lastCounts);
    reasons.push(...verdict.reasons);
    const status = reasons.length ? 'red' : 'green';
    const { added, removed } = previous
        ? diffIds(previous.entries.map((e) => e.externalId), entries.map((e) => e.externalId))
        : { added: entries.map((e) => e.externalId), removed: [] };

    const run: RunRecord = {
        id,
        source: adapter.slug,
        startedAt: started.toISOString(),
        finishedAt: new Date().toISOString(),
        status,
        reasons,
        permission: adapter.permission ?? null,
        targets,
        counts: { entries: entries.length, added: added.length, removed: removed.length },
        added,
        removed,
        entries,
        ...(lookups ? { lookups } : {}),
    };
    return { run, file: writeRun(run) };
}

/** docs/adr/0002: a source that needs permission does not run until the letter is recorded. */
export const mayRun = (a: SourceAdapter) => a.access === 'open' || !!a.permission;

/** Run one source and print its summary. Returns the exit code for that source. */
export async function runAndReport(adapter: SourceAdapter, commit = false): Promise<number> {
    if (!mayRun(adapter)) {
        console.error(`${adapter.slug} needs written permission recorded before it runs (docs/adr/0002).`);
        return 1;
    }
    const { run, file } = await runSource(adapter);
    console.log(`${run.source}: ${run.status.toUpperCase()}  ${run.counts.entries} entries  +${run.counts.added} -${run.counts.removed}`);
    console.log(`  run ${run.id}  started ${run.startedAt}`);
    for (const t of run.targets) console.log(`  ${t.key.padEnd(14)} ${t.ok ? `${t.count} entries` : `FAILED ${t.error}`}`);
    for (const r of run.reasons) console.log(`  red: ${r}`);
    console.log(`  run written to ${file}`);
    if (commit) await loadAndReport(run);
    return run.status === 'green' ? 0 : 2;
}

async function loadAndReport(run: RunRecord) {
    const s = await loadRun(database(), run, ADAPTERS[run.source]?.entity);
    console.log(`  loaded: ${s.entries} entries, ${s.newRecords} new | confirmed ${s.confirmed}, to review ${s.probable}, unmatched ${s.unmatched} | badges ${JSON.stringify(s.badges)}`);
}

async function main() {
    if (arg('list')) {
        for (const a of Object.values(ADAPTERS)) console.log(`${a.slug}\t${a.access}\t${a.name}`);
        return;
    }
    const commit = !!arg('commit');
    if (arg('load')) {
        const slug = arg('source');
        const list = typeof slug === 'string' ? [ADAPTERS[slug]] : Object.values(ADAPTERS);
        for (const a of list) {
            const run = a && lastGoodRun(a.slug);
            if (!run) { console.log(`${a?.slug ?? slug}: no good run to load`); continue; }
            console.log(`${a.slug}: loading run ${run.id}`);
            await loadAndReport(run);
        }
        return;
    }
    if (arg('all')) {
        let worst = 0;
        for (const a of Object.values(ADAPTERS)) worst = Math.max(worst, await runAndReport(a, commit));
        process.exit(worst);
    }
    const slug = arg('source');
    const adapter = typeof slug === 'string' ? ADAPTERS[slug] : undefined;
    if (!adapter) {
        console.error(`Usage: npm run sources -- --source=<slug> | --all | --list [--commit] [--load]. Known: ${Object.keys(ADAPTERS).join(', ')}`);
        process.exit(1);
    }
    process.exit(await runAndReport(adapter, commit));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
