/**
 * Add, change, remove or restore a badge by hand, from your own machine.
 *
 * You name a listing by its page ID (the UUID in /providers/<id>) or find it by
 * name. The doctor's internal ID is worked out here and never typed or shown.
 * Every change is a run of the `manual` source: a UUIDv7 run ID and a UTC
 * time, with the row before and after kept in the run (service role only), so
 * `undo` can put it back. Nothing is written without --commit.
 *
 *   npm run badges:manual -- find "Grand Care"
 *   npm run badges:manual -- list   --listing=<id>
 *   npm run badges:manual -- add    --listing=<id> --org=starmedica [--label="Star Médica Ciudad Juárez"] [--url=https://…] [--valid-to=2028-01-31] [--note="why"] --commit
 *   npm run badges:manual -- change --listing=<id> --org=starmedica [--label=…] [--new-label=…] [--url=…] [--valid-from=…] [--valid-to=…] --commit
 *   npm run badges:manual -- remove --listing=<id> --org=conacem [--label=…] [--note="why"] --commit
 *   npm run badges:manual -- restore --listing=<id> --org=conacem [--label=…] --commit
 *   npm run badges:manual -- undo   --run=<run ID> --commit
 *
 * Production needs SUPABASE_SERVICE_ROLE_KEY in .env.local (the npm script loads
 * it); SOURCES_DB_URL=http://127.0.0.1:54331 points it at the local sandbox.
 *
 * Rules:
 * - A doctor's badge shows on every listing of that doctor. Regulator and
 *   accreditor badges (COEPRIS, the Padrón) sit on the listing itself.
 *   --on=listing puts any badge on this listing only.
 * - `remove` deletes a badge added by hand. A badge from a source is hidden
 *   instead, so the next run does not bring it back. `restore` shows it again.
 * - `change` only edits badges added by hand: a source's next run would
 *   overwrite anything else. Remove the source badge and add your own instead.
 * - A run never overwrites a badge added by hand.
 */
import { pathToFileURL } from 'url';
import { database, isSandbox } from './lib/db';
import { uuidv7 } from './lib/snapshot';

export type Command = 'find' | 'list' | 'add' | 'change' | 'remove' | 'restore' | 'undo';
export const COMMANDS: Command[] = ['find', 'list', 'add', 'change', 'remove', 'restore', 'undo'];
export type Level = 'doctor' | 'listing';

