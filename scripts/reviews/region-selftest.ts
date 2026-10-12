/**
 * Region isolation for smart search, checked without network or database.
 *
 *   npx tsx scripts/reviews/region-selftest.ts
 *
 * Covers: request validation (api/ai-search.ts), server cache keys, the
 * triage prompt, migration 0022's SQL (region filter before ranking), and the
 * enrich.ts helpers (--region parsing, seed planning, cost estimate).
 */
import * as fs from 'fs';
import { parseRequest, cacheKey, triagePrompt, isRegionId as apiIsRegionId, rankDoctors } from '../../api/ai-search.ts';
import { REGION_IDS, isRegionId } from '../../src/utils/region.ts';
import { parseRegionArg, planSeed, estimatePhase } from './lib.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  (${detail})`}`);
  if (!ok) failures++;
}

// ── API request validation ───────────────────────────────────────────────────
const good = parseRequest({ query: 'me duele el oído', lang: 'es', region: 'sandiego-tijuana' });
check('valid request accepted', 'region' in good && good.region === 'sandiego-tijuana' && good.lang === 'es');
for (const region of [undefined, null, '', 'tijuana', 'ELPASO-JUAREZ', 'constructor', '__proto__', 'toString', 42, ['elpaso-juarez']]) {
  const r = parseRequest({ query: 'me duele el oído', lang: 'es', region });
  check(`region ${JSON.stringify(region)} rejected`, 'error' in r && r.error === 'bad_region');
}
check('short query still rejected first', (() => { const r = parseRequest({ query: 'a', region: 'elpaso-juarez' }); return 'error' in r && r.error === 'bad_query'; })());
check('non-object body rejected', 'error' in parseRequest('nope'));
check('api accepts every id in src/utils/region.ts', REGION_IDS.every((id) => apiIsRegionId(id) && isRegionId(id)));
check('api rejects inherited object keys', ['constructor', 'toString', '__proto__', 'hasOwnProperty'].every((v) => !apiIsRegionId(v)));

