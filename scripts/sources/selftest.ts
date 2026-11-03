/**
 * Checks for the source pipeline's pure parts: the Hospital Ángeles parser,
 * duplicate merging, the run judge and the robots.txt reader. Synthetic
 * fixtures only (no real doctors in a public repo), and no network.
 *
 *   npm run sources:selftest
 */
import { parseDirectory } from './adapters/hospital-angeles';
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

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