export interface Args {
    command: Command;
    text?: string;
    listing?: string;
    org?: string;
    label?: string;
    newLabel?: string;
    url?: string;
    validFrom?: string;
    validTo?: string;
    note?: string;
    on?: Level;
    run?: string;
    commit: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: string): boolean {
    if (!DATE.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Same rule as the site: only http and https links reach a badge. */
export function isWebLink(s: string): boolean {
    try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; }
}

/** Parses argv; throws a message a person can act on. */
export function parseArgs(argv: string[]): Args {
    const [command, ...rest] = argv;
    if (!COMMANDS.includes(command as Command)) throw new Error(`first word must be one of: ${COMMANDS.join(', ')}`);
    const a: Args = { command: command as Command, commit: false };
    const free: string[] = [];
    for (const x of rest) {
        if (x === '--commit') { a.commit = true; continue; }
        const m = /^--([a-z-]+)=(.*)$/s.exec(x);
        if (!m) { if (x.startsWith('--')) throw new Error(`unknown option ${x}`); free.push(x); continue; }
        const [, k, v] = m;
        switch (k) {
            case 'listing': a.listing = v.trim(); break;
            case 'org': a.org = v.trim(); break;
            case 'label': a.label = v; break;
            case 'new-label': a.newLabel = v; break;
            case 'url': a.url = v.trim(); break;
            case 'valid-from': a.validFrom = v.trim(); break;
            case 'valid-to': a.validTo = v.trim(); break;
            case 'note': a.note = v; break;
            case 'on': if (v !== 'listing' && v !== 'doctor') throw new Error('--on must be listing or doctor'); a.on = v; break;
            case 'run': a.run = v.trim(); break;
            default: throw new Error(`unknown option --${k}`);
        }
    }
    a.text = free.join(' ').trim() || undefined;

    const needsTarget = ['list', 'add', 'change', 'remove', 'restore'].includes(a.command);
    if (a.command === 'find' && !a.text) throw new Error('find needs a name, for example: find "Grand Care"');
    if (needsTarget && !a.listing) throw new Error(`${a.command} needs --listing=<page ID> (the UUID in /providers/<id>); use find to look it up`);
    if (a.listing && !UUID.test(a.listing)) throw new Error('--listing must be the page ID, a UUID like 3f2b…');
    if (['add', 'change', 'remove', 'restore'].includes(a.command) && !a.org) throw new Error(`${a.command} needs --org=<slug>, for example --org=starmedica`);
    if (a.command === 'undo' && !(a.run && UUID.test(a.run))) throw new Error('undo needs --run=<run ID>');
    for (const [name, v] of [['--valid-from', a.validFrom], ['--valid-to', a.validTo]] as const) if (v !== undefined && !isDate(v)) throw new Error(`${name} must be a real date, YYYY-MM-DD`);
    if (a.validFrom && a.validTo && a.validFrom > a.validTo) throw new Error('--valid-from is after --valid-to');
    if (a.url !== undefined && a.url !== '' && !isWebLink(a.url)) throw new Error('--url must start with http:// or https://');
    if (a.command === 'change' && [a.newLabel, a.url, a.validFrom, a.validTo].every((v) => v === undefined)) throw new Error('change needs at least one of --new-label, --url, --valid-from, --valid-to');
    return a;
}

/** Where a badge lives: on the doctor (every listing of theirs) or on this one listing. */
export function levelFor(orgKind: string, doctorId: string | null, on?: Level): Level {
    if (on === 'listing') return 'listing';
    if (orgKind === 'regulator' || orgKind === 'accreditor') return 'listing';
    if (on === 'doctor' && !doctorId) throw new Error('--on=doctor: this listing has no doctor behind it');
    return doctorId ? 'doctor' : 'listing';
}

export interface Row {
    status: 'confirmed' | 'lapsed' | 'hidden';
    source_slug: string;
    label: string;
    organization_id?: string;
    url?: string | null;
    valid_from?: string | null;
    valid_to?: string | null;
    [k: string]: unknown;
}

/** What `remove` does to a row: delete a badge added by hand, hide one from a source. */
export function removal(row: Row): 'delete' | 'hide' | 'already-hidden' {
    if (row.source_slug === 'manual') return 'delete';
    return row.status === 'hidden' ? 'already-hidden' : 'hide';
}

/** The rows of one organization on a target; a label picks one when there are several. */
export function pick(rows: Row[], label: string | undefined): Row {
    const hits = label === undefined ? rows : rows.filter((r) => r.label === label);
    if (!hits.length) throw new Error(label === undefined ? 'no badge from that organization here' : `no badge with label "${label}" here`);
    if (hits.length > 1) throw new Error(`several badges from that organization here; add --label= with one of: ${hits.map((r) => JSON.stringify(r.label)).join(', ')}`);
    return hits[0];
}

// ── Database ─────────────────────────────────────────────────────────────────
type Db = ReturnType<typeof database>;
interface Org { id: string; slug: string; name: string; kind: string; logo_permission_at: string | null }

const tableOf = (level: Level) => (level === 'doctor' ? 'doctor_affiliations' : 'listing_affiliations');
const keyOf = (level: Level) => (level === 'doctor' ? 'doctor_id' : 'provider_id');

/** Narrow a query to one badge row: target, organization, label. */
function oneRow<Q extends { eq(column: string, value: unknown): Q }>(q: Q, level: Level, targetId: string, orgId: string, label: string): Q {
    return q.eq(keyOf(level), targetId).eq('organization_id', orgId).eq('label', label);
}

async function must<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data as T;
}