// ── Cache keys ───────────────────────────────────────────────────────────────
const kA = cacheKey('elpaso-juarez', 'es', 'Me duele la cabeza');
const kB = cacheKey('sandiego-tijuana', 'es', 'Me duele la cabeza');
check('server cache key differs per region', kA !== kB, `${kA} vs ${kB}`);
check('server cache key differs per language', cacheKey('elpaso-juarez', 'en', 'x y z') !== cacheKey('elpaso-juarez', 'es', 'x y z'));
check('server cache key is case-insensitive', cacheKey('elpaso-juarez', 'es', 'ABC') === cacheKey('elpaso-juarez', 'es', 'abc'));
const hook = fs.readFileSync('src/hooks/useAiSearch.ts', 'utf-8');
check('client cache key includes region', /`\$\{region\}:\$\{lang\}:/.test(hook));
check('client request body includes region', /JSON\.stringify\(\{\s*query,\s*lang,\s*region\s*\}\)/.test(hook));
check('client effect deps include region', /\[key, query, lang, region\]/.test(hook));

// ── Triage prompt ────────────────────────────────────────────────────────────
const pTj = triagePrompt('es', 'sandiego-tijuana');
const pJz = triagePrompt('en', 'elpaso-juarez');
check('Tijuana prompt names Tijuana and San Diego, not Juárez', pTj.includes('Tijuana') && pTj.includes('San Diego') && !pTj.includes('Juárez'));
check('Juárez prompt names Juárez and El Paso, not Tijuana', pJz.includes('Ciudad Juárez') && pJz.includes('El Paso') && !pJz.includes('Tijuana'));
check('emergency guidance says 911 works on both sides', pTj.includes('911') && /both sides of the border/.test(pTj));

// ── rankDoctors only sees what it is given (region-filtered upstream) ────────
const ranked = rankDoctors([
  { review_id: 'r1', provider_id: 'p1', body: 'b', body_es: null, body_en: null, source_lang: null, rating: 5, symptoms: [], outcome: 'resolved', similarity: 0.5, region: 'elpaso-juarez' },
], 'es');
check('rankDoctors still works with region on candidates', ranked.length === 1 && ranked[0].providerId === 'p1');
const api = fs.readFileSync('api/ai-search.ts', 'utf-8');
check('API passes p_region to match_reviews', /p_region:\s*region/.test(api));
check('API drops candidates from another region', /\.filter\(\(c\) => c\.region === region\)/.test(api));

// ── Migration 0022 ───────────────────────────────────────────────────────────
const sql = fs.readFileSync('supabase/migrations/0022_region_scoped_review_search.sql', 'utf-8')
  .split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').toLowerCase();
const body = sql.slice(sql.indexOf('as $$'), sql.lastIndexOf('$$;'));
const iWhere = body.indexOf('where');
const iRegion = body.indexOf('p.region = p_region');
const iOrder = body.indexOf('order by');
const iLimit = body.indexOf('limit');
check('function joins providers on provider_id', /join public\.providers p on p\.id = e\.provider_id/.test(body));
check('region filter is in WHERE, before ORDER BY and LIMIT', iWhere >= 0 && iRegion > iWhere && iOrder > iRegion && iLimit > iOrder,
  `where@${iWhere} region@${iRegion} order@${iOrder} limit@${iLimit}`);
check('only live listings', /p\.status = 'live'/.test(body.slice(iWhere, iOrder)));
check('no OR in the WHERE clause (nothing can widen the filter)', !/\bor\b/.test(body.slice(iWhere, iOrder)));
check('p_region has no default', /p_region\s+text\s*,/.test(sql) && !/p_region\s+text\s+default/.test(sql));
check('old two-argument signature dropped', sql.includes('drop function if exists public.match_reviews(extensions.vector, int);'));
check('new signature revoked from public/anon/authenticated',
  sql.includes('revoke all on function public.match_reviews(extensions.vector, text, int) from public, anon, authenticated;'));
check('only one create function', (sql.match(/create (or replace )?function/g) ?? []).length === 1);

// ── enrich.ts helpers ────────────────────────────────────────────────────────
check('--region=<id> parsed', parseRegionArg(['tag', '--region=sandiego-tijuana']) === 'sandiego-tijuana');
check('--region <id> parsed', parseRegionArg(['tag', '--region', 'elpaso-juarez']) === 'elpaso-juarez');
check('no --region -> undefined', parseRegionArg(['tag', '--commit']) === undefined);
check('unknown --region throws', (() => { try { parseRegionArg(['--region=tijuana']); return false; } catch { return true; } })());

const regions: Record<string, string> = { pJ: 'elpaso-juarez', pT: 'sandiego-tijuana', pT2: 'sandiego-tijuana' };
const rOf = (id: string | null) => (id ? regions[id] ?? null : null);
const reviews = [
  { review_id: 'new-j', doctoralia_id: 'd1', provider_id: 'pJ', body: 'x' },
  { review_id: 'new-t', doctoralia_id: 'd2', provider_id: 'pT', body: 'x' },
  { review_id: 'new-none', doctoralia_id: 'd3', provider_id: null, body: 'x' },
  { review_id: 'empty', doctoralia_id: 'd3', provider_id: 'pT', body: '  ' },
  { review_id: 'same', doctoralia_id: 'd4', provider_id: 'pT', body: 'x' },
  { review_id: 'moved-t', doctoralia_id: 'd5', provider_id: 'pT2', body: 'x' },
  { review_id: 'linked-j', doctoralia_id: 'd6', provider_id: 'pJ', body: 'x' },
];
const existing = new Map<string, string | null>([['same', 'pT'], ['moved-t', 'pT'], ['linked-j', null]]);
const all = planSeed(reviews, existing, rOf, undefined);
check('seed (all) inserts every new review with text', all.inserts.map((r) => r.review_id).sort().join() === 'new-j,new-none,new-t');
check('seed (all) relinks changed provider_id only', all.relinks.map((r) => r.review_id).sort().join() === 'linked-j,moved-t');
const tj = planSeed(reviews, existing, rOf, 'sandiego-tijuana');
check('seed --region inserts only that region', tj.inserts.map((r) => r.review_id).join() === 'new-t');
check('seed --region relinks only rows touching that region', tj.relinks.map((r) => r.review_id).join() === 'moved-t');
const many = Array.from({ length: 2500 }, (_, i) => ({ review_id: `r${i}`, doctoralia_id: 'd', provider_id: 'pT', body: 'x' }));
check('seed planning handles > 1000 rows', planSeed(many, new Map(), rOf, 'sandiego-tijuana').inserts.length === 2500);

const e = estimatePhase('embed', [350, 350]);
check('estimate: embed tokens = chars / 3.5', e.inputTokens === 200 && e.outputTokens === 0);
const t = estimatePhase('translate', [3500]);
check('estimate: translate caps body at 2000 chars and has output', t.inputTokens === 220 + Math.ceil(2000 / 3.5) + 12 && t.outputTokens > 0);
check('estimate: empty set costs nothing', estimatePhase('tag', []).usd === 0);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
