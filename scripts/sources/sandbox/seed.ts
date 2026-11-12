/**
 * Copies what matching needs into the sandbox: listings (no contact fields) and
 * Doctoralia names and cédulas. Production is only read. The copy lives in a
 * throwaway container and disappears with down.sh.
 *   SOURCES_DB_URL=http://127.0.0.1:54331 npx tsx --env-file=.env.local scripts/sources/sandbox/seed.ts
 */
import { createClient } from '@supabase/supabase-js';
import { allRows, database, inChunks, isSandbox } from '../lib/db';

if (!isSandbox()) throw new Error('SOURCES_DB_URL must point at the sandbox');
const prod = createClient(process.env.VITE_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const local = database();

const providers = await allRows<Record<string, unknown>>((a, b) => prod.from('providers').select('id,name,specialty,country,city,region,source,status,kind').order('id').range(a, b));
await inChunks(providers, 1000, (c) => local.from('providers').upsert(c));
const doctors = await allRows<Record<string, unknown>>((a, b) => prod.from('doctoralia_doctors').select('doctoralia_id,entity_type,name,cedulas,provider_id').order('doctoralia_id').range(a, b));
await inChunks(doctors, 1000, (c) => local.from('doctoralia_doctors').upsert(c));
console.log(`seeded sandbox: ${providers.length} listings, ${doctors.length} doctoralia records`);