async function listingOf(db: Db, id: string) {
    const rows = await must<{ id: string; name: string; region: string | null; badges: unknown[] }[]>(
        db.from('providers').select('id,name,region,badges').eq('id', id).limit(1));
    if (!rows.length) throw new Error(`no listing with page ID ${id}`);
    const doctor = await must<{ doctor_id: string }[]>(db.from('doctor_listings').select('doctor_id').eq('provider_id', id).limit(1));
    return { ...rows[0], doctorId: doctor[0]?.doctor_id ?? null };
}

async function orgsBySlug(db: Db): Promise<Map<string, Org>> {
    const rows = await must<Org[]>(db.from('organizations').select('id,slug,name,kind,logo_permission_at'));
    return new Map(rows.map((o) => [o.slug, o]));
}

async function rowsFor(db: Db, level: Level, targetId: string, orgId?: string): Promise<Row[]> {
    let q = db.from(tableOf(level)).select('*').eq(keyOf(level), targetId);
    if (orgId) q = q.eq('organization_id', orgId);
    return must<Row[]>(q);
}

async function refresh(db: Db, level: Level, targetId: string) {
    const { error } = level === 'doctor'
        ? await db.rpc('refresh_provider_badges', { p_doctors: [targetId] })
        : await db.rpc('refresh_listing_badges', { p_providers: [targetId] });
    if (error) throw new Error(`badges cache: ${error.message}`);
}

/** Every manual change is a run: who-knows-when is answered by its ID and time. */
async function startRun(db: Db, record: Record<string, unknown>, note: string | undefined) {
    const id = uuidv7();
    const now = new Date().toISOString();
    await must(db.from('source_runs').insert({ id, source_slug: 'manual', started_at: now, finished_at: now, status: 'green', reasons: note ? [note] : [], counts: record }).select('id'));
    return { id, now };
}

async function listingsOfDoctor(db: Db, doctorId: string) {
    return must<{ provider_id: string }[]>(db.from('doctor_listings').select('provider_id').eq('doctor_id', doctorId));
}

function show(badges: unknown[]) {
    const list = (badges ?? []) as { org: string; label: string; valid_to: string | null }[];
    return list.length ? list.map((b) => `${b.org}${b.label ? ` (${b.label})` : ''}${b.valid_to ? ` until ${b.valid_to}` : ''}`).join(', ') : 'none';
}

