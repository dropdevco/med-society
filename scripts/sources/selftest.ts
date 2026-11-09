/**
 * Checks for the source pipeline's pure parts: the Hospital Ángeles parser,
 * duplicate merging, the run judge and the robots.txt reader. Synthetic
 * fixtures only (no real doctors in a public repo), and no network.
 *
 *   npm run sources:selftest
 */
import { ADAPTERS } from './adapters';
import { cedulasOf, comparableName, groupPeople, heldConfidence, heldForReview, leadOf, type DoctoraliaRow } from './backfill-doctors';
import { buildReport } from './cedula-report';
import { changedIds, extendRegistry } from './doctor-registry';
import { bhNorm, similarity } from './lib/trigram';
import { buildSheet, csvCell, topListings } from './review-sheet';
import { parseDirectory as parseDirectory2 } from './adapters/baja-health-cluster';
import { isRecoveryCenter, parseFeed, validationUrl, type RepssabiRecord } from './adapters/coepris-bc';
import { lookupsFrom, planLookups, surnameQuery, toEntry, type ConacemRecord } from './adapters/conacem';
import { parseDirectory } from './adapters/hospital-angeles';
import { dmyToIso, parseDetail, parseList } from './adapters/padron-salud-bc';
import { doctorUrl, parseCard } from './adapters/starmedica';
import { entryRow } from './lib/load';
import { decide, decideFacility, type NameCandidate } from './lib/match';
import { nameKey, parseName } from './lib/names';
import { judgeRun, mergeEntries, type TargetOutcome } from './lib/judge';
import { isAllowed } from './lib/robots';
import { DEFAULT_SCHEDULE, nextRunAt, previousRunAt, scheduleFromEnv } from './lib/schedule';
import { diffIds, runFileName, uuidv7 } from './lib/snapshot';
import type { SourceEntry, Target } from './lib/types';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

// ── Hospital Ángeles parser ──────────────────────────────────────────────────
const card = (slug: string, name: string, spec: string, pills: string, photo = `${slug}.jpg`) => `
<div class="col-lg-4"><div class="blog-card secondary_blog_card">
  <div class="blog-card-thumb mb-0"><img src="https://hospitalangeles.com/assets/img/medicos/${photo}" alt=""></div>
  <div class="blog-card-content d-flex flex-column">
    <h6 class="my-2">${name}</h6>
    <div class="especialidad fs-12">
      ${spec}       </div>
    <div class="hosp-data"><div class="ms-2 mt-2 hospital-list-container d-flex flex-row">${pills}</div></div>
    <div class="blog-card-link mt-auto mb-0">
      <a onclick="medicoPreFlight(this)" href="https://hospitalangeles.com/medico/${slug}" target="_blank">Ver más</a>
    </div>
  </div></div></div>`;
const pill = (hospital: string, cons: string) => `<div onclick="changeCardData(this);" class="hospital-pill"
  data-dir="Av. Ejemplo 100, Zona Centro, 22000 Tijuana,"
  data-cons="${cons} "
  data-torre="Torre de Consultorios">
  ${hospital}                    </div>`;

const html = `<html><body>
  ${card('ana-prueba-uno', 'Dra. Ana Prueba Uno', 'Artroscopia, Ortopedia y Traumatología', pill('Hospital Angeles Tijuana', '305'))}
  ${card('beto-prueba-dos', 'Dr. Beto Prueba Dos', 'Anestesiología', pill('Hospital Angeles Tijuana', '501'))}
  ${card('ana-prueba-uno', 'Dra. Ana Prueba Uno', 'Artroscopia, Ortopedia y Traumatología', pill('Hospital Angeles Mexicali', '12'))}
  ${card('caro-prueba-tres', 'Lic. Caro Prueba Tres', 'Nutrición', pill('Hospital Angeles Tijuana', '9'), 'directorio-medico.jpg')}
  <div class="blog-card secondary_blog_card"><h6>Promo without a doctor link</h6></div>
</body></html>`;
const target: Target = { key: 'tijuana', label: 'Hospital Angeles Tijuana', url: 'https://hospitalangeles.com/tijuana/directorio-medico', region: 'sandiego-tijuana' };
const rows = parseDirectory(html, target);

check('parses one row per doctor card, skips non-doctor cards', rows.length === 4, rows.length);
const ana = rows[0];
check('slug is the external id', ana.externalId === 'ana-prueba-uno', ana.externalId);
check('title split from name', ana.title === 'Dra.' && ana.name === 'Ana Prueba Uno', [ana.title, ana.name]);
check('specialties split on commas only', JSON.stringify(ana.specialties) === '["Artroscopia","Ortopedia y Traumatología"]', ana.specialties);
check('hospital pill read', ana.sites[0]?.name === 'Hospital Angeles Tijuana' && ana.sites[0]?.office === '305' && ana.sites[0]?.tower === 'Torre de Consultorios', ana.sites[0]);
check('trailing comma trimmed from address', ana.sites[0]?.address === 'Av. Ejemplo 100, Zona Centro, 22000 Tijuana', ana.sites[0]?.address);
check('region comes from the target', ana.region === 'sandiego-tijuana');
check('no cédula from this source', ana.cedulas.length === 0);
check('absolute profile url', ana.url === 'https://hospitalangeles.com/medico/ana-prueba-uno', ana.url);
check('"Dr." title', rows[1].title === 'Dr.' && rows[1].name === 'Beto Prueba Dos', [rows[1].title, rows[1].name]);
check('"Lic." title', rows[3].title === 'Lic.' && rows[3].name === 'Caro Prueba Tres', [rows[3].title, rows[3].name]);
check('real photo kept', ana.photoUrl === 'https://hospitalangeles.com/assets/img/medicos/ana-prueba-uno.jpg', ana.photoUrl);
check('generic "no photo" image dropped', rows[3].photoUrl === null, rows[3].photoUrl);

