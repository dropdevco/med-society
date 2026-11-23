/**
 * Which model should score matches? Runs the same doctor sample through
 * several OpenRouter models and compares them with an answer key a reviewer
 * wrote, on what matters for auto-linking at a bar (ADR 0014): how many links
 * each would make, how many of those are wrong, and what it costs.
 *
 *   npx tsx --env-file=.env.local scripts/sources/compare-models.ts --build=50      # pick the sample from the queue
 *   npx tsx --env-file=.env.local scripts/sources/compare-models.ts --print         # the sample, one block per item, to judge
 *   npx tsx --env-file=.env.local scripts/sources/compare-models.ts --run --models=a,b
 *   npx tsx --env-file=.env.local scripts/sources/compare-models.ts --report [--bar=80]
 *
 * Reads production, writes nothing to it. Files go to scripts/sources/.data/scorer/compare/ (not in git).
 * The answer key is key.json there: { "<source>/<external_id>": { "candidate": "C1" | null, "same": true | false | null } }.
 */
import * as fs from 'fs';
import * as path from 'path';
import { database } from './lib/db';
import { buildEvidence, candidateId, orderedCandidates, parseAnswer, type Evidence, type QueueItem } from './lib/scorer';
import { DATA_DIR } from './lib/snapshot';
import { ask, candidateFactsFor, readQueueFor } from './score-matches';

const DIR = path.join(DATA_DIR, 'scorer', 'compare');
const SAMPLE = path.join(DIR, 'sample.json');
const KEY = path.join(DIR, 'key.json');
const arg = (n: string) => process.argv.slice(2).find((a) => a === `--${n}` || a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? (process.argv.includes(`--${n}`) ? '' : undefined);

interface SampleItem { key: string; item: QueueItem; evidence: Evidence }
interface Result { key: string; candidate: string | null; score: number; verdict: string; reason: string; ms: number; cost: number; error?: string }

const keyOf = (i: QueueItem) => `${i.source_slug}/${i.external_id}`;
const read = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const write = (f: string, v: unknown) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 1)); };

/** A spread across sources, exact and similar names alike, chosen the same way every time. */
async function build(n: number) {
    const db = database();
    const queue = (await readQueueFor(db, ['doctor'], null)).filter((i) => i.candidates.length > 0 && i.tier !== 1);
    const bySource = new Map<string, QueueItem[]>();
    for (const i of queue.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) bySource.set(i.source_slug, [...(bySource.get(i.source_slug) ?? []), i]);
    const picked: QueueItem[] = [];
    // Round-robin over sources, alternating exact and similar names, every k-th item for spread.
    const pools = [...bySource.values()].map((list) => {
        const exact = list.filter((i) => Math.max(...i.candidates.map((c) => c.similarity)) >= 0.99);
        const similar = list.filter((i) => !exact.includes(i));
        const stride = (l: QueueItem[]) => l.filter((_, idx) => idx % Math.max(1, Math.floor(l.length / 13)) === 0);
        const a = stride(exact), b = stride(similar), out: QueueItem[] = [];
        for (let k = 0; k < Math.max(a.length, b.length); k++) { if (a[k]) out.push(a[k]); if (b[k]) out.push(b[k]); }
        return out;
    });
    for (let k = 0; picked.length < n && pools.some((p) => p[k]); k++) for (const p of pools) if (p[k] && picked.length < n) picked.push(p[k]);
    const facts = await candidateFactsFor(db, picked);
    const sample: SampleItem[] = picked.map((item) => ({ key: keyOf(item), item, evidence: buildEvidence(item, facts) }));
    write(SAMPLE, sample);
    const counts = new Map<string, number>();
    for (const s of sample) counts.set(s.item.source_slug, (counts.get(s.item.source_slug) ?? 0) + 1);
    console.log(`sample of ${sample.length}: ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ')} -> ${SAMPLE}`);
}

