/**
 * Search parity: does an engine return exactly what the directory page shows?
 *
 * The page's own modules (src/utils) are the specification. This script
 * computes their answer for ~60 sample searches per region and interface
 * language (scripts/search-parity/cases.ts), plus what the page derives once
 * per region (suggestion vocabulary, postal centres, suggestions, home rows),
 * and compares another engine's answers with it: the full ordered result list,
 * totals, the sort applied, facets, map frame and pins.
 * See docs/server-search-plan.md, section 9.
 *
 *   npx tsx --env-file=.env.local scripts/search-parity.ts --fetch
 *       Download both regions' provider_list rows (anon key, keyset pages) into
 *       scripts/.cache/search-parity/ (git-ignored: doctor data never goes in git).
 *       --from=https://<deployment> reads the cached /api/directory slices instead.
 *   npx tsx scripts/search-parity.ts
 *       The page's answers over the downloaded rows; saves them as the baseline.
 *   npx tsx scripts/search-parity.ts --candidate=baseline
 *       Compare against the saved baseline (did a code change move any result?).
 *   npx tsx scripts/search-parity.ts --selftest
 *       Synthetic rows, no network: the reference is deterministic and the
 *       comparison catches a moved result, a changed count and a lost suggestion.
 *
 * Options: --region=<id> (default both), --lang=en|es (default both), --verbose.
 * Exits 1 on any difference.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { REGION_IDS, isRegionId, type RegionId } from '../src/utils/region';
import { answer, prepare, regionAnswer, type Prepared } from './search-parity/reference';
import { casesFor } from './search-parity/cases';
import { compareAnswers, compareRegions, type Difference } from './search-parity/compare';
import type { Answer, Case, Engine, Lang, RegionAnswer } from './search-parity/types';

const DATA_DIR = path.resolve('scripts/.cache/search-parity');
const LANGS: Lang[] = ['en', 'es'];

const args = new Map(process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : 'true'] as const;
}));
const verbose = args.has('verbose');

type Row = Record<string, unknown>;

// ── Rows ─────────────────────────────────────────────────────────────────────

const rowsFile = (region: RegionId) => path.join(DATA_DIR, `rows-${region}.json`);

function datasetHash(rows: readonly Row[]): string {
    const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 16);
}

async function fetchRows(region: RegionId): Promise<Row[]> {
    const from = args.get('from');
    if (from) {
        // PR 28's cached slices: the same rows, from the edge cache.
        const origin = from.replace(/\/$/, '');
        const parts: Row[][] = [];
        for (let part = 0; part < 8; part++) {
            const r = await fetch(`${origin}/api/directory/${region}/${part}`);
            if (!r.ok) throw new Error(`${region} part ${part}: HTTP ${r.status}`);
            parts.push(((await r.json()) as { rows: Row[] }).rows);
        }
        return parts.flat();
    }

    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are needed (run with --env-file=.env.local).');
    // Keyset pages of 500, as the directory route does: far from the 3 s anon timeout.
    const rows: Row[] = [];
    for (let last: string | null = null; ;) {
        const r = await fetch(
            `${url}/rest/v1/provider_list?select=*&region=eq.${region}${last ? `&id=gt.${last}` : ''}&order=id&limit=500`,
            { headers: { apikey: key, authorization: `Bearer ${key}` } },
        );
        if (!r.ok) throw new Error(`${region}: HTTP ${r.status}`);
        const page = (await r.json()) as Row[];
        rows.push(...page);
        if (page.length < 500) break;
        last = String(page[page.length - 1].id);
    }
    return rows;
}

function loadRows(region: RegionId): Row[] {
    const file = rowsFile(region);
    if (!fs.existsSync(file)) {
        throw new Error(`No rows for ${region}. Run: npx tsx --env-file=.env.local scripts/search-parity.ts --fetch`);
    }
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Row[];
}

// ── Engines ──────────────────────────────────────────────────────────────────

/** The page's own modules. Also the reference every candidate is compared with. */
function browserEngine(rowsOf: (region: RegionId) => Row[]): Engine & { prepared(region: RegionId, lang: Lang): Prepared } {
    const cache = new Map<string, Prepared>();
    const prepared = (region: RegionId, lang: Lang) => {
        const key = `${region}:${lang}`;
        let p = cache.get(key);
        if (!p) { p = prepare(rowsOf(region), region, lang); cache.set(key, p); }
        return p;
    };
    return {
        name: 'browser',
        prepared,
        region: async (region, lang) => regionAnswer(prepared(region, lang)),
        search: async (region, lang, c) => answer(prepared(region, lang), c),
    };
}

interface Baseline {
    dataset: string;
    region: RegionAnswer;
    answers: Answer[];
}
const baselineFile = (region: RegionId, lang: Lang) => path.join(DATA_DIR, `baseline-${region}-${lang}.json`);