const merged = mergeEntries(rows);
check('duplicate cards merge by slug', merged.length === 3, merged.length);
check('merge keeps both hospitals', merged[0].sites.map((s) => s.name).join('|') === 'Hospital Angeles Tijuana|Hospital Angeles Mexicali', merged[0].sites);
check('merge does not mutate its input', rows[0].sites.length === 1);

// ── Star Médica card parser ─────────────────────────────────────────────────
const smText = ['Ana Prueba Uno', 'Pediatría/Alergia e Inmunología Clínica', 'Star Médica Ciudad Juárez', 'Consultorio 929', '',
    'Tel.656 000 0000', '', 'Ubicación', 'Star Médica Ciudad Juárez', 'México', 'Formación', '◼︎ Ced. Prof. 1234567 // 76543210 // 0033203', '◼︎ Pediatría'].join('\n');
const sm = parseCard({ id: 'a8qXX00000001ABCAY-28', name: ' Ana  Prueba Uno ', specialty: 'Pediatría/Alergia e Inmunología Clínica', text: smText });
check('Star Médica: Salesforce ID without the render suffix', sm?.externalId === 'a8qXX00000001ABCAY', sm?.externalId);
check('Star Médica: name cleaned, no title printed', sm?.name === 'Ana Prueba Uno' && sm?.title === null, sm?.name);
check('Star Médica: every cédula on the card, leading zeros kept', JSON.stringify(sm?.cedulas) === '["1234567","76543210","0033203"]', sm?.cedulas);
check('Star Médica: phone digits are not mistaken for cédulas', !sm?.cedulas.some((c) => c.startsWith('656')));
check('Star Médica: composite specialty split', JSON.stringify(sm?.specialties) === '["Pediatría","Alergia e Inmunología Clínica"]', sm?.specialties);
check('Star Médica: office and hospital', sm?.sites[0]?.office === '929' && sm?.sites[0]?.name === 'Star Médica Ciudad Juárez', sm?.sites[0]);
check('Star Médica: Juárez region, links to the card of that doctor', sm?.region === 'elpaso-juarez' && sm?.url === doctorUrl('a8qXX00000001ABCAY') && sm.url.endsWith('directorio-medico?doctorId=a8qXX00000001ABCAY'), sm?.url);
check('Star Médica: card without an ID is skipped', parseCard({ id: '', name: 'X', specialty: '', text: '' }) === null);

// ── CONACEM lookups ──────────────────────────────────────────────────────────
check('CONACEM query: two surnames, accents dropped', surnameQuery('Dr. René Ricardo Prueba Núñez') === 'Prueba Nunez', surnameQuery('Dr. René Ricardo Prueba Núñez'));
check('CONACEM query: "de la" surname keeps its last word', surnameQuery('Uno Dos de la Prueba Núñez') === 'Prueba Nunez', surnameQuery('Uno Dos de la Prueba Núñez'));
check('CONACEM query: two-word name searched whole', surnameQuery('Lic. Ana Prueba') === 'Ana Prueba');
check('CONACEM query: one word is not searched', surnameQuery('Prueba') === null);
const rec: ConacemRecord = { id: 900001, titulo: 'Dr.', nombre: 'Uno Dos', paterno: 'de la Prueba', materno: 'Nunez', consejo: 'Consejo Mexicano de Radiología e Imagen, A.C.',
    especialidad: 'Radiología e Imagen', inicio: '2024-01-01', fin: '2029-01-01', numero_certificado: '9999', libro: '1', foja: '70' };
const ce = toEntry(rec, 'elpaso-juarez', 'Prueba Nunez');
check('CONACEM entry: certificate record ID is the external ID', ce.externalId === '900001');
check('CONACEM entry: name split kept', ce.extra?.given === 'Uno Dos' && ce.extra?.paterno === 'de la Prueba' && ce.extra?.materno === 'Nunez' && ce.name === 'Uno Dos de la Prueba Nunez', ce.extra);
check('CONACEM entry: validity and certificate', ce.extra?.validFrom === '2024-01-01' && ce.extra?.validTo === '2029-01-01' && ce.extra?.certificate === '9999');
check('CONACEM entry: no cédula claimed', ce.cedulas.length === 0);
const lk = lookupsFrom([{ entries: [{ name: 'Dr. Uno Prueba Núñez', region: 'elpaso-juarez' }, { name: 'Dos Prueba Nunez', region: 'sandiego-tijuana' }, { name: 'Tres Otra Persona', region: 'sandiego-tijuana' }] }]);
check('CONACEM lookups: one per surname pair, first region kept', lk.size === 2 && lk.get('prueba nunez') === 'elpaso-juarez', [...lk]);

