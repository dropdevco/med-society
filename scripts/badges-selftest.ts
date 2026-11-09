/**
 * Checks for how all six organization badges reach a patient: which group each
 * sits in, where its link goes, how a card lays them out, the structured data,
 * the agent API, both languages, and that nothing is left out of the seed or
 * the logo list. Made-up clinic and doctor; no network.
 *
 *   npm run badges:selftest
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { readdirSync } from 'fs';
import { __test } from '../api/agent';
import en from '../src/i18n/locales/en.json';
import es from '../src/i18n/locales/es.json';
import type { Provider, ProviderBadge } from '../src/types/provider';
import { normalizeProvider } from '../src/utils/normalizeProvider';
import { badgeLink, cardRow, GROUPS, groupOf, idOf, monogram } from '../src/utils/orgBadges';
import { providerJsonLd } from '../src/utils/structuredData';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (!ok) failures++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
};

const badge = (org: string, name: string, kind: ProviderBadge['kind'], label: string, url: string | null, info: string, extra: Partial<ProviderBadge> = {}): ProviderBadge => ({
    org, name, kind, label, logo: null, url, info_url: info, confirmed_at: '2026-11-06T00:00:00Z', valid_from: null, valid_to: null, ...extra,
});

const angeles = badge('hospital-angeles', 'Hospital Ángeles', 'hospital', 'Hospital Angeles Tijuana', 'https://hospitalangeles.com/medico/ana-prueba', 'https://hospitalangeles.com');
const star = badge('starmedica', 'Star Médica', 'hospital', 'Star Médica Ciudad Juárez', 'https://www.starmedica.com/s/directorio-medico?doctorId=a8qXX', 'https://www.starmedica.com');
const conacem = badge('conacem', 'CONACEM', 'consejo', 'Pediatría', null, 'https://conacem.org.mx/quienes-somos', { valid_to: '2029-01-01', facts: { consejo: 'Consejo de Prueba', certificate: '9999' } });
const coepris = badge('coepris-bc', 'COEPRIS Baja California', 'regulator', 'REPSSABI', 'https://bajahealthtourism.com/catalogo/casa-prueba', 'https://www.coeprisbc.gob.mx', { valid_to: '2028-09-03', facts: { register: '20260000001' } });
const padron = badge('padron-salud-bc', 'Padrón Estatal de Salud', 'regulator', 'Padrón Estatal de Salud', 'https://bajahealthtourism.com/catalogo/casa-prueba', 'https://bajahealthtourism.com', { facts: { register: '20260000001' } });
const cluster = badge('baja-health-cluster', 'Baja Health Cluster', 'association', 'Recovery centers', 'https://bajahealthcluster.mx/institucion/casa-prueba/', 'https://bajahealthcluster.mx');
const all = [angeles, star, conacem, coepris, padron, cluster];

// ── Each badge's group and link ──────────────────────────────────────────────
const expected: [ProviderBadge, string, 'source' | 'about'][] = [
    [angeles, 'affiliation', 'source'],
    [star, 'affiliation', 'source'],
    [conacem, 'credential', 'about'],
    [coepris, 'facility', 'source'],
    [padron, 'facility', 'source'],
    [cluster, 'affiliation', 'source'],
];
for (const [b, group, kind] of expected) {
    check(`${b.org}: group ${group}`, groupOf(b) === group, groupOf(b));
    check(`${b.org}: link is "${kind}"`, badgeLink(b)?.kind === kind, badgeLink(b));
}
check('Hospital Ángeles links to one doctor', badgeLink(angeles)?.href.includes('/medico/') === true);
check('Star Médica links to one doctor', badgeLink(star)?.href.includes('doctorId=') === true);
check('CONACEM links to what it is, never the empty search', badgeLink(conacem)?.href.endsWith('/quienes-somos') === true && !badgeLink(conacem)?.href.includes('/buscador'));
check('no link at all when nothing is known', badgeLink({ ...cluster, url: null, info_url: null }) === null);
check('every badge has its own key', new Set(all.map(idOf)).size === all.length);

// ── Letters, until a logo may show ───────────────────────────────────────────
check('monograms', [monogram('Hospital Ángeles'), monogram('Star Médica'), monogram('CONACEM'), monogram('Baja Health Cluster')].join() === 'HA,SM,CON,BH');

// ── The card ─────────────────────────────────────────────────────────────────
const doctor = cardRow([angeles, star, conacem]);
check('doctor card: credential first, both hospitals shown', doctor.verified[0] === conacem && doctor.shown.length === 2 && doctor.hidden === 0);
const clinic = cardRow([coepris, padron, cluster]);
check('clinic card: both registers verified, cluster after the separator', clinic.verified.length === 2 && clinic.shown[0] === cluster && clinic.hidden === 0);
const many = cardRow([angeles, star, cluster, conacem]);
check('a third affiliation folds into "+1"', many.shown.length === 2 && many.hidden === 1);
check('groups are listed verified first', GROUPS.join() === 'credential,facility,affiliation');

// ── Reaching the page ────────────────────────────────────────────────────────
const row = { id: '00000000-0000-4000-8000-0000000000c1', name: 'Casa Prueba', specialty: [], country: 'MX', region: 'sandiego-tijuana', badges: all };
const provider = normalizeProvider(row as unknown as Provider);
check('badges survive normalizing, in order', provider.badges?.length === 6 && provider.badges[0].org === 'hospital-angeles');
check('a listing without badges has an empty list', normalizeProvider({ ...row, badges: null } as unknown as Provider).badges?.length === 0);

const ld = providerJsonLd(provider) as { memberOf?: { name: string; url?: string }[]; hasCredential?: { credentialCategory: string; recognizedBy: { name: string } }[] };
const memberNames = (ld.memberOf ?? []).map((m) => m.name);
check('JSON-LD: hospitals and the cluster are memberships', memberNames.length === 3 && memberNames.includes('Recovery centers'), memberNames);
const categories = (ld.hasCredential ?? []).map((c) => c.credentialCategory);
check('JSON-LD: the certification and two registers are credentials', categories.filter((c) => c === 'Board certification').length === 1 && categories.filter((c) => c === 'Health registration').length === 2, categories);

// ── The agent API ────────────────────────────────────────────────────────────
const out = __test.organizationsOf(all);
check('agent: six organizations', out.length === 6);
check('agent: CONACEM has no doctor link, and says what it is', out[2].source_url === null && out[2].organization_url === 'https://conacem.org.mx/quienes-somos', out[2]);
check('agent: a register keeps its expiry and page', out[3].valid_until === '2028-09-03' && out[3].source_url === coepris.url, out[3]);
check('agent: bad data becomes an empty list', __test.organizationsOf(null).length === 0);

// ── Both languages ───────────────────────────────────────────────────────────
for (const key of ['title', 'type', 'consejo', 'certificate', 'register', 'verifiedOn', 'validFrom', 'validTo', 'rechecked', 'source', 'about']) {
    check(`text "${key}" in English and Spanish`, !!(en.badges as Record<string, unknown>)[key] && !!(es.badges as Record<string, unknown>)[key]);
}
for (const g of ['credential', 'affiliation', 'facility'] as const) {
    check(`group "${g}" named in both`, !!en.badges.group[g] && !!es.badges.group[g] && !!en.badges.groups[g] && !!es.badges.groups[g]);
}
check('the "about" link names the organization', en.badges.about.includes('{{name}}') && es.badges.about.includes('{{name}}'));

// ── Nothing left out ─────────────────────────────────────────────────────────
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf-8');
const seeds = read('supabase/migrations/0040_sources_and_badges.sql') + read('supabase/migrations/0041_facility_badges.sql');
const logos = read('supabase/migrations/0042_organization_logos.sql');
const register = read('docs/sources/README.md');
for (const b of all) {
    check(`${b.org}: seeded`, seeds.includes(`('${b.org}', `));
    check(`${b.org}: logo turned on`, logos.includes(`'${b.org}'`));
    const file = new URL(`../public/logos/orgs/${b.org}.png`, import.meta.url);
    check(`${b.org}: logo file exists, because a tile has no fallback`, existsSync(file));
    check(`${b.org}: logo file is small enough for a card`, existsSync(file) && statSync(file).size < 40_000);
    check(`${b.org}: in the permissions register`, register.includes(`\`${b.org}\``));
}

check('logos ship with the site', !read('.gitignore').includes('public/logos/orgs'));

// ── A doctor is never asked for the internal ID ───────────────────────────
{
    const walk = (dir: string): string[] => readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
    const publicCode = walk('src').filter((f) => /\.tsx?$/.test(f) && !f.includes('/admin/') && f !== 'src/lib/adminApi.ts');
    const leaks = publicCode.filter((f) => /doctor_id|doctorId|doctors\.id/.test(read(f)));
    check('no public page or form uses the doctor ID', leaks.length === 0, leaks);
    check('the agent API never sends the doctor ID', !/doctor_id|doctorId/.test(read('api/agent.ts')));
    check('neither language asks for a doctor ID', ![en, es].some((l) => /doctor id|id del doctor|id de doctor|uuid/i.test(JSON.stringify(l))));
}

// ── Migrations ────────────────────────────────────────────────────────────
{
    const files = readdirSync(new URL('../supabase/migrations', import.meta.url)).filter((f) => f.endsWith('.sql'));
    const ours = ['0039_doctor_identity.sql', '0040_sources_and_badges.sql', '0041_facility_badges.sql', '0042_organization_logos.sql'];
    for (const f of ours) {
        check(`${f}: exists and no other file has its number`, files.filter((x) => x.startsWith(f.slice(0, 4))).join() === f);
        check(`${f}: says how to undo it`, /rollback/i.test(read(`supabase/migrations/${f}`)));
    }
    const identity = read('supabase/migrations/0039_doctor_identity.sql');
    const tables = [...identity.matchAll(/^create table public\.(\w+)/gm)].map((m) => m[1]);
    check('identity migration: the five doctor tables', ['doctors', 'doctor_cedulas', 'doctor_source_ids', 'doctor_listings', 'doctor_merges'].every((t) => tables.includes(t)));
    check('identity migration: every table locked down', tables.every((t) => identity.includes(`'${t}'`)));
    check('identity migration: no RPCs', [...identity.matchAll(/^create function public\.(\w+)/gm)].map((m) => m[1]).join() === 'sources_name_norm_trg');
    const all = ours.map((f) => read(`supabase/migrations/${f}`)).join('\n');
    check('no migration brings back the unthrottled cédula lookup', !all.includes('listings_for_cedula'));
    for (const n of ['0005b_borderhealth_match_tighten', '0005c_borderhealth_match_speed', '0005d_borderhealth_match_materialize', '0005e_borderhealth_grants', '0005f_borderhealth_claim_fix', '0005g_borderhealth_hardening', '0015b_forum_trigger_grants', '0017b_forum_recipients_conflict', '0020b_clinic_teams', '0009b_grant_owner_update_socials']) {
        check(`production-only ${n} is in the repo and marked not to re-apply`, files.includes(`${n}.sql`) && read(`supabase/migrations/${n}.sql`).includes('Do not apply it again'));
    }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
