/**
 * Run one source: check access and robots.txt, fetch each target, parse,
 * judge green or red against the last good run, and write the run to disk.
 *
 *   npm run sources -- --source=hospital-angeles
 *   npm run sources -- --list
 *
 * Exit code: 0 green, 2 red (the run is still written), 1 could not run.
 * Loading into the database (--commit) arrives with roadmap phase 2.
 */
import { pathToFileURL } from 'url';
import { ADAPTERS } from './adapters';
import { BlockedError, politeGet } from './lib/http';
import { judgeRun, mergeEntries, type TargetOutcome } from './lib/judge';
import { robotsVerdict } from './lib/robots';
import { diffIds, lastGoodRun, runId, writeRun, type RunRecord } from './lib/snapshot';
import type { SourceAdapter, SourceEntry } from './lib/types';

function arg(name: string): string | true | undefined {
    for (const a of process.argv.slice(2)) {
        if (a === `--${name}`) return true;
        if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
    }
    return undefined;
}

export async function runSource(adapter: SourceAdapter): Promise<{ run: RunRecord; file: string }> {
    const started = new Date();
    const targets: TargetOutcome[] = [];
    const parsed: SourceEntry[] = [];
    const reasons: string[] = [];

    const robots = await robotsVerdict(adapter.targets.map((t) => t.url));
    if (!robots.allowed) reasons.push(robots.reason!);

    if (robots.allowed) {
        for (const t of adapter.targets) {
            try {
                const page = await politeGet(t.url);
                const rows = adapter.parse(page.body, t);
                parsed.push(...rows);
                targets.push({ key: t.key, url: t.url, ok: true, count: new Set(rows.map((r) => r.externalId)).size });
            } catch (err) {
                const blocked = err instanceof BlockedError;
                const error = blocked
                    ? `${(err as Error).message}; do not retry with other tools, ask the organization (docs/adr/0002)`
                    : (err as Error).message;
                targets.push({ key: t.key, url: t.url, ok: false, count: 0, error });
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
        id: runId(started),
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
    };
    return { run, file: writeRun(run) };
}

async function main() {
    if (arg('list')) {
        for (const a of Object.values(ADAPTERS)) console.log(`${a.slug}\t${a.access}\t${a.name}`);
        return;
    }
    if (arg('commit')) {
        console.error('--commit loads into the database, which arrives with roadmap phase 2. Run without it for now.');
        process.exit(1);
    }
    const slug = arg('source');
    const adapter = typeof slug === 'string' ? ADAPTERS[slug] : undefined;
    if (!adapter) {
        console.error(`Usage: npm run sources -- --source=<slug>. Known: ${Object.keys(ADAPTERS).join(', ')}`);
        process.exit(1);
    }
    if (adapter.access === 'permission' && !adapter.permission) {
        console.error(`${adapter.slug} needs written permission recorded before it runs (docs/adr/0002).`);
        process.exit(1);
    }

    const { run, file } = await runSource(adapter);
    console.log(`${run.source}: ${run.status.toUpperCase()}  ${run.counts.entries} entries  +${run.counts.added} -${run.counts.removed}`);
    for (const t of run.targets) console.log(`  ${t.key.padEnd(14)} ${t.ok ? `${t.count} entries` : `FAILED ${t.error}`}`);
    for (const r of run.reasons) console.log(`  red: ${r}`);
    console.log(`  run written to ${file}`);
    process.exit(run.status === 'green' ? 0 : 2);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