const dayMs = 86_400_000;
const nowMs = Date.parse('2026-11-30T00:00:00Z');
const seen = (q: string, id: string, at: string) => ({ ...toEntry({ ...rec, id: Number(id) }, 'elpaso-juarez', q), observedAt: at });
const wantedQ = new Map<string, 'elpaso-juarez'>([['uno prueba', 'elpaso-juarez'], ['dos prueba', 'elpaso-juarez'], ['tres prueba', 'elpaso-juarez']]);
const recent = new Date(nowMs - 3 * dayMs).toISOString();
const old = new Date(nowMs - 40 * dayMs).toISOString();
const p1 = planLookups(wantedQ, { lookups: { 'uno prueba': recent, 'dos prueba': old }, entries: [seen('uno prueba', '1', recent), seen('dos prueba', '2', old)] }, nowMs);
check('lookups: answered in the last 30 days is skipped', !p1.due.some(([q]) => q === 'uno prueba'), p1.due);
check('lookups: older than 30 days, or never asked, is due', p1.due.map(([q]) => q).sort().join() === 'dos prueba,tres prueba', p1.due);
check('lookups: skipped answers carry their certificates over', p1.carried.length === 1 && p1.carried[0].externalId === '1', p1.carried);
const p2 = planLookups(wantedQ, { entries: [seen('uno prueba', '1', recent)] }, nowMs);
check('lookups: a run from before the log counts its results as answers', p2.due.length === 2 && p2.carried.length === 1, p2.due);
const p3 = planLookups(wantedQ, null, nowMs);
check('lookups: the first run asks everything', p3.due.length === 3 && p3.carried.length === 0);
const p4 = planLookups(new Map([['tres prueba', 'elpaso-juarez']]), { lookups: { 'uno prueba': recent }, entries: [seen('uno prueba', '1', recent)] }, nowMs);
check('lookups: a doctor no longer listed is not carried', p4.carried.length === 0);

// ── Run judge ────────────────────────────────────────────────────────────────
const t = (key: string, count: number, ok = true, error?: string): TargetOutcome => ({ key, url: `https://x/${key}`, ok, count, error });
const e = (id: string, name = 'Someone'): SourceEntry => ({ externalId: id, name, title: null, specialties: [], cedulas: [], sites: [], region: 'elpaso-juarez', url: '', photoUrl: null });
const some = [e('a'), e('b')];

check('first run with rows is green', judgeRun([t('tj', 151), t('cj', 243)], some, null).status === 'green');
check('a failed target is red', judgeRun([t('tj', 0, false, 'blocked: HTTP 403')], some, null).status === 'red');
check('zero rows is red', judgeRun([t('tj', 0)], some, null).status === 'red');
check('drop over 30% is red', judgeRun([t('tj', 100)], some, { tj: 151 }).status === 'red');
check('drop under 30% is green', judgeRun([t('tj', 130)], some, { tj: 151 }).status === 'green');
check('growth is green', judgeRun([t('tj', 200)], some, { tj: 151 }).status === 'green');
check('mostly nameless rows is red', judgeRun([t('tj', 3)], [e('a', ''), e('b', ''), e('c')], null).status === 'red');
check('no targets is red', judgeRun([], [], null).status === 'red');
check('lookup target: a smaller answer is not a drop', judgeRun([{ ...t('lookups', 40), noBaseline: true }], some, { lookups: 400 }).status === 'green');

// ── robots.txt ───────────────────────────────────────────────────────────────
const haRobots = 'User-agent: *\nDisallow: /*?st=*\nSitemap: https://hospitalangeles.com/sitemap.xml\n';
check('HA directory page allowed', isAllowed(haRobots, 'medsocietybot', '/tijuana/directorio-medico'));
check('HA ?st= search disallowed', !isAllowed(haRobots, 'medsocietybot', '/tijuana/directorio-medico?st=abc'));
check('empty robots allows everything', isAllowed('', 'medsocietybot', '/anything'));
check('empty Disallow allows everything', isAllowed('User-agent: *\nDisallow:\n', 'medsocietybot', '/x'));
const aiBan = 'User-agent: *\nAllow: /\n\nUser-agent: ClaudeBot\nUser-agent: MedSocietyBot\nDisallow: /\n';
check('a group naming us beats *', !isAllowed(aiBan, 'medsocietybot', '/directorio'));
check('other agents unaffected by our group', isAllowed(aiBan, 'otherbot', '/directorio'));
check('longest rule wins', isAllowed('User-agent: *\nDisallow: /a\nAllow: /a/b\n', 'medsocietybot', '/a/b/c'));
check('$ anchors the end', !isAllowed('User-agent: *\nDisallow: /*.pdf$\n', 'medsocietybot', '/x.pdf') && isAllowed('User-agent: *\nDisallow: /*.pdf$\n', 'medsocietybot', '/x.pdf.html'));
check('comments ignored', !isAllowed('User-agent: * # all\nDisallow: /private # keep out\n', 'medsocietybot', '/private/x'));

// ── Snapshots ────────────────────────────────────────────────────────────────
const d = diffIds(['a', 'b', 'c'], ['b', 'c', 'd']);
check('diff finds added and removed', d.added.join() === 'd' && d.removed.join() === 'a', d);