/** Answers saved by an earlier run over the same rows. */
function baselineEngine(datasetOf: (region: RegionId) => string): Engine {
    const read = (region: RegionId, lang: Lang): Baseline => {
        const file = baselineFile(region, lang);
        if (!fs.existsSync(file)) throw new Error(`No baseline for ${region}/${lang}; run without --candidate first.`);
        const b = JSON.parse(fs.readFileSync(file, 'utf8')) as Baseline;
        if (b.dataset !== datasetOf(region)) {
            throw new Error(`The baseline for ${region} was made from other rows (${b.dataset} vs ${datasetOf(region)}); refetch or rebuild it.`);
        }
        return b;
    };
    return {
        name: 'baseline',
        region: async (region, lang) => read(region, lang).region,
        search: async (region, lang, c) => {
            const hit = read(region, lang).answers.find((a) => a.case === c.name);
            if (!hit) throw new Error(`The baseline has no case "${c.name}"`);
            return hit;
        },
    };
}

// ── Running ──────────────────────────────────────────────────────────────────

interface Tally { cases: number; failed: number }

function report(label: string, diffs: Difference[], tally: Tally) {
    tally.cases++;
    if (diffs.length === 0) {
        if (verbose) console.log(`  ok    ${label}`);
        return;
    }
    tally.failed++;
    console.log(`  FAIL  ${label}`);
    for (const d of diffs) console.log(`          ${d.field}: ${d.detail}`);
}

async function runCompare(reference: ReturnType<typeof browserEngine>, candidate: Engine, regions: RegionId[], langs: Lang[]): Promise<Tally> {
    const tally: Tally = { cases: 0, failed: 0 };
    for (const region of regions) {
        for (const lang of langs) {
            console.log(`\n${region} · ${lang} · ${reference.name} vs ${candidate.name}`);
            report('region summary', compareRegions(await reference.region(region, lang), await candidate.region(region, lang)), tally);
            for (const c of casesFor(region, reference.prepared(region, lang))) {
                const expected = await reference.search(region, lang, c);
                let actual: Answer;
                try {
                    actual = await candidate.search(region, lang, c);
                } catch (err) {
                    report(c.name, [{ field: 'error', detail: String((err as Error).message ?? err) }], tally);
                    continue;
                }
                report(`${c.name} (${expected.total})`, compareAnswers(expected, actual), tally);
            }
        }
    }
    return tally;
}

async function writeBaselines(reference: ReturnType<typeof browserEngine>, regions: RegionId[], langs: Lang[], datasetOf: (r: RegionId) => string) {
    for (const region of regions) {
        for (const lang of langs) {
            const t0 = performance.now();
            const regionAns = await reference.region(region, lang);
            const answers: Answer[] = [];
            for (const c of casesFor(region, reference.prepared(region, lang))) answers.push(await reference.search(region, lang, c));
            const ms = performance.now() - t0;
            const baseline: Baseline = { dataset: datasetOf(region), region: regionAns, answers };
            fs.writeFileSync(baselineFile(region, lang), JSON.stringify(baseline));
            console.log(`\n${region} · ${lang}: ${regionAns.rows} rows, ${answers.length} cases, ${ms.toFixed(0)} ms, dataset ${baseline.dataset}`);
            for (const a of answers) {
                console.log(`  ${String(a.total).padStart(5)}  ${a.sortApplied.padEnd(9)}  ${a.case}`);
            }
        }
    }
    console.log(`\nBaselines saved in ${path.relative(process.cwd(), DATA_DIR)}.`);
}

// ── Self-test: synthetic rows, no network ────────────────────────────────────

function syntheticRows(): Row[] {
    const specialties = ['dentist', 'orthodontist', 'general', 'pediatrics', 'obgyn', 'cardiology', 'mental_health', 'otolaryngology'];
    const first = ['Ana', 'María', 'José', 'Luis', 'Carmen', 'Diego', 'Lucía', 'Pedro'];
    const rows: Row[] = [];
    for (let i = 0; i < 64; i++) {
        const us = i % 5 === 0;
        const spec = [specialties[i % specialties.length], ...(i % 7 === 0 ? specialties.slice(0, 6) : [])];
        rows.push({
            id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
            name: `${i % 3 ? 'Dra.' : 'Dr.'} ${first[i % first.length]} Prueba ${i}`,
            specialty: [...new Set(spec)],
            country: us ? 'US' : 'MX',
            city: us ? 'San Diego' : 'Tijuana',
            region: 'sandiego-tijuana',
            address: us ? 'Main St 1' : `Av. Revolución ${i}, Zona Centro`,
            postalCode: us ? '92101' : ['22000', '22010', '22100'][i % 3],
            lat: (us ? 32.715 : 32.53) + (i % 8) * 0.002,
            lng: (us ? -117.16 : -117.03) + (i % 5) * 0.002,
            rating: i % 4 === 0 ? 0 : 4 + (i % 10) / 10,
            reviewCount: i % 4 === 0 ? 0 : (i * 37) % 400,
            insurances: i % 2 ? ['GNP', 'AXA'] : ['MetLife'],
            languages: i % 3 ? ['es', 'en'] : ['es'],
            licensed: i % 2 === 0,
            promoted: i === 9,
            tier: i === 12 ? 'featured' : 'basic',
            featuredRank: i === 20 ? 1 : null,
            priceFromMxn: i % 3 === 0 ? 300 + i * 20 : null,
            service_names: i % 2 ? ['Limpieza dental', 'Dental cleaning'] : ['Consulta general'],
            imageUrl: i % 2 ? `https://example.com/p/${i}.jpg` : null,
        });
    }
    return rows;
}

