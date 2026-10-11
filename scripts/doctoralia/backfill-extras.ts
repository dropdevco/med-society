/**
 * Backfill `providers.insurances` from the scrape.
 *
 *   npx tsx scripts/doctoralia/backfill-extras.ts            # dry run
 *   npx tsx scripts/doctoralia/backfill-extras.ts --commit
 *
 * Insurers come from our own Doctoralia data, so they can live in the
 * database permanently. (Google Places content cannot — only place_id may be
 * stored indefinitely, which is why photos and reviews are fetched at render
 * time instead.)
 *
 * Patients no longer book through Doctoralia; they message us via /api/inquiry,
 * so no booking link is stored.
 */
import * as fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { PROFILES_FILE } from './config';
import type { DoctoraliaProfile } from './types';

const commit = process.argv.includes('--commit');

function loadEnv() {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
      if (!line || line.trimStart().startsWith('#')) continue;
      const i = line.indexOf('=');
      if (i < 0) continue;
      out[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

const env = loadEnv();
const supabase = createClient(env.VITE_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!);

function readJsonl<T>(file: string, key: (row: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)) {
    try {
      const row = JSON.parse(line) as T;
      out.set(key(row), row);
    } catch {
      // half-written line from an interrupted run
    }
  }
  return out;
}

async function run() {
  const profiles = readJsonl<DoctoraliaProfile>(PROFILES_FILE, (p) => p.doctoraliaId);

  const providers: { id: string; name: string; doctoraliaId: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('providers')
      .select('id,name,"doctoraliaId"')
      .not('doctoraliaId', 'is', null)
      .range(from, from + 999);
    if (error) throw new Error(`could not read providers: ${error.message}`);
    providers.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  console.log(`\n📋 Backfilling extras for ${providers.length} Doctoralia-sourced providers${commit ? '' : ' (dry run)'}\n`);

  let withInsurers = 0;
  let updated = 0;
  const samples: string[] = [];

  for (const p of providers) {
    const profile = p.doctoraliaId ? profiles.get(p.doctoraliaId) : undefined;
    if (!profile) continue;

    const insurances = profile.insurances ?? [];
    if (insurances.length) withInsurers++;
    if (!insurances.length) continue;

    if (samples.length < 5) {
      samples.push(
        `    ${p.name} · ${insurances.slice(0, 3).join(', ')}`,
      );
    }

    if (!commit) {
      updated++;
      continue;
    }

    const { error } = await supabase
      .from('providers')
      .update({ insurances })
      .eq('id', p.id);
    if (error) {
      console.error(`  ✖ ${p.name}: ${error.message}`);
      continue;
    }
    updated++;
    if (updated % 100 === 0) process.stdout.write(`\r  updated ${updated}`);
  }

  console.log(`\n  providers with insurers listed: ${withInsurers}`);
  console.log(`  ${commit ? 'rows updated' : 'rows that would update'}: ${updated}`);
  if (samples.length) console.log(`\n  sample:\n${samples.join('\n')}`);
  if (!commit) console.log('\n  Dry run — re-run with --commit.\n');
}

run().catch((err) => {
  console.error('\n✖ fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