// ── Run IDs: every run and every record it produces carries one ─────────────
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const t0 = Date.parse('2026-11-02T18:30:05.123Z');
const id1 = uuidv7(t0);
check('run id is a UUIDv7', UUID7.test(id1), id1);
check('run id encodes its start time', parseInt(id1.replace(/-/g, '').slice(0, 12), 16) === t0, id1);
check('later runs sort after earlier ones', uuidv7(t0) < uuidv7(t0 + 1) && uuidv7(t0 + 1000) < uuidv7(t0 + 60_000));
const many = new Set(Array.from({ length: 10_000 }, () => uuidv7(t0)));
check('10,000 ids in the same millisecond are all unique', many.size === 10_000, many.size);
check('run file name: start time, then run id',
    runFileName({ id: id1, startedAt: '2026-11-02T18:30:05.123Z' }) === `2026-11-02T18-30-05Z_${id1}.json`);
const stamped = mergeEntries([{ ...e('a'), runId: id1, observedAt: '2026-11-02T18:30:07.000Z' }]);
check('merged entries keep their run id and observedAt', stamped[0].runId === id1 && stamped[0].observedAt === '2026-11-02T18:30:07.000Z');

// ── Names ────────────────────────────────────────────────────────────────────
const four = parseName('Dr. René Ricardo Prueba Núñez');
check('names: four words split, title and accents gone', four?.given === 'RENE RICARDO' && four?.surname1 === 'PRUEBA' && four?.surname2 === 'NUNEZ' && !four?.ambiguous, four);
check('names: "de la" stays with its surname', parseName('Uno Dos de la Prueba Núñez')?.surname1 === 'DE LA PRUEBA', parseName('Uno Dos de la Prueba Núñez'));
check('names: three words flagged as ambiguous', parseName('Ana Prueba Uno')?.ambiguous === true);
check('name_key skips particles', nameKey(parseName('Uno Dos de la Prueba Núñez')) === 'UNPR', nameKey(parseName('Uno Dos de la Prueba Núñez')));
check('name_key needs a surname', nameKey(parseName('Prueba')) === null);

// ── Match decision ───────────────────────────────────────────────────────────
const cand = (doctor_id: string, similarity: number, regions = ['elpaso-juarez']): NameCandidate => ({ doctor_id, display_name: doctor_id, similarity, regions, listings: [], specialties: [] });
const region = 'elpaso-juarez';
const m1 = decide({ cedulaDoctors: ['d1', 'd1'], candidates: [cand('d1', 0.9)], region });
check('tier 1: a held cédula with a similar name is confirmed', m1.status === 'confirmed' && m1.tier === 1 && m1.doctorId === 'd1', m1);
const m2 = decide({ cedulaDoctors: ['d1'], candidates: [], region });
check('tier 1: a cédula on a very different name goes to review', m2.status === 'probable' && m2.tier === 1 && m2.confidence === 0.8, m2);
const m3 = decide({ cedulaDoctors: ['d1', 'd2'], candidates: [], region });
check('tier 1: cédulas on two doctors go to review', m3.status === 'probable', m3);
const m4 = decide({ cedulaDoctors: [], candidates: [cand('d1', 1)], region });
check('tier 3: an exact name alone is never confirmed', m4.status === 'probable' && m4.tier === 3 && m4.confidence === 1, m4);
const m5 = decide({ cedulaDoctors: [], candidates: [cand('far', 0.95, ['sandiego-tijuana']), cand('near', 0.9)], region });
check('tier 3: a same-region candidate outranks one elsewhere', m5.doctorId === 'near', m5);
const m6 = decide({ cedulaDoctors: [], candidates: [], region });
check('tier 4: nothing similar is unmatched', m6.status === 'unmatched' && m6.doctorId === null, m6);

// ── Doctor backfill and rows ─────────────────────────────────────────────────
const dr = (id: string, cedulas: string[] | null, provider: string | null = null): DoctoraliaRow => ({ doctoralia_id: id, name: id, cedulas, provider_id: provider });
check('backfill: malformed cédulas dropped, digits cleaned', cedulasOf(dr('a', ['123 4567', 'abc', '12'])).join() === '1234567');
const people = groupPeople([dr('a', ['1111111', '2222222']), dr('b', ['2222222', '3333333']), dr('c', ['3333333']), dr('d', ['4444444']), dr('e', null), dr('f', [])]);
check('backfill: a shared cédula joins records, even through a chain', people.some((g) => g.map((r) => r.doctoralia_id).sort().join() === 'a,b,c'), people.map((g) => g.map((r) => r.doctoralia_id)));
check('backfill: records without cédulas stay separate people', people.length === 4, people.length);
const obs = { externalId: '1', name: 'X', title: null, specialties: ['Radiología e Imagen'], cedulas: [], sites: [], region: 'elpaso-juarez' as const, url: 'u', photoUrl: null, runId: 'r', observedAt: 't',
    extra: { consejo: 'Consejo de Prueba', certificate: '9999', validFrom: '2024-01-01', validTo: '2029-01-01', query: 'x' } };
