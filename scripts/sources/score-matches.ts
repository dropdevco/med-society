/**
 * The AI match scorer (docs/adr/0012). Shadow mode: it scores the matches
 * waiting in /admin -> Verification and stores the score, verdict and reason
 * beside each; a person still decides. Every scoring run is a source run with
 * its own UUIDv7 (source `ai-scorer`).
 *
 *   npm run sources:score                               # 50 unscored items, every source
 *   npm run sources:score -- --source=baja-health-cluster-doctors --limit=all
 *   npm run sources:score -- --kind=facility            # doctor | facility | all (default all)
 *   npm run sources:score -- --dry                      # show what the model would see for one item; no call, no writes
 *   npm run sources:score -- --try=3                    # call the model for 3 items and print the answers; no writes
 *   npm run sources:score -- --rescore                  # score items again even if already scored
 *   npm run sources:score -- --sample=<runId>           # CSV of a run's scores to check by hand (the ~50 sample)
 *   npm run sources:score -- --outreach                 # CSV of items still unresolved, by organization
 *   npm run sources:score -- --undo=<runId>             # put back every link a run made
 *   npm run sources:score -- --split=<runId> --doctor=<uuid> --group=src/ext,src/ext [--group=...]
 *
 * Auto-linking is off. It turns on only when SCORER_AUTO_LINK_AT (e.g. 80) is
 * set, after a person has checked a sample (ADR 0012); a cédula conflict is
 * never auto-linked. CSV files go to scripts/sources/.data/scorer/ (not in git).
 */
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { allRows, database } from './lib/db';
import type { FacilityCandidate, NameCandidate } from './lib/match';
import {
    ANSWER_SCHEMA, autoLinkThreshold, buildEvidence, candidateId, mayAutoLink, orderedCandidates, parseAnswer, SCORER_MODEL, SYSTEM_PROMPT, userMessage,
    type Answer, type CandidateFacts, type Kind, type QueueItem,
} from './lib/scorer';
import { DATA_DIR, uuidv7 } from './lib/snapshot';

const OUT_DIR = path.join(DATA_DIR, 'scorer');
const CONCURRENCY = 4;
const DEFAULT_LIMIT = 50;

function arg(name: string): string | true | undefined {
    for (const a of process.argv.slice(2)) {
        if (a === `--${name}`) return true;
        if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
    }
    return undefined;
}
const args = (name: string) => process.argv.slice(2).filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
/** --model=<OpenRouter id> overrides the default; each score records the model that gave it. */
const MODEL = typeof arg('model') === 'string' ? (arg('model') as string) : (process.env.SCORER_MODEL || SCORER_MODEL);

// ── Reading the queue (service role: tables, not the admin RPCs) ─────────────
interface MatchRow { source_slug: string; external_id: string; doctor_id?: string | null; provider_id?: string | null; tier?: number | null; candidates: unknown[] }
interface EntryRow { source_slug: string; external_id: string; name: string; label: string | null; specialties: string[] | null; cedulas: string[] | null; region: string | null; url: string | null }

async function readQueue(db: SupabaseClient, kinds: Kind[], source: string | null): Promise<QueueItem[]> {
    const names = new Map(((await db.from('data_sources').select('slug,name')).data ?? []).map((r) => [r.slug as string, r.name as string]));
    const items: QueueItem[] = [];
    for (const kind of kinds) {
        const table = kind === 'doctor' ? 'doctor_source_ids' : 'facility_source_ids';
        const cols = kind === 'doctor' ? 'source_slug,external_id,doctor_id,tier,candidates' : 'source_slug,external_id,provider_id,tier,candidates';
        const matches = await allRows<MatchRow>((a, b) => {
            let q = db.from(table).select(cols).eq('status', 'probable');
            if (source) q = q.eq('source_slug', source);
            return q.order('source_slug').order('external_id').range(a, b);
        });
        const slugs = [...new Set(matches.map((m) => m.source_slug))];
        const entries = new Map<string, EntryRow>();
        for (const slug of slugs) {
            const rows = await allRows<EntryRow>((a, b) => db.from('source_entries')
                .select('source_slug,external_id,name,label,specialties,cedulas,region,url').eq('source_slug', slug).order('external_id').range(a, b));
            for (const r of rows) entries.set(`${r.source_slug}/${r.external_id}`, r);
        }
        for (const m of matches) {
            const e = entries.get(`${m.source_slug}/${m.external_id}`);
            if (!e) continue;
            items.push({
                kind,
                source_slug: m.source_slug,
                source_name: names.get(m.source_slug) ?? m.source_slug,
                external_id: m.external_id,
                proposed: (kind === 'doctor' ? m.doctor_id : m.provider_id) ?? null,
                tier: m.tier ?? null,
                name: e.name,
                label: e.label,
                specialties: e.specialties ?? [],
                region: e.region,
                cedulaPrinted: (e.cedulas ?? []).length > 0,
                candidates: (m.candidates ?? []) as Array<NameCandidate | FacilityCandidate>,
            });
        }
    }
    return items;
}

