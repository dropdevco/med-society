/**
 * Server-side proxy for a single Google Place cover photo.
 *
 * Why this exists (perf): home-page tiles for El Paso providers show a photo
 * fetched via useGooglePhotos, which loads the whole Google Maps JS SDK
 * (`importLibrary('places')`) and then calls `PlacesService.getDetails` — one
 * round trip through a ~150KB script before the browser even knows a photo
 * URL. Measured on this project: the Maps script starts ~4.0s after page
 * load, `getDetails` resolves around ~5.0s, and only then does the <img>
 * download begin. 1,275 of 1,390 providers with a `googlePlaceId` have no
 * `imageUrl`, so that path is what most tiles hit.
 *
 * This endpoint turns that into a plain, cacheable URL a browser can put
 * straight into `<img src>` and start fetching immediately, with no JS SDK
 * involved: GET /api/place-photo?placeId=<id>&w=<px> 302-redirects to
 * Google's own signed photo URI. Measured chain latency locally: Place
 * Details ~0.4s, photo media lookup ~0.36s, a 400px JPEG ~52KB.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 * Vercel → Project → Settings → Environment Variables:
 *   GOOGLE_PLACES_SERVER_KEY   a *server* Google Maps API key with "Places
 *                              API (New)" enabled, restricted by API (not by
 *                              HTTP referrer — there is no browser origin to
 *                              check here). Never the same key as
 *                              VITE_GOOGLE_MAPS_API_KEY, which is deliberately
 *                              referrer-restricted and must stay that way.
 * Without this var set, `health=1` reports 503 and callers are expected to
 * fall back to the client-side Maps JS path (see src/hooks/usePortraitPhoto.ts).
 *
 * ── Google Places data policy ───────────────────────────────────────────
 * Google's Places terms permit only a `place_id` to be cached/stored
 * indefinitely. This endpoint stores nothing: no photo, no photo resource
 * name, and no photoUri ever reaches Supabase or any storage bucket. The only
 * retention anywhere in this path is an HTTP/CDN cache of the redirect
 * response itself (`s-maxage=21600` = 6h at the edge, `max-age=3600` = 1h in
 * the browser, `stale-while-revalidate=3600`) — Google's own `photoUri`
 * target is additionally served by Google with `Cache-Control: max-age=86400`.
 * A negative result (place has no photos) is cached too, so a placeId that
 * will never have a photo doesn't get re-queried on every page load.
 *
 * Author attribution: Google requires photo attributions to be shown
 * alongside a photo. The provider page's full photo gallery still goes
 * through `useGooglePhotos`, which carries `attributionHtml` and renders it.
 * The cover image this endpoint serves for home-page tiles is shown without
 * attribution text — that was already true before this change (the tile
 * never rendered attribution) and is unchanged by it.
 *
 * ── Abuse guard ──────────────────────────────────────────────────────────
 * Because the Google key here is unrestricted by referrer, anyone could in
 * principle probe this endpoint with arbitrary Google placeIds and use it as
 * a free image proxy. When Supabase credentials are available, we check (in
 * parallel with the Google call) that the placeId belongs to a provider row
 * or a published hotel (public.hotels, migration 0056) we actually know
 * about, and 404 otherwise. If that check itself fails or
 * the env isn't configured, we don't block on it — the abuse surface is
 * small enough (a rate-limited photo redirect) not to be worth failing open
 * on for local dev or a misconfigured deploy.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage;
type Res = ServerResponse & {
    status: (code: number) => Res;
    json: (body: unknown) => void;
};

const PLACE_ID_RE = /^[A-Za-z0-9_-]{10,300}$/;
const ALLOWED_WIDTHS = [160, 400, 800] as const;
const DEFAULT_WIDTH = 400;
const UPSTREAM_TIMEOUT_MS = 5000;

const NO_STORE = 'no-store';
const NEGATIVE_CACHE = 'public, max-age=3600, s-maxage=21600';
const REDIRECT_CACHE = 'public, max-age=3600, s-maxage=21600, stale-while-revalidate=3600';

function clampWidth(raw: string | undefined): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_WIDTH;
    // Snap to the nearest whitelisted size rather than passing an arbitrary
    // value through to Google — keeps the cache key space small and bounded.
    let best: number = ALLOWED_WIDTHS[0];
    let bestDiff = Math.abs(n - best);
    for (const w of ALLOWED_WIDTHS) {
        const diff = Math.abs(n - w);
        if (diff < bestDiff) {
            best = w;
            bestDiff = diff;
        }
    }
    return best;
}

function firstQueryValue(url: URL, key: string): string | undefined {
    return url.searchParams.get(key) ?? undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Best-effort check that `placeId` belongs to a provider or a published hotel
 * we already know about. Returns `true` when the check can't be performed (missing env, or
 * the check itself errored) so this never blocks a legitimate request when
 * Supabase is unreachable — it only actively rejects a confirmed miss.
 */