const row = entryRow(obs, 'conacem');
check('entry row: a certification badge is labelled by its specialty', row.label === 'Radiología e Imagen' && row.valid_to === '2029-01-01', row);
check('entry row: only public facts kept for the badge', JSON.stringify(row.facts) === '{"consejo":"Consejo de Prueba","certificate":"9999"}', row.facts);
const hosp = entryRow({ ...obs, extra: undefined, specialties: ['Urología'], sites: [{ name: 'Star Médica Ciudad Juárez', address: null, tower: null, office: '1' }] }, 'starmedica');
check('entry row: a hospital badge is labelled by its site', hosp.label === 'Star Médica Ciudad Juárez' && hosp.valid_to === null, hosp);

// ── Weekly timer ─────────────────────────────────────────────────────────────
// Mexico City has no daylight saving since 2022: 06:00 there is always 12:00 UTC.
const iso = (ms: number) => new Date(ms).toISOString();
const S = DEFAULT_SCHEDULE;
check('Sunday → next day, Monday 06:00 CDMX', iso(nextRunAt(Date.parse('2026-11-01T18:00:00Z'), S)) === '2026-11-02T12:00:00.000Z', iso(nextRunAt(Date.parse('2026-11-01T18:00:00Z'), S)));
check('Monday 05:59 CDMX → same morning', iso(nextRunAt(Date.parse('2026-11-02T11:59:00Z'), S)) === '2026-11-02T12:00:00.000Z');
check('Monday 06:00 exactly → the following week', iso(nextRunAt(Date.parse('2026-11-02T12:00:00Z'), S)) === '2026-11-09T12:00:00.000Z');
check('Monday evening → next Monday', iso(nextRunAt(Date.parse('2026-11-03T01:00:00Z'), S)) === '2026-11-09T12:00:00.000Z');
check('Sunday 11pm CDMX is already Monday in UTC, still → Monday', iso(nextRunAt(Date.parse('2026-11-09T05:00:00Z'), S)) === '2026-11-09T12:00:00.000Z');
check('previous slot from Wednesday is Monday', iso(previousRunAt(Date.parse('2026-11-04T15:00:00Z'), S)) === '2026-11-02T12:00:00.000Z');
// Tijuana keeps US daylight saving: 06:00 is 13:00 UTC in July, 14:00 UTC in November.
const TJ = { day: 1, time: '06:00', timeZone: 'America/Tijuana' };
check('Tijuana summer (PDT, UTC−7)', iso(nextRunAt(Date.parse('2026-07-05T00:00:00Z'), TJ)) === '2026-07-06T13:00:00.000Z', iso(nextRunAt(Date.parse('2026-07-05T00:00:00Z'), TJ)));
check('Tijuana winter (PST, UTC−8)', iso(nextRunAt(Date.parse('2026-11-08T00:00:00Z'), TJ)) === '2026-11-09T14:00:00.000Z', iso(nextRunAt(Date.parse('2026-11-08T00:00:00Z'), TJ)));
check('env: day name and time', JSON.stringify(scheduleFromEnv({ SOURCES_RUN_DAY: 'wed', SOURCES_RUN_TIME: '22:30', SOURCES_TZ: 'America/Chihuahua' }))
    === JSON.stringify({ day: 3, time: '22:30', timeZone: 'America/Chihuahua' }));
let threw = 0;
for (const bad of [{ SOURCES_RUN_DAY: 'funday' }, { SOURCES_RUN_TIME: '6am' }, { SOURCES_TZ: 'Mars/Olympus' }]) {
    try { scheduleFromEnv(bad); } catch { threw++; }
}
check('env: nonsense day, time or zone is refused', threw === 3, threw);

// ── Recovery centers: COEPRIS, the Padrón, the Baja Health Cluster ───────────
const reg = (over: Partial<RepssabiRecord>): RepssabiRecord => ({ Fecha: '01/02/2026', NumRegistro: '20260000001', NoExpediente: 'E-1', RazonSocial: ' Casa  Prueba Recovery ', Municipio: 'Tijuana',
    Direccion: 'Av. Ejemplo 100, Tijuana', Clasificacion: '623111 Residencia con cuidados de enfermeria (centros de recuperacion)', Emision: '03/09/2026', Vigencia: '03/09/2028', Estatus: 'ACTIVO', ...over });
const feed = JSON.stringify({ mensaje: 'ok', datos: [reg({}), reg({ NumRegistro: '2', Municipio: 'Mexicali' }), reg({ NumRegistro: '3', Clasificacion: '621211 Consultorios dentales' }), reg({ NumRegistro: '4', Estatus: 'INACTIVO' }), reg({ NumRegistro: 5, Municipio: 'Playas de Rosarito' })] });
const cof = parseFeed(feed, new Map([['20260000001', 'https://bajahealthtourism.com/catalogo/casa-prueba']]));
check('COEPRIS: recovery class, our area, active only', cof.map((e) => e.externalId).join() === '20260000001,5', cof.map((e) => e.externalId));
check('COEPRIS: name cleaned, register kept as text', cof[0].name === 'Casa Prueba Recovery' && cof[1].extra?.register === '5');
check('COEPRIS: dates turned from day first to ISO', cof[0].extra?.validFrom === '2026-09-03' && cof[0].extra?.validTo === '2028-09-03', cof[0].extra);
check('COEPRIS: links to the state page where one exists', cof[0].url === 'https://bajahealthtourism.com/catalogo/casa-prueba');
check('COEPRIS: otherwise to its own validation page', cof[1].url.startsWith('https://www.coeprisbc.gob.mx/repssabi_validacion.php?') && cof[1].url.includes('numregistro=5'), cof[1].url);
check('COEPRIS: no phone kept', !JSON.stringify(cof[0]).includes('Telefono'));
check('COEPRIS: validation link is built from the record', validationUrl(reg({})).includes('vigencia=03%2F09%2F2028'));
check('COEPRIS: a recovery class outside our area is out', !isRecoveryCenter(reg({ Municipio: 'Ensenada' })));
let badFeed = false;
try { parseFeed('{"mensaje":"error"}', new Map()); } catch { badFeed = true; }
check('COEPRIS: a changed feed fails loudly instead of reading as empty', badFeed);