function print() {
    for (const [n, s] of read<SampleItem[]>(SAMPLE).entries()) {
        const r = s.evidence.record;
        console.log(`#${n + 1} ${s.key} | ${r.source} | "${r.name}" | ${r.label ?? ''} | ${r.specialties.join('; ') || '-'} | ${r.region ?? '-'}${r.cedula_printed ? ' | cédula printed' : ''} | same-name ${s.evidence.same_name_count}`);
        for (const c of s.evidence.candidates) console.log(`    ${c.ref} "${c.name}" sim ${c.name_similarity} | ${c.specialties.join('; ') || '-'} | ${c.regions.join(',') || '-'} | listings ${c.listings}${c.organizations.length ? ` | ${c.organizations.join(', ')}` : ''}`);
    }
}

async function run(models: string[]) {
    const sample = read<SampleItem[]>(SAMPLE);
    for (const model of models) {
        const results: Result[] = [];
        let next = 0;
        const worker = async () => {
            while (next < sample.length) {
                const s = sample[next++];
                const t0 = Date.now();
                try {
                    const { text, usage } = await ask(s.evidence, model);
                    const a = parseAnswer(text, s.evidence, s.item);
                    const ref = a.candidateId ? s.evidence.candidates[orderedCandidates(s.item).findIndex((c) => candidateId(c) === a.candidateId)]?.ref ?? null : null;
                    results.push({ key: s.key, candidate: ref, score: a.score, verdict: a.verdict, reason: a.reason, ms: Date.now() - t0, cost: usage.cost ?? 0 });
                } catch (err) {
                    results.push({ key: s.key, candidate: null, score: 0, verdict: 'error', reason: '', ms: Date.now() - t0, cost: 0, error: (err as Error).message.slice(0, 200) });
                }
            }
        };
        await Promise.all(Array.from({ length: 4 }, worker));
        write(path.join(DIR, `${model.replace(/[/:]/g, '_')}.json`), results);
        console.log(`${model}: ${results.filter((r) => !r.error).length}/${results.length} answered, $${results.reduce((s, r) => s + r.cost, 0).toFixed(4)}`);
    }
}

function report(bar: number) {
    const key = read<Record<string, { candidate: string | null; same: boolean | null }>>(KEY);
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !['sample.json', 'key.json'].includes(f));
    const sameKeys = Object.entries(key).filter(([, v]) => v.same === true).length;
    console.log(`answer key: ${Object.keys(key).length} items, ${sameKeys} the same person, ${Object.values(key).filter((v) => v.same === false).length} different, ${Object.values(key).filter((v) => v.same === null).length} unsure`);
    console.log(`bar for an auto-link: approve with score >= ${bar}\n`);
    console.log('model'.padEnd(36), 'answered', 'agree', 'links', 'wrong links', 'missed', '$/1000 items', 'avg s');
    for (const f of files) {
        const rs = read<Result[]>(path.join(DIR, f));
        const ok = rs.filter((r) => !r.error);
        let agree = 0, links = 0, wrong = 0, missed = 0;
        for (const r of ok) {
            const k = key[r.key];
            if (!k) continue;
            const said = r.verdict === 'approve' ? r.candidate : null;
            const truth = k.same ? k.candidate : null;
            if (k.same !== null && said === truth) agree++;
            if (r.verdict === 'approve' && r.score >= bar) { links++; if (!(k.same === true && k.candidate === r.candidate)) wrong++; }
            else if (k.same === true) missed++;
        }
        const cost = rs.reduce((s, r) => s + r.cost, 0) / Math.max(1, rs.length) * 1000;
        const secs = ok.reduce((s, r) => s + r.ms, 0) / Math.max(1, ok.length) / 1000;
        console.log(f.replace(/\.json$/, '').replace('_', '/').padEnd(36), `${ok.length}/${rs.length}`.padEnd(8), String(agree).padEnd(5), String(links).padEnd(5), String(wrong).padEnd(11), String(missed).padEnd(6), `$${cost.toFixed(2)}`.padEnd(12), secs.toFixed(1));
    }
}

const b = arg('build');
if (b !== undefined) await build(Number(b) || 50);
else if (arg('print') !== undefined) print();
else if (arg('run') !== undefined) await run((arg('models') ?? '').split(',').filter(Boolean));
else if (arg('report') !== undefined) report(Number(arg('bar')) || 80);
else console.error('usage: --build[=50] | --print | --run --models=a,b | --report [--bar=80]');