async function selftest(): Promise<number> {
    let failures = 0;
    const check = (label: string, ok: boolean) => {
        if (!ok) failures++;
        console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}`);
    };
    const rows = syntheticRows();
    const region: RegionId = 'sandiego-tijuana';
    const a = browserEngine(() => rows);
    const b = browserEngine(() => rows);

    const tally = await runCompare(a, b, [region], LANGS);
    check(`two runs over the same rows agree (${tally.cases} checks)`, tally.failed === 0);

    const prep = a.prepared(region, 'es');
    const cases = casesFor(region, prep);
    const byName = (n: string) => cases.find((c) => c.name === n) as Case;
    const base = answer(prep, byName('q=dentista'));
    check('a text search finds something in the fixture', base.total > 1);

    const swapped = { ...base, ids: [base.ids[1], base.ids[0], ...base.ids.slice(2)] };
    check('two results trading places is caught', compareAnswers(base, swapped).some((d) => d.field === 'ids'));
    const short = { ...base, total: base.total - 1, ids: base.ids.slice(0, -1) };
    check('a missing last result is caught', compareAnswers(base, short).some((d) => d.field === 'total'));
    const facet = { ...base, facets: { ...base.facets, verified: base.facets.verified + 1 } };
    check('a facet count off by one is caught', compareAnswers(base, facet).some((d) => d.field === 'facets.verified'));

    const reg = regionAnswer(prep);
    const lost = { ...reg, suggestions: reg.suggestions.map((s) => ({ ...s, items: s.items.slice(1) })) };
    check('a lost suggestion is caught', compareRegions(reg, lost).some((d) => d.field.startsWith('suggestions')));

    const smart = answer(prep, byName('smart, no answer yet'));
    check('a smart search lists nothing before the AI answers', smart.total === 0);
    const unknown = answer(prep, byName('near=00000 (unknown)'));
    check('an unknown postal code lists nothing', unknown.total === 0 && unknown.centre === null);
    const area = answer(prep, byName('area=downtown'));
    check('a map area search has no frame of its own', area.frame === null);

    console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
    return failures;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
    if (args.has('selftest')) return selftest();

    const regionArg = args.get('region');
    if (regionArg && !isRegionId(regionArg)) throw new Error(`Unknown region ${regionArg}; use one of ${REGION_IDS.join(', ')}`);
    const regions: RegionId[] = regionArg ? [regionArg as RegionId] : [...REGION_IDS];
    const langArg = args.get('lang');
    const langs: Lang[] = langArg === 'en' || langArg === 'es' ? [langArg] : LANGS;

    if (args.has('fetch')) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        for (const region of regions) {
            const t0 = Date.now();
            const rows = await fetchRows(region);
            fs.writeFileSync(rowsFile(region), JSON.stringify(rows));
            console.log(`${region}: ${rows.length} rows in ${Date.now() - t0} ms, dataset ${datasetHash(rows)}`);
        }
        return 0;
    }

    const rowCache = new Map<RegionId, Row[]>();
    const rowsOf = (region: RegionId) => {
        let rows = rowCache.get(region);
        if (!rows) { rows = loadRows(region); rowCache.set(region, rows); }
        return rows;
    };
    const datasetOf = (region: RegionId) => datasetHash(rowsOf(region));
    const reference = browserEngine(rowsOf);

    const candidateName = args.get('candidate');
    if (!candidateName) {
        await writeBaselines(reference, regions, langs, datasetOf);
        return 0;
    }

    const candidates: Record<string, () => Engine> = {
        baseline: () => baselineEngine(datasetOf),
        // Phase 1 adds 'server' (api/agent.ts in-process) and a live deployment URL.
    };
    const make = candidates[candidateName];
    if (!make) throw new Error(`Unknown candidate ${candidateName}; use one of ${Object.keys(candidates).join(', ')}`);

    const tally = await runCompare(reference, make(), regions, langs);
    console.log(`\n${tally.cases - tally.failed} of ${tally.cases} checks agree.`);
    return tally.failed ? 1 : 0;
}

main().then((code) => process.exit(code), (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