check('dates: a bad date is dropped, not guessed', dmyToIso('2028-09-03') === null && dmyToIso('') === null && dmyToIso('03/09/2028') === '2028-09-03');
const padronList = '<a href="https://bajahealthtourism.com/catalogo/casa-prueba-1">Perfil</a><a href="https://bajahealthtourism.com/catalogo/casa-prueba-1">x</a><a href="https://bajahealthtourism.com/catalogo?tipo=hotels">y</a><a href="https://bajahealthtourism.com/catalogo/otra">z</a>';
check('Padrón: one slug per record, filters ignored', parseList(padronList).join() === 'casa-prueba-1,otra', parseList(padronList));
const padronPage = (status: string, loc = 'Av. Ejemplo 100, Tijuana') => `<h1 class="dp-name"> Casa Prueba Recovery </h1><p class="dp-loc"><i></i><span>${loc}</span></p>
    <div class="min-w-0"><p class="font-bold">Repssabi <span>${status}</span></p><p class="text-xs">No. 20260000001</p><p class="text-xs">Vigencia: 03/09/2028</p></div>`;
const pe = parseDetail(padronPage('Vigente'), 'casa-prueba-1');
check('Padrón: name, address, page', pe?.name === 'Casa Prueba Recovery' && pe?.sites[0]?.address === 'Av. Ejemplo 100, Tijuana' && pe?.url === 'https://bajahealthtourism.com/catalogo/casa-prueba-1', pe);
check('Padrón: register number and expiry while current', pe?.extra?.register === '20260000001' && pe?.extra?.validTo === '2028-09-03', pe?.extra);
check('Padrón: no expiry claimed when not current', parseDetail(padronPage('Vencido'), 'x')?.extra?.validTo === null && parseDetail(padronPage('No vigente'), 'x')?.extra?.validTo === null);
check('Padrón: a record outside our regions is out', parseDetail(padronPage('Vigente', 'Calle 1, Mexicali'), 'x') === null);
check('Padrón: a page with no name is out', parseDetail('<p>nada</p>', 'x') === null);
const none = parseDetail('<h1 class="dp-name">Sin Registro</h1>', 'y');
check('Padrón: a center without REPSSABI keeps no number', none?.extra?.register === null && none?.extra?.validTo === null, none?.extra);

const clusterTarget: Target = { key: 'recovery-centers', label: 'x', url: 'https://bajahealthcluster.mx/general-directory/recovery-centers/', region: 'sandiego-tijuana' };
const clusterCard = (slug: string, name: string) => `<div class="card"><div class="img"><a href="https://bajahealthcluster.mx/institucion/${slug}/"><img src="a.jpg"></a></div><h3 class="t">${name}</h3><div><a href="https://bajahealthcluster.mx/institucion/${slug}/">More Information</a></div></div>`;
const ch = parseDirectory2(`<section>${clusterCard('casa-prueba-2', 'Casa &amp; Prueba Recovery')}${clusterCard('otra-casa', 'Otra Casa')}</section>`, clusterTarget);
check('Cluster: one entry per center, each with its own name', ch.map((e) => e.name).join() === 'Casa & Prueba Recovery,Otra Casa', ch.map((e) => e.name));
check('Cluster: links to the center page', ch[0].url === 'https://bajahealthcluster.mx/institucion/casa-prueba-2/' && ch[0].externalId === 'casa-prueba-2');

const place = { provider_id: 'p1', name: 'Casa Prueba', similarity: 1, region: 'sandiego-tijuana' };
check('facility match: a register number we hold confirms', decideFacility({ registerListing: 'p9', candidates: [place] }).status === 'confirmed' && decideFacility({ registerListing: 'p9', candidates: [place] }).providerId === 'p9');
check('facility match: an exact name alone waits for a person', decideFacility({ registerListing: null, candidates: [place] }).status === 'probable');
check('facility match: best name first', decideFacility({ registerListing: null, candidates: [{ ...place, provider_id: 'low', similarity: 0.6 }, place] }).providerId === 'p1');
check('facility match: nothing similar is unmatched', decideFacility({ registerListing: null, candidates: [] }).status === 'unmatched');

