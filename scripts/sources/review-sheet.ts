/**
 * A read-only review sheet: each record from a source's last good run, its top
 * 5 listings by name similarity, and an empty decision column. Reads listing
 * names only, never contact fields, and writes nothing to the database. The
 * sheet holds doctor names, so it stays in .data (git-ignored).
 *
 *   SOURCES_DB_URL=http://127.0.0.1:54331 npx tsx scripts/sources/review-sheet.ts [--source=hospital-angeles]
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { allRows, database } from './lib/db';
import { DATA_DIR, lastGoodRun, type RunRecord } from './lib/snapshot';
import { bhNorm, setSimilarity, trigrams } from './lib/trigram';

export interface ListingRow { id: string; name: string; region: string | null }
export interface Candidate { id: string; name: string; similarity: number }

export const TOP = 5;

/** Same region only when the record has one. Weak resemblances are left out. */
export function topListings(name: string, region: string | null, listings: (ListingRow & { grams?: Set<string> })[]): Candidate[] {
    const grams = trigrams(bhNorm(name));
    return listings
        .filter((l) => !region || l.region === region)
        .map((l) => ({ id: l.id, name: l.name, similarity: setSimilarity(grams, l.grams ?? trigrams(bhNorm(l.name))) }))
        .filter((c) => c.similarity >= 0.3)
        .sort((a, b) => b.similarity - a.similarity || a.id.localeCompare(b.id))
        .slice(0, TOP)
        .map((c) => ({ ...c, similarity: Math.round(c.similarity * 1000) / 1000 }));
}

/** A leading = + - @ would run as a formula in Excel. */
export function csvCell(value: unknown): string {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildSheet(run: Pick<RunRecord, 'id' | 'startedAt' | 'entries'>, listings: ListingRow[]): string {
    const ready = listings.map((l) => ({ ...l, grams: trigrams(bhNorm(l.name)) }));
    const header = ['run_id', 'observed_at', 'external_id', 'name', 'specialties', 'region', 'url'];
    for (let i = 1; i <= TOP; i++) header.push(`listing_${i}_id`, `listing_${i}_name`, `listing_${i}_similarity`);
    header.push('decision', 'listing_chosen', 'notes');
    const rows = run.entries.map((e) => {
        const cells: unknown[] = [run.id, run.startedAt, e.externalId, e.name, e.specialties.join('; '), e.region ?? '', e.url ?? ''];
        const top = topListings(e.name, e.region ?? null, ready);
        for (let i = 0; i < TOP; i++) cells.push(top[i]?.id ?? '', top[i]?.name ?? '', top[i]?.similarity ?? '');
        cells.push('', '', '');
        return cells.map(csvCell).join(',');
    });
    return `﻿${[header.join(','), ...rows].join('\n')}\n`;
}

async function main() {
    const source = process.argv.find((a) => a.startsWith('--source='))?.slice(9) ?? 'hospital-angeles';
    const run = lastGoodRun(source);
    if (!run) throw new Error(`${source}: no good run`);
    const db = database();
    const listings = await allRows<ListingRow>((a, b) => db.from('provider_list').select('id,name,region').order('id').range(a, b));
    const dir = join(DATA_DIR, source);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `review-sheet-${run.id}.csv`);
    writeFileSync(file, buildSheet(run, listings));
    const withCandidate = run.entries.filter((e) => topListings(e.name, e.region ?? null, listings).length).length;
    console.log(`${source}: run ${run.id} | ${run.entries.length} records | ${withCandidate} with a candidate | ${listings.length} listings read`);
    console.log(`sheet: ${file}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((err) => { console.error(err); process.exit(1); });