/** Organizations each candidate doctor is already confirmed with: evidence beyond the name. */
async function candidateFacts(db: SupabaseClient, items: QueueItem[]): Promise<Map<string, CandidateFacts>> {
    const ids = [...new Set(items.filter((i) => i.kind === 'doctor').flatMap((i) => i.candidates.map((c) => (c as NameCandidate).doctor_id)))].filter(Boolean);
    const out = new Map<string, CandidateFacts>();
    for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db.from('doctor_affiliations').select('doctor_id,organizations(name)')
            .in('doctor_id', ids.slice(i, i + 200)).eq('status', 'confirmed');
        if (error) throw new Error(`doctor_affiliations: ${error.message}`);
        for (const r of (data ?? []) as unknown as Array<{ doctor_id: string; organizations: { name: string } | null }>) {
            const f = out.get(r.doctor_id) ?? { organizations: [] };
            if (r.organizations?.name && !f.organizations.includes(r.organizations.name)) f.organizations.push(r.organizations.name);
            out.set(r.doctor_id, f);
        }
    }
    return out;
}

// ── The model, through OpenRouter (as api/ai-search.ts) ──────────────────────
interface Usage { prompt_tokens?: number; completion_tokens?: number; cost?: number }

export async function ask(evidence: ReturnType<typeof buildEvidence>, model: string = MODEL): Promise<{ text: string; usage: Usage }> {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new Error('OPENROUTER_API_KEY is needed (see .env.example)');
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'MedSociety match scorer' },
        body: JSON.stringify({
            model: model,
            max_tokens: 4000,
            usage: { include: true },
            response_format: { type: 'json_schema', json_schema: { name: 'match_score', strict: true, schema: ANSWER_SCHEMA } },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userMessage(evidence) },
            ],
        }),
        signal: AbortSignal.timeout(180_000),
    });
    const json = await res.json() as { error?: unknown; choices?: Array<{ message?: { content?: string } }>; usage?: Usage };
    if (!res.ok || json.error) throw new Error(`openrouter ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
    return { text: json.choices?.[0]?.message?.content ?? '', usage: json.usage ?? {} };
}

// ── Scoring run ──────────────────────────────────────────────────────────────
async function score() {
    const db = database();
    const kindArg = arg('kind');
    const kinds: Kind[] = kindArg === 'doctor' ? ['doctor'] : kindArg === 'facility' ? ['facility'] : ['doctor', 'facility'];
    const source = typeof arg('source') === 'string' ? (arg('source') as string) : null;
    const limitArg = arg('limit');
    const limit = limitArg === 'all' ? Infinity : typeof limitArg === 'string' ? Number(limitArg) : DEFAULT_LIMIT;
    if (!(limit > 0)) throw new Error('--limit must be a positive number or "all"');
    const threshold = autoLinkThreshold(process.env.SCORER_AUTO_LINK_AT);
    const model = MODEL;

    const tryN = typeof arg('try') === 'string' ? Number(arg('try')) : 0;
    const writes = !arg('dry') && !tryN;
    let items = await readQueue(db, kinds, source);
    if (!arg('rescore') && writes) {
        const done = new Set((await allRows<{ kind: string; source_slug: string; external_id: string }>((a, b) =>
            db.from('match_scores').select('kind,source_slug,external_id').order('id').range(a, b)))
            .map((r) => `${r.kind}/${r.source_slug}/${r.external_id}`));
        items = items.filter((i) => !done.has(`${i.kind}/${i.source_slug}/${i.external_id}`));
    }
    items = items.filter((i) => i.candidates.length > 0).slice(0, tryN || limit);
    const facts = await candidateFacts(db, items);

    if (tryN) {
        console.log(`trying ${items.length} item(s) with ${model}; nothing is written`);
        for (const item of items) {
            const evidence = buildEvidence(item, facts);
            const { text, usage } = await ask(evidence);
            const a = parseAnswer(text, evidence, item);
            const chosen = evidence.candidates[orderedCandidates(item).findIndex((c) => candidateId(c) === a.candidateId)];
            console.log(`  ${item.source_slug} "${item.name}" -> ${chosen ? `${chosen.ref} "${chosen.name}"` : 'none'}: ${a.score} ${a.verdict}. ${a.reason}`);
            console.log(`    tokens in ${usage.prompt_tokens ?? '?'}, out ${usage.completion_tokens ?? '?'}${usage.cost ? `, $${usage.cost.toFixed(4)}` : ''}`);
        }
        return;
    }

    if (arg('dry')) {
        console.log(`${items.length} item(s) would be scored with ${model}${threshold === null ? '' : `; auto-link at ${threshold}`}. First one, exactly as sent:`);
        if (items[0]) console.log(userMessage(buildEvidence(items[0], facts)));
        return;
    }
    if (!items.length) { console.log('nothing to score'); return; }

    const runId = uuidv7();
    const startedAt = new Date().toISOString();
    const { error: runError } = await db.from('source_runs').insert({
        id: runId, source_slug: 'ai-scorer', started_at: startedAt, status: 'red', reasons: ['in progress'],
        counts: { planned: items.length, model: model, autoLinkAt: threshold },
    });
    if (runError) throw new Error(`source_runs: ${runError.message}`);
    console.log(`scorer run ${runId}: ${items.length} item(s) with ${model}, ${threshold === null ? 'shadow mode (links nothing)' : `AUTO-LINK at ${threshold}`}`);

    const counts = { scored: 0, approve: 0, reject: 0, needs_human: 0, failed: 0, linked: 0, promptTokens: 0, completionTokens: 0, cost: 0 };
    const failures: string[] = [];
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const item = items[next++];
            const key = `${item.source_slug}/${item.external_id}`;
            try {
                const evidence = buildEvidence(item, facts);
                const { text, usage } = await ask(evidence);
                counts.promptTokens += usage.prompt_tokens ?? 0;
                counts.completionTokens += usage.completion_tokens ?? 0;
                counts.cost += usage.cost ?? 0;
                const a: Answer = parseAnswer(text, evidence, item);
                const { error } = await db.from('match_scores').insert({
                    run_id: runId, kind: item.kind, source_slug: item.source_slug, external_id: item.external_id,
                    candidate_id: a.candidateId ?? item.proposed ?? (item.candidates[0] as NameCandidate).doctor_id ?? (item.candidates[0] as FacilityCandidate).provider_id,
                    score: a.score, verdict: a.verdict, reason: a.reason, model: model, evidence,
                });
                if (error) throw new Error(`match_scores: ${error.message}`);
                counts.scored++;
                counts[a.verdict]++;
                if (mayAutoLink(item, a, threshold)) {
                    const { data, error: linkError } = await db.rpc('scorer_auto_link', {
                        p_run: runId, p_source: item.source_slug, p_external: item.external_id, p_doctor: a.candidateId, p_score: a.score,
                    });
                    if (linkError) throw new Error(`scorer_auto_link: ${linkError.message}`);
                    if (data === true) counts.linked++;
                }
                if (counts.scored % 10 === 0) console.log(`  ${counts.scored}/${items.length} scored`);
            } catch (err) {
                counts.failed++;
                failures.push(`${key}: ${(err as Error).message}`);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

    const reasons = counts.failed > Math.max(2, items.length * 0.1) ? [`${counts.failed} of ${items.length} items could not be scored`] : [];
    const { error: endError } = await db.from('source_runs').update({
        finished_at: new Date().toISOString(), status: reasons.length ? 'red' : 'green', reasons,
        counts: { ...counts, planned: items.length, model: model, autoLinkAt: threshold },
    }).eq('id', runId);
    if (endError) throw new Error(`source_runs: ${endError.message}`);

    console.log(`  scored ${counts.scored}: approve ${counts.approve}, reject ${counts.reject}, needs a person ${counts.needs_human}; failed ${counts.failed}; linked ${counts.linked}`);
    console.log(`  tokens in ${counts.promptTokens}, out ${counts.completionTokens}${counts.cost ? `, cost $${counts.cost.toFixed(2)}` : ''}`);
    for (const f of failures.slice(0, 10)) console.log(`  failed ${f}`);
    console.log(`  check a sample: npm run sources:score -- --sample=${runId}`);
}

// ── Reading results ──────────────────────────────────────────────────────────
const csv = (rows: Array<Array<string | number | null>>) =>
    rows.map((r) => r.map((v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n') + '\n';

function writeCsv(name: string, rows: Array<Array<string | number | null>>): string {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, '﻿' + csv(rows)); // BOM: Excel reads the accents
    return file;
}

interface ScoreRow { kind: string; source_slug: string; external_id: string; candidate_id: string; score: number; verdict: string; reason: string; evidence: { record: { name: string; label: string | null }; candidates: Array<{ ref: string; name: string }> } }

async function sample(runId: string) {
    const db = database();
    const rows = await allRows<ScoreRow>((a, b) => db.from('match_scores')
        .select('kind,source_slug,external_id,candidate_id,score,verdict,reason,evidence').eq('run_id', runId).order('score', { ascending: false }).range(a, b));
    if (!rows.length) throw new Error(`no scores for run ${runId}`);
    const bands = { '90+': 0, '80-89': 0, '50-79': 0, '<50': 0 };
    for (const r of rows) bands[r.score >= 90 ? '90+' : r.score >= 80 ? '80-89' : r.score >= 50 ? '50-79' : '<50']++;
    const file = writeCsv(`sample-${runId}.csv`, [
        ['kind', 'source', 'external_id', 'record', 'label', 'candidate (first offered)', 'score', 'verdict', 'reason', 'your decision (same / different / unsure)'],
        ...rows.map((r) => [r.kind, r.source_slug, r.external_id, r.evidence.record.name, r.evidence.record.label, r.evidence.candidates[0]?.name ?? null, r.score, r.verdict, r.reason, '']),
    ]);
    console.log(`run ${runId}: ${rows.length} scores; ${Object.entries(bands).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
    console.log(`  approve ${rows.filter((r) => r.verdict === 'approve').length}, reject ${rows.filter((r) => r.verdict === 'reject').length}, needs a person ${rows.filter((r) => r.verdict === 'needs_human').length}`);
    console.log(`  sheet to check by hand: ${file}`);
}

async function outreach() {
    const db = database();
    const items = await readQueue(db, ['doctor', 'facility'], null);
    const latest = new Map<string, ScoreRow & { scored_at: string }>();
    for (const r of await allRows<ScoreRow & { scored_at: string }>((a, b) => db.from('match_scores')
        .select('kind,source_slug,external_id,candidate_id,score,verdict,reason,evidence,scored_at').order('scored_at').range(a, b))) {
        latest.set(`${r.kind}/${r.source_slug}/${r.external_id}`, r);
    }
    const open = items.filter((i) => latest.get(`${i.kind}/${i.source_slug}/${i.external_id}`)?.verdict === 'needs_human');
    const file = writeCsv(`outreach-${new Date().toISOString().slice(0, 10)}.csv`, [
        ['organization source', 'kind', 'name', 'label', 'region', 'score', 'why it is unresolved'],
        ...open.map((i) => { const s = latest.get(`${i.kind}/${i.source_slug}/${i.external_id}`)!; return [i.source_name, i.kind, i.name, i.label, i.region, s.score, s.reason]; }),
    ]);
    const bySource = new Map<string, number>();
    for (const i of open) bySource.set(i.source_name, (bySource.get(i.source_name) ?? 0) + 1);
    console.log(`${open.length} queued item(s) the scorer could not settle, to ask their organization about:`);
    for (const [s, n] of bySource) console.log(`  ${s}: ${n}`);
    console.log(`  list: ${file}`);
}

// ── Undo and split ───────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function undo(runId: string) {
    if (!UUID.test(runId)) throw new Error('--undo needs a run ID');
    const { data, error } = await database().rpc('scorer_undo_run', { p_run: runId });
    if (error) throw new Error(`scorer_undo_run: ${error.message}`);
    console.log(`run ${runId}: ${JSON.stringify(data)} (skipped: links a person has decided on since, or already split)`);
}

