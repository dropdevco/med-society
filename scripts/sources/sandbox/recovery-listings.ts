/**
 * Sandbox test build only: creates a listing for each recovery center in the last
 * good COEPRIS run, because MedSociety has none yet and a badge needs a listing.
 * In production these come from the catalog (docs/adr/0008). Run it, then load the
 * sources again so the matcher finds them.
 *   SOURCES_DB_URL=http://127.0.0.1:54331 npx tsx scripts/sources/sandbox/recovery-listings.ts
 */
import { database, isSandbox } from '../lib/db';
import { lastGoodRun } from '../lib/snapshot';

if (!isSandbox()) throw new Error('SOURCES_DB_URL must point at the sandbox');
const run = lastGoodRun('coepris-bc');
if (!run) throw new Error('no good COEPRIS run yet');

/** On the register, but elder care rather than post-operative recovery. */
const NOT_POST_OP = /assisted living/i;

const db = database();
const { data: existing, error } = await db.from('providers').select('name').eq('source', 'manual').eq('region', 'sandiego-tijuana');
if (error) throw new Error(error.message);
const have = new Set((existing ?? []).map((p) => p.name));

const rows = run.entries
    .filter((e) => !NOT_POST_OP.test(e.name) && !have.has(e.name))
    .map((e) => ({ name: e.name, address: e.sites[0]?.address ?? null, city: 'Tijuana', country: 'MX', region: e.region, specialty: [], source: 'manual', status: 'live' }));
if (rows.length) {
    const { error: insertError } = await db.from('providers').insert(rows);
    if (insertError) throw new Error(insertError.message);
}
console.log(`recovery listings: ${rows.length} created, ${run.entries.length - rows.length} skipped`);