// ── Every source, as the badge will read ─────────────────────────────────────
const run = { runId: 'r', observedAt: 't' };
const badgeRows = {
    angeles: entryRow({ externalId: 'x', name: 'Ana', title: null, specialties: ['Pediatría'], cedulas: [], sites: [{ name: 'Hospital Angeles Tijuana', address: null, tower: null, office: null }], region: 'sandiego-tijuana', url: 'https://hospitalangeles.com/medico/x', photoUrl: null, ...run }, 'hospital-angeles'),
    star: entryRow({ ...sm!, ...run }, 'starmedica'),
    conacem: entryRow({ ...ce, ...run }, 'conacem'),
    coepris: entryRow({ ...cof[0], ...run }, 'coepris-bc'),
    padron: entryRow({ ...pe!, ...run }, 'padron-salud-bc'),
    cluster: entryRow({ ...ch[0], ...run }, 'baja-health-cluster'),
};
check('label: Hospital Ángeles shows the hospital', badgeRows.angeles.label === 'Hospital Angeles Tijuana', badgeRows.angeles.label);
check('label: Star Médica shows the hospital', badgeRows.star.label === 'Star Médica Ciudad Juárez', badgeRows.star.label);
check('label: CONACEM shows the specialty, with the certificate', badgeRows.conacem.label === 'Radiología e Imagen' && badgeRows.conacem.facts.certificate === '9999' && badgeRows.conacem.valid_to === '2029-01-01', badgeRows.conacem);
check('label: COEPRIS shows the register and number', badgeRows.coepris.label === 'REPSSABI' && badgeRows.coepris.facts.register === '20260000001' && badgeRows.coepris.valid_to === '2028-09-03', badgeRows.coepris);
check('label: the Padrón keeps the number that ties it to COEPRIS', badgeRows.padron.label === 'Padrón Estatal de Salud' && badgeRows.padron.facts.register === '20260000001', badgeRows.padron);
check('label: the cluster says what list it is', badgeRows.cluster.label === 'Recovery centers' && badgeRows.cluster.valid_to === null, badgeRows.cluster);

const slugs = Object.keys(ADAPTERS);
check('all six sources run', slugs.length === 6 && ['hospital-angeles', 'starmedica', 'conacem', 'coepris-bc', 'padron-salud-bc', 'baja-health-cluster'].every((s) => slugs.includes(s)), slugs);
check('facilities are marked, doctors are not', slugs.filter((s) => ADAPTERS[s].entity === 'facility').length === 3);
check('COEPRIS loads before the sources that match on its numbers', slugs.indexOf('coepris-bc') < slugs.indexOf('padron-salud-bc'));
check('no source runs without open access or a recorded letter', Object.values(ADAPTERS).every((a) => a.access === 'open' || !!a.permission));

// ── Doctor identity (made-up doctors) ─────────────────────────────────────
const person = (id: string, name: string, cedulas: string[] | null, provider: string | null = null): DoctoraliaRow => ({ doctoralia_id: id, name, cedulas, provider_id: provider });

check('names compare without title, accents, case or word order', comparableName('Dra. María  LÓPEZ Ruiz') === comparableName('Ruiz Lopez Maria'));
check('a different surname is a different name', comparableName('Ana Lopez Ruiz') !== comparableName('Ana Lopez Soto'));
check('a shortened name counts as a different name, so it is reviewed', comparableName('Ana Lopez') !== comparableName('Ana Lopez Ruiz'));

{
    // {A,B} and {B,C}: the case that broke "one doctor per distinct set".
    const chained = groupPeople([person('1', 'Ana Lopez', ['1111111', '2222222']), person('2', 'Ana Lopez', ['2222222', '3333333']), person('3', 'Ana Lopez', ['3333333'])]);
    check('records chained through a shared cédula are one person', chained.length === 1 && chained[0].length === 3);
    const apart = groupPeople([person('1', 'Ana', ['1111111']), person('2', 'Ana', ['2222222']), person('3', 'Ana', []), person('4', 'Ana', null)]);
    check('no shared cédula means separate people, even with one name', apart.length === 4);

    const mixed = groupPeople([person('1', 'Dra. Ana Lopez Ruiz', ['1111111'], 'p1'), person('2', 'ANA LÓPEZ RUIZ', ['1111111'], 'p2'), person('3', 'Pedro Soto Vega', ['1111111'], 'p3')])[0];
    const held = heldForReview(mixed);
    check('a same-name duplicate is not held', !held.some((r) => r.doctoralia_id === '2'));
    check('a different name sharing a cédula is held', held.length === 1 && held[0].doctoralia_id === '3');
    check('the lead is a record with a cédula', cedulasOf(leadOf([person('1', 'A B', []), person('2', 'C D', ['1111111'])])).length === 1);
    check('a blank name agrees with nothing', heldForReview([person('1', 'Dr.', ['1111111']), person('2', 'Dra.', ['1111111'])]).length === 1);
    check('one record alone is never held', heldForReview([person('1', 'Ana Lopez', ['1111111'])]).length === 0);
    check('reordered names stay under the exact-match bulk confirm', heldConfidence('Ana Lopez Ruiz', 'Ruiz Lopez Ana') < 0.99);
}

check('cédulas: spaces and dashes removed, repeats collapsed', cedulasOf(person('1', 'A', ['123-4567', '1234567'])).join() === '1234567');
check('cédulas: 5 and 10 digit values are dropped (phones and partials)', cedulasOf(person('1', 'A', ['12345', '6561234567', 'abc', ''])).length === 0);
check('cédulas: a missing list is empty', cedulasOf(person('1', 'A', null)).length === 0);