async function split(runId: string) {
    const doctor = arg('doctor');
    const groups = args('group').map((g) => g.split(',').map((k) => k.trim()).filter(Boolean));
    if (!UUID.test(runId) || typeof doctor !== 'string' || !UUID.test(doctor) || !groups.length || groups.some((g) => !g.length)) {
        throw new Error('usage: --split=<runId> --doctor=<uuid> --group=source/external_id[,source/external_id] [--group=...]');
    }
    const { data, error } = await database().rpc('scorer_split', { p_run: runId, p_doctor: doctor, p_groups: groups });
    if (error) throw new Error(`scorer_split: ${error.message}`);
    console.log(`doctor ${doctor}: ${groups.length} group(s) moved to new doctor(s) ${(data as string[]).join(', ')}`);
}

async function main() {
    const u = arg('undo'), s = arg('split'), smp = arg('sample');
    if (typeof u === 'string') return undo(u);
    if (typeof s === 'string') return split(s);
    if (typeof smp === 'string') return sample(smp);
    if (arg('outreach')) return outreach();
    return score();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error((err as Error).message);
        process.exit(1);
    });
}

/** For scripts/sources/compare-models.ts: the same queue and evidence the scorer uses. */
export { readQueue as readQueueFor, candidateFacts as candidateFactsFor };
