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
import { diffIds, runId } from './lib/snapshot';
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
check('run id is file-name safe and sortable', runId(new Date('2026-11-02T18:30:05.123Z')) === '2026-11-02T18-30-05Z');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