check('bh_norm: production value for a titled name', bhNorm('Dra. María de la Luz Ñáñez') === 'maria luz nanez');
check('bh_norm: empty input', bhNorm(null) === '' && bhNorm('Dr. De La') === '');
check('similarity: identical', similarity('maria lopez', 'maria lopez') === 1);
check('similarity: nothing in common', similarity('abc', 'xyz') === 0);
check('similarity: empty input', similarity('', 'maria') === 0);
check('similarity: matches pg_trgm on a known pair', Math.abs(similarity('maria lopez', 'maria lopes') - 10 / 14) < 0.001);

{
    let n = 0;
    const makeId = () => `id-${++n}`;
    const run = (id: string, ids: string[], status: 'green' | 'red' = 'green') => ({ id, startedAt: '2026-11-01T00:00:00.000Z', status, entries: ids.map((externalId) => ({ externalId })) as never });
    const first = extendRegistry({}, [run('r2', ['b', 'c']), run('r1', ['a', 'b'])], makeId);
    check('registry: one ID per record, duplicates across runs merged', Object.keys(first.registry).length === 3 && first.added === 3);
    check('registry: firstRunId is the oldest run', first.registry.b.firstRunId === 'r1');
    const again = extendRegistry(first.registry, [run('r1', ['a', 'b']), run('r2', ['b', 'c'])], makeId);
    check('registry: reading the same runs again changes nothing', again.added === 0 && changedIds(first.registry, again.registry).length === 0);
    const more = extendRegistry(first.registry, [run('r3', ['d'])], makeId);
    check('registry: a new record gets a new ID, old ones stay', more.added === 1 && changedIds(first.registry, more.registry).length === 0);
    check('registry: a red run adds nothing', extendRegistry({}, [run('r9', ['z'], 'red')], makeId).added === 0);
    check('registry: a changed ID is detected', changedIds({ a: { doctorId: '1', firstRunId: 'r', createdAt: '' } }, { a: { doctorId: '2', firstRunId: 'r', createdAt: '' } }).length === 1);
    check('registry: a lost ID is detected', changedIds({ a: { doctorId: '1', firstRunId: 'r', createdAt: '' } }, {}).length === 1);
}

{
    const listings = [
        { id: '1', name: 'Dra. Maria Lopez Ruiz', region: 'elpaso-juarez' },
        { id: '2', name: 'Maria Lopez Soto', region: 'elpaso-juarez' },
        { id: '3', name: 'Dra. Maria Lopez Ruiz', region: 'sandiego-tijuana' },
        { id: '4', name: 'Pedro Vega', region: 'elpaso-juarez' },
    ];
    const top = topListings('Maria Lopez Ruiz', 'elpaso-juarez', listings);
    check('sheet: closest listing first', top[0]?.id === '1' && top[0].similarity === 1);
    check('sheet: another region is left out', !top.some((c) => c.id === '3'));
    check('sheet: unrelated names are left out', !top.some((c) => c.id === '4'));
    check('sheet: never more than five', topListings('Ana', null, Array.from({ length: 9 }, (_, i) => ({ id: String(i), name: 'Ana', region: null }))).length === 5);
    check('sheet: no candidates is an empty list', topListings('Zacarias', 'x', []).length === 0);
    check('csv: commas and quotes are escaped', csvCell('a,"b"') === '"a,""b"""');
    check('csv: a formula cannot run in Excel', csvCell('=HYPERLINK("x")').startsWith("\"'=") || csvCell('=1').startsWith("'="));
    const sheet = buildSheet({ id: 'run-1', startedAt: '2026-11-01T00:00:00.000Z', entries: [{ externalId: 'x', name: 'Maria Lopez Ruiz', specialties: ['A', 'B'], region: 'elpaso-juarez', url: 'u' }] as never }, listings);
    const [head, row] = sheet.replace('\ufeff', '').trim().split('\n');
    check('sheet: every row carries the run ID and a UTC time', row.startsWith('run-1,2026-11-01T00:00:00.000Z,'));
    check('sheet: has a decision column, and rows line up with it', head.includes('decision') && head.split(',').length === row.split(',').length);
    check('sheet: no contact columns', !/phone|email|website/i.test(head));
}

{
    const rows = [person('1', 'Ana Lopez', ['1111111']), person('2', 'Ana Lopez', ['1111111']), person('3', 'Pedro Vega', ['2222222']), person('4', 'Luis Mora', ['2222222', '12345']), person('5', 'Sin Cedula', [])];
    const r = buildReport(rows, new Set(['1111111']));
    check('report: counts records and cédula holders', r.records === 5 && r.withCedula === 4);
    check('report: counts invalid values', r.droppedAsInvalid === 1);
    check('report: counts shared cédulas', r.sharedCedulas === 2);
    check('report: counts people with several names', r.multiRecordPeople === 2 && r.multiNamePeople === 1 && r.recordsHeldForReview === 1);
    check('report: counts values that are phones', r.matchingPhones === 1);
    check('report: phones unavailable is not zero', buildReport(rows, null).matchingPhones === null);
    check('report: prints totals only', Object.values(r).every((v) => typeof v === 'number'));
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
