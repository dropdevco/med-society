/**
 * The directory loader's keyset paging (src/utils/keysetPages.ts), against a
 * fake table: every row exactly once, in order, at the sizes that break paging.
 *   npx tsx scripts/directory-selftest.ts
 */
import { randomUUID } from 'node:crypto';
import { readAllByKeyset, sliceBounds, type KeysetPage } from '../src/utils/keysetPages';

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
    if (ok) console.log(`  ok    ${label}`);
    else { failures++; console.log(` FAIL  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`); }
};

function table(ids: string[]) {
    const sorted = [...ids].sort();
    let requests = 0;
    let largest = 0;
    const page = (size: number): KeysetPage<{ id: string }> => async (dir, after, before) => {
        requests++;
        const inRange = sorted.filter((id) => (after === null || id > after) && (before === null || id < before));
        const out = (dir === 'up' ? inRange : [...inRange].reverse()).slice(0, size).map((id) => ({ id }));
        largest = Math.max(largest, out.length);
        return out;
    };
    return { sorted, page, stats: () => ({ requests, largest }) };
}

const ids = (n: number, prefix?: string) => Array.from({ length: n }, () => (prefix ? prefix + randomUUID().slice(1) : randomUUID()));

for (const [label, list, size] of [
    ['an empty region', ids(0), 10],
    ['one row', ids(1), 10],
    ['exactly one page per slice end', ids(80), 10],
    ['two full pages that meet exactly', ids(20, 'a'), 10],
    ['streams that cross mid-page', ids(27, '5'), 10],
    ['every row in one slice', ids(95, 'f'), 10],
    ['a region the size of Tijuana', ids(8571), 1000],
] as Array<[string, string[], number]>) {
    const t = table(list);
    const got = (await readAllByKeyset(t.page(size), size)).map((r) => r.id);
    check(`${label}: every row once, in order (${list.length})`, got.length === t.sorted.length && got.every((id, i) => id === t.sorted[i]), { got: got.length, want: t.sorted.length });
    check(`${label}: no page larger than the page size`, t.stats().largest <= size);
}

const bounds = sliceBounds(4);
check('slices: four, covering the whole id range with no gap', bounds.length === 4 && bounds[0].after === null && bounds[3].before === null
    && bounds.slice(1).every((b, i) => b.after! < bounds[i].before! && bounds[i].before!.startsWith(String.fromCharCode(b.after!.charCodeAt(0) + (b.after![0] === '9' ? 40 : 1)))));
check('slices: one slice means the whole range', JSON.stringify(sliceBounds(1)) === '[{"after":null,"before":null}]');
const t = table(ids(8571));
await readAllByKeyset(t.page(1000), 1000);
check('a Tijuana-sized region takes about 16 requests, not 9 offset pages reading 45,000 rows', t.stats().requests <= 20, t.stats());

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
