/**
 * Stale-while-revalidate cache for the provider directory, in IndexedDB.
 *
 * The payload is several MB (one border region of the `provider_list` view:
 * ~4,000 rows / ~3 MB for El Paso–Juárez, ~7,000 / ~6 MB for San Diego–
 * Tijuana), and each region is cached under its own key. That rules out
 * localStorage — it's synchronous, has a ~5MB ceiling shared with everything
 * else on the origin, and would block the main thread on every read/write.
 * IndexedDB has none of those problems, at the cost of being async and a
 * little more ceremony, which is what the raw helpers below hide.
 *
 * Every call is wrapped so a failure (private browsing, blocked storage, a
 * corrupt DB) resolves to `null` / no-ops rather than throwing — a cache is
 * an optimization, never a dependency the page can fail on.
 */

import type { RegionId } from './region';

const DB_NAME = 'medsociety';
const STORE_NAME = 'kv';
/**
 * Bump CACHE_SCHEMA by hand whenever the cached row shape changes (the
 * `select` columns, or anything normalizeProvider depends on). On top of
 * that, every entry is stamped with the build id Vite injects (the Vercel
 * commit SHA, or the build time locally — see vite.config.ts `define`), and a
 * mismatch is treated as a miss, so a new deploy never paints rows cached by
 * an older one, even if nobody remembered to bump the schema.
 */
// 2: per-region entries of the lean `provider_list` view (was one `select *`).
const CACHE_SCHEMA = 2;
const cacheKey = (region: RegionId) => `providers:v${CACHE_SCHEMA}:${region}`;
/** Keys written by older schemas; deleted on the next write so they stop occupying quota. */
const LEGACY_KEYS = ['providers:v1'];
const BUILD_ID: string = String(import.meta.env.VITE_APP_BUILD_ID ?? 'dev');
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEntry {
    savedAt: number;
    schema: number;
    buildId: string;
    rows: Record<string, unknown>[];
}

function openDb(): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
        try {
            if (typeof indexedDB === 'undefined') {
                resolve(null);
                return;
            }
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

export async function readProviderCache(region: RegionId): Promise<Record<string, unknown>[] | null> {
    try {
        const db = await openDb();
        if (!db) return null;

        return await new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.get(cacheKey(region));
                req.onsuccess = () => {
                    const entry = req.result as CacheEntry | undefined;
                    db.close();
                    if (!entry || !Array.isArray(entry.rows)) {
                        resolve(null);
                        return;
                    }
                    if (entry.schema !== CACHE_SCHEMA || entry.buildId !== BUILD_ID) {
                        resolve(null);
                        return;
                    }
                    if (Date.now() - entry.savedAt > MAX_AGE_MS) {
                        resolve(null);
                        return;
                    }
                    resolve(entry.rows);
                };
                req.onerror = () => {
                    db.close();
                    resolve(null);
                };
            } catch {
                try { db.close(); } catch { /* noop */ }
                resolve(null);
            }
        });
    } catch {
        return null;
    }
}

export async function writeProviderCache(region: RegionId, rows: Record<string, unknown>[]): Promise<void> {
    try {
        const db = await openDb();
        if (!db) return;

        await new Promise<void>((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                const store = tx.objectStore(STORE_NAME);
                const entry: CacheEntry = { savedAt: Date.now(), schema: CACHE_SCHEMA, buildId: BUILD_ID, rows };
                for (const key of LEGACY_KEYS) store.delete(key);
                const req = store.put(entry, cacheKey(region));
                req.onsuccess = () => {
                    db.close();
                    resolve();
                };
                req.onerror = () => {
                    db.close();
                    resolve();
                };
            } catch {
                try { db.close(); } catch { /* noop */ }
                resolve();
            }
        });
    } catch {
        // no-op
    }
}
