/**
 * What loading a source's last good run would decide, without loading it.
 * Reads only: doctor_cedulas and doctor_name_candidates, then the same
 * decide() the loader uses. For the "dry run before enabling" step of a new
 * doctor source, so the counts are known before anything reaches the site.
 *
 *   npm run sources:preview -- --source=baja-health-cluster-doctors
 *   npm run sources:preview -- --source=baja-health-cluster-doctors --list   # one line per record
 *
 * Prints counts and, with --list, names and the best candidate: never contact data.
 */
import { pathToFileURL } from 'node:url';
import { database } from './lib/db';
import { decide, type NameCandidate } from './lib/match';
import { nameKey, parseName } from './lib/names';
import { lastGoodRun } from './lib/snapshot';

export type PreviewOutcome = 'cedula' | 'cedula-name-differs' | 'cedula-two-doctors' | 'exact-name' | 'similar-name' | 'unmatched';

/** Sort a decision into the buckets a person reads, finer than confirmed/probable/unmatched. */
export function bucket(cedulaDoctors: string[], candidates: NameCandidate[], d: ReturnType<typeof decide>): PreviewOutcome {
    const doctors = new Set(cedulaDoctors);
    if (doctors.size > 1) return 'cedula-two-doctors';
    if (doctors.size === 1) return d.status === 'confirmed' ? 'cedula' : 'cedula-name-differs';
    if (d.status === 'unmatched') return 'unmatched';
    return candidates.some((c) => c.similarity >= 0.999) ? 'exact-name' : 'similar-name';
}

async function main() {
    const slug = process.argv.find((a) => a.startsWith('--source='))?.slice(9);
    const list = process.argv.includes('--list');
    if (!slug) throw new Error('Usage: npm run sources:preview -- --source=<slug> [--list]');
    const run = lastGoodRun(slug);
    if (!run) throw new Error(`no good run of ${slug} in scripts/sources/.data: run it first (dry run is enough)`);

    const db = database();
    const cedulas = [...new Set(run.entries.flatMap((e) => e.cedulas))];
    const owner = new Map<string, string>();
    for (let i = 0; i < cedulas.length; i += 200) {
        const { data, error } = await db.from('doctor_cedulas').select('cedula,doctor_id').in('cedula', cedulas.slice(i, i + 200));
        if (error) throw new Error(`doctor_cedulas: ${error.message}`);
        for (const r of data ?? []) owner.set(r.cedula, r.doctor_id);
    }

    const counts: Record<PreviewOutcome, number> = { cedula: 0, 'cedula-name-differs': 0, 'cedula-two-doctors': 0, 'exact-name': 0, 'similar-name': 0, unmatched: 0 };
    const lines: string[] = [];
    for (const e of run.entries) {
        const { data, error } = await db.rpc('doctor_name_candidates', { p_name: e.name, p_name_key: nameKey(parseName(e.name)) ?? '', p_limit: 5 });
        if (error) throw new Error(`doctor_name_candidates: ${error.message}`);
        const candidates = (data ?? []) as NameCandidate[];
        const cedulaDoctors = e.cedulas.map((c) => owner.get(c)).filter((x): x is string => !!x);
        const d = decide({ cedulaDoctors, candidates, region: e.region });
        const b = bucket(cedulaDoctors, candidates, d);
        counts[b]++;
        const best = candidates.find((c) => c.doctor_id === d.doctorId);
        lines.push(`  ${b.padEnd(20)} ${e.name}${e.cedulas.length ? ` [céd ${e.cedulas.length}]` : ''}${best ? `  ->  ${best.display_name} (${best.similarity.toFixed(2)})` : ''}`);
    }

    console.log(`${slug}: run ${run.id} (${run.startedAt}), ${run.entries.length} records, ${run.entries.filter((e) => e.cedulas.length).length} with a cédula`);
    console.log(`  would confirm (cédula, name agrees)   ${counts.cedula}`);
    console.log(`  to review: cédula, name differs      ${counts['cedula-name-differs']}`);
    console.log(`  to review: cédulas on two doctors    ${counts['cedula-two-doctors']}`);
    console.log(`  to review: exact name only           ${counts['exact-name']}`);
    console.log(`  to review: similar name only         ${counts['similar-name']}`);
    console.log(`  unmatched (no doctor like it)        ${counts.unmatched}`);
    if (list) console.log(lines.sort().join('\n'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error((err as Error).message);
        process.exit(1);
    });
}