async function main() {
    const a = parseArgs(process.argv.slice(2));
    const db = database();
    const where = isSandbox() ? 'SANDBOX' : 'PRODUCTION';
    const dry = !a.commit;

    if (a.command === 'find') {
        const rows = await must<{ id: string; name: string; region: string | null; city: string | null; badges: unknown[] }[]>(
            db.from('provider_list').select('id,name,region,city,badges').ilike('name', `%${a.text!.replace(/[%_]/g, '')}%`).order('name').limit(20));
        console.log(`${where}: ${rows.length} listing(s) named like "${a.text}"${rows.length === 20 ? ' (first 20)' : ''}`);
        for (const r of rows) console.log(`  ${r.id}  ${r.name}  [${r.region ?? '-'}${r.city ? `, ${r.city}` : ''}]  badges: ${show(r.badges)}`);
        return;
    }

    if (a.command === 'undo') return undo(db, a, where);

    const listing = await listingOf(db, a.listing!);
    const orgs = await orgsBySlug(db);
    console.log(`${where} · ${listing.name} (${listing.id}) · ${listing.doctorId ? 'has a doctor behind it' : 'no doctor behind it'}`);

    if (a.command === 'list') {
        console.log(`  shown now: ${show(listing.badges)}`);
        const bySlug = new Map([...orgs.values()].map((o) => [o.id, o.slug]));
        const all = [
            ...(listing.doctorId ? (await rowsFor(db, 'doctor', listing.doctorId)).map((r) => ({ ...r, on: 'doctor (all their listings)' })) : []),
            ...(await rowsFor(db, 'listing', listing.id)).map((r) => ({ ...r, on: 'this listing' })),
        ];
        for (const r of all) console.log(`  ${bySlug.get(r.organization_id as string)}  label="${r.label}"  ${r.status}  from ${r.source_slug}  on ${r.on}${r.valid_to ? `  until ${r.valid_to}` : ''}`);
        if (!all.length) console.log('  no badge rows');
        return;
    }

    const org = orgs.get(a.org!);
    if (!org) throw new Error(`unknown --org=${a.org}; one of: ${[...orgs.keys()].join(', ')}`);
    const level = levelFor(org.kind, listing.doctorId, a.on);
    const targetId = level === 'doctor' ? listing.doctorId! : listing.id;
    const existing = await rowsFor(db, level, targetId, org.id);
    const reach = level === 'doctor' ? (await listingsOfDoctor(db, targetId)).length : 1;
    const scope = level === 'doctor' ? `the doctor (shows on ${reach} listing${reach === 1 ? '' : 's'})` : 'this listing only';
    const record = (action: string, before: Row | null, after: Record<string, unknown> | null) =>
        ({ action, level, listing: listing.id, organization: org.slug, label: (after ?? before)?.label ?? '', before, after });

    let before: Row | null = null;
    let after: Record<string, unknown> | null = null;
    let write: (runId: string, now: string) => Promise<void>;

    if (a.command === 'add') {
        const label = a.label ?? '';
        const clash = existing.find((r) => r.label === label);
        if (clash) throw new Error(clash.status === 'hidden' ? 'that badge was removed; use restore' : clash.source_slug === 'manual' ? 'that badge exists; use change' : `that badge already comes from ${clash.source_slug}`);
        after = { [keyOf(level)]: targetId, organization_id: org.id, label, status: 'confirmed', source_slug: 'manual', url: a.url || null, valid_from: a.validFrom ?? null, valid_to: a.validTo ?? null, facts: {} };
        console.log(`add ${org.slug}${label ? ` "${label}"` : ''} on ${scope}${org.logo_permission_at ? '' : ' (no logo permission recorded: shows initials)'}`);
        write = async (runId, now) => { await must(db.from(tableOf(level)).insert({ ...after, created_run_id: runId, last_confirmed_run_id: runId, last_confirmed_at: now }).select('label')); };
    } else {
        before = pick(existing, a.label);
        const label0 = before.label;
        const match = <Q extends { eq(column: string, value: unknown): Q }>(q: Q) => oneRow(q, level, targetId, org.id, label0);
        if (a.command === 'change') {
            if (before.source_slug !== 'manual') throw new Error(`this badge comes from ${before.source_slug}; its next run would undo a change. Remove it, then add your own`);
            const patch: Record<string, unknown> = {};
            if (a.newLabel !== undefined) patch.label = a.newLabel;
            if (a.url !== undefined) patch.url = a.url || null;
            if (a.validFrom !== undefined) patch.valid_from = a.validFrom;
            if (a.validTo !== undefined) patch.valid_to = a.validTo;
            const vf = (patch.valid_from ?? before.valid_from) as string | null, vt = (patch.valid_to ?? before.valid_to) as string | null;
            if (vf && vt && vf > vt) throw new Error('valid-from would be after valid-to');
            if (patch.label !== undefined && patch.label !== before.label && existing.some((r) => r.label === patch.label)) throw new Error('another badge from that organization already has that label');
            after = { ...before, ...patch };
            console.log(`change ${org.slug} "${before.label}" on ${scope}: ${JSON.stringify(patch)}`);
            write = async (runId, now) => { await must(match(db.from(tableOf(level)).update({ ...patch, last_confirmed_run_id: runId, last_confirmed_at: now })).select('label')); };
        } else if (a.command === 'remove') {
            const how = removal(before);
            if (how === 'already-hidden') { console.log('already removed; nothing to do'); return; }
            after = how === 'delete' ? null : { ...before, status: 'hidden' };
            console.log(`${how === 'delete' ? 'delete the hand-added' : 'hide the'} ${org.slug} badge "${before.label}" on ${scope}${how === 'hide' ? `; ${before.source_slug} runs will not bring it back` : ''}`);
            write = async () => { await must(how === 'delete' ? match(db.from(tableOf(level)).delete()).select('label') : match(db.from(tableOf(level)).update({ status: 'hidden' })).select('label')); };
        } else {
            if (before.status !== 'hidden') { console.log(`not removed (status ${before.status}); nothing to do`); return; }
            after = { ...before, status: 'confirmed' };
            console.log(`restore ${org.slug} "${before.label}" on ${scope}`);
            write = async () => { await must(match(db.from(tableOf(level)).update({ status: 'confirmed' })).select('label')); };
        }
    }

    if (dry) { console.log('dry run: nothing written; add --commit to write'); return; }
    const { id: runId, now } = await startRun(db, record(a.command, before, after), a.note);
    try {
        await write(runId, now);
    } catch (err) {
        await db.from('source_runs').delete().eq('id', runId);  // nothing points at it yet
        throw err;
    }
    await refresh(db, level, targetId);
    const shown = await listingOf(db, listing.id);
    console.log(`written with run ${runId} at ${now}`);
    console.log(`  shown now: ${show(shown.badges)}`);
    console.log(`  undo with: npm run badges:manual -- undo --run=${runId} --commit`);
}