async function isKnownPlaceId(placeId: string): Promise<boolean> {
    const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return true;

    // A provider's place, or a published hotel's (migration 0056; anon only
    // sees live hotels, so a hidden hotel's photo is refused too).
    const base = supabaseUrl.replace(/\/$/, '');
    const id = encodeURIComponent(placeId);
    const lookups = [
        `${base}/rest/v1/providers?select=id&googlePlaceId=eq.${id}&limit=1`,
        `${base}/rest/v1/hotels?select=id&google_place_id=eq.${id}&limit=1`,
    ];
    const found = await Promise.all(lookups.map(async (endpoint) => {
        try {
            const res = await fetchWithTimeout(
                endpoint,
                { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
                UPSTREAM_TIMEOUT_MS,
            );
            if (!res.ok) return null; // can't tell: an unrelated Supabase hiccup, or 0056 not applied yet
            const rows = (await res.json()) as unknown;
            return Array.isArray(rows) && rows.length > 0;
        } catch {
            return null;
        }
    }));
    if (found.includes(true)) return true;
    // Only a confirmed miss in both tables is refused; any lookup that failed lets it through.
    return found.includes(null);
}

interface PlaceDetailsPhoto {
    name: string;
}

interface PlaceDetailsResponse {
    photos?: PlaceDetailsPhoto[];
}

interface PhotoMediaResponse {
    photoUri?: string;
}

export default async function handler(req: Req, res: Res) {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        res.setHeader('Cache-Control', NO_STORE);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const url = new URL(req.url ?? '/', 'http://internal');
    const apiKey = process.env.GOOGLE_PLACES_SERVER_KEY;

    if (firstQueryValue(url, 'health') !== undefined) {
        res.setHeader('Cache-Control', NO_STORE);
        if (!apiKey) return res.status(503).end();
        return res.status(204).end();
    }

    if (!apiKey) {
        res.setHeader('Cache-Control', NO_STORE);
        return res.status(503).json({ error: 'Photo proxy not configured' });
    }

    const placeId = firstQueryValue(url, 'placeId');
    if (!placeId || !PLACE_ID_RE.test(placeId)) {
        res.setHeader('Cache-Control', NO_STORE);
        return res.status(400).json({ error: 'Invalid placeId' });
    }
    const w = clampWidth(firstQueryValue(url, 'w'));

    try {
        const [details, known] = await Promise.all([
            fetchWithTimeout(
                `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
                { headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'photos' } },
                UPSTREAM_TIMEOUT_MS,
            ),
            isKnownPlaceId(placeId),
        ]);

        if (!known) {
            res.setHeader('Cache-Control', NEGATIVE_CACHE);
            return res.status(404).json({ error: 'Unknown place' });
        }

        if (!details.ok) {
            res.setHeader('Cache-Control', NO_STORE);
            return res.status(502).json({ error: 'Upstream error' });
        }

        const detailsBody = (await details.json()) as PlaceDetailsResponse;
        const photoName = detailsBody.photos?.[0]?.name;
        if (!photoName) {
            res.setHeader('Cache-Control', NEGATIVE_CACHE);
            return res.status(404).json({ error: 'No photo' });
        }

        const media = await fetchWithTimeout(
            `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${w}&skipHttpRedirect=true`,
            { headers: { 'X-Goog-Api-Key': apiKey } },
            UPSTREAM_TIMEOUT_MS,
        );
        if (!media.ok) {
            res.setHeader('Cache-Control', NO_STORE);
            return res.status(502).json({ error: 'Upstream error' });
        }

        const mediaBody = (await media.json()) as PhotoMediaResponse;
        if (!mediaBody.photoUri) {
            res.setHeader('Cache-Control', NO_STORE);
            return res.status(502).json({ error: 'Upstream error' });
        }

        res.setHeader('Cache-Control', REDIRECT_CACHE);
        res.setHeader('Location', mediaBody.photoUri);
        return res.status(302).end();
    } catch (err) {
        console.error('[place-photo] failed:', err instanceof Error ? err.message : err);
        res.setHeader('Cache-Control', NO_STORE);
        return res.status(502).json({ error: 'Upstream error' });
    }
}
