/**
 * Read every row of an id-ordered set (UUID ids) in pages of `size`, by keyset:
 * each page starts after the last id the previous one returned, so no request
 * reads rows it skips. Offset paging made the last page of a region read ~9,000
 * rows to return 1,000, and nine such pages at once went past the anon role's
 * 3 s statement timeout whenever the database was slow (18 Nov 2026).
 *
 * The id range is cut into `parts` slices by first hex digit, and each slice is
 * read from both ends at once until the two streams meet: 2 × parts requests in
 * flight, each returning only rows it keeps. A row read twice in the last round
 * of a slice is kept once.
 *
 * `page(dir, after, before)` returns up to `size` rows with after < id < before
 * (either bound may be null), ascending for 'up' and descending for 'down'. Ids
 * compare as strings: lowercase UUIDs sort the way Postgres sorts uuid.
 */
export type KeysetPage<T> = (dir: 'up' | 'down', after: string | null, before: string | null) => Promise<T[]>;

/** Slice boundaries: "40000000-0000-…" etc. A slice runs from just above one to just below the next. */
export function sliceBounds(parts: number): Array<{ after: string | null; before: string | null }> {
    const n = Math.max(1, Math.min(16, Math.floor(parts)));
    const cuts = Array.from({ length: n - 1 }, (_, i) => Math.round(((i + 1) * 16) / n));
    const at = (d: number) => `${d.toString(16)}0000000-0000-0000-0000-000000000000`;
    const justBelow = (d: number) => `${(d - 1).toString(16)}fffffff-ffff-ffff-ffff-ffffffffffff`;
    return Array.from({ length: n }, (_, i) => ({
        after: i === 0 ? null : justBelow(cuts[i - 1]),
        before: i === n - 1 ? null : at(cuts[i]),
    }));
}

async function readSlice<T extends { id?: unknown }>(page: KeysetPage<T>, size: number, after: string | null, before: string | null, rows: Map<string, T>) {
    let low = after;
    let high = before;
    for (;;) {
        const [up, down] = await Promise.all([page('up', low, high), page('down', low, high)]);
        for (const r of [...up, ...down]) rows.set(String(r.id), r);
        // Either stream coming back short means the range between them is exhausted.
        if (up.length < size || down.length < size) return;
        low = String(up[up.length - 1].id);
        high = String(down[down.length - 1].id);
        if (low >= high) return; // the streams crossed: every row between was read this round
    }
}

export async function readAllByKeyset<T extends { id?: unknown }>(page: KeysetPage<T>, size: number, parts = 4): Promise<T[]> {
    const rows = new Map<string, T>();
    await Promise.all(sliceBounds(parts).map((b) => readSlice(page, size, b.after, b.before, rows)));
    return [...rows.values()].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
}