/** Put a row back as it was before one manual run, if nobody has changed it since. */
async function undo(db: Db, a: Args, where: string) {
    const runs = await must<{ id: string; source_slug: string; counts: ReturnType<typeof Object> }[]>(db.from('source_runs').select('id,source_slug,counts').eq('id', a.run!));
    const run = runs[0];
    if (!run || run.source_slug !== 'manual') throw new Error('no manual run with that ID');
    const r = run.counts as { action: string; level: Level; listing: string; organization: string; before: Row | null; after: (Row & Record<string, unknown>) | null };
    if (r.action === 'undo') throw new Error('that run was itself an undo; undo the run it reversed again instead');
    const level = r.level;
    const key = keyOf(level);
    const ref = (r.after ?? r.before)!;
    const targetId = ref[key] as string;
    const now = (await rowsFor(db, level, targetId, ref.organization_id as string)).find((x) => x.label === ref.label) ?? null;
    const same = (x: Row | null, y: Row | null) => (x === null || y === null ? x === y : x.status === y.status && x.label === y.label && x.url === y.url && x.valid_to === y.valid_to && x.valid_from === y.valid_from);
    if (!same(now, r.after as Row | null)) throw new Error('the badge changed after that run; look at it with list and fix it by hand');
    console.log(`${where} · undo ${r.action} of ${r.organization} on ${level === 'doctor' ? 'the doctor' : 'the listing'} ${r.listing}`);
    if (!a.commit) { console.log('dry run: nothing written; add --commit to write'); return; }
    const { id: runId } = await startRun(db, { action: 'undo', undoes: run.id, level, listing: r.listing, organization: r.organization, before: now, after: r.before }, `undo ${run.id}`);
    const match = <Q extends { eq(column: string, value: unknown): Q }>(q: Q) => oneRow(q, level, targetId, ref.organization_id as string, ref.label);
    if (r.before === null) await must(match(db.from(tableOf(level)).delete()).select('label'));
    else if (now === null) await must(db.from(tableOf(level)).insert(r.before).select('label'));
    else {
        // A change may have renamed the label: put the old row back under its old key.
        await must(match(db.from(tableOf(level)).delete()).select('label'));
        await must(db.from(tableOf(level)).insert(r.before).select('label'));
    }
    await refresh(db, level, targetId);
    console.log(`undone with run ${runId}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(`error: ${err instanceof Error ? err.message : err}`); process.exit(1); });
