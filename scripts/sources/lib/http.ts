/**
 * The pipeline's only way onto the network. It says who it is, waits between
 * requests, and backs off when a server is busy. It does not get around a
 * "no": a 401/403, or a 429 that outlasts the retries, ends the run as
 * blocked so a person can ask the organization (docs/adr/0002).
 */

export const USER_AGENT = 'MedSocietyBot/1.0 (+https://www.medsociety.one)';
/** The token robots.txt groups are matched against. */
export const ROBOTS_TOKEN = 'medsocietybot';

const MIN_DELAY_MS = Number(process.env.SOURCES_MIN_DELAY_MS ?? 3000);
const JITTER_MS = 1000;
const TIMEOUT_MS = 45_000;
const MAX_RETRIES = 3;

export class BlockedError extends Error {
    constructor(readonly url: string, readonly status: number) {
        super(`blocked: HTTP ${status} from ${url}`);
    }
}

export class HttpError extends Error {
    constructor(readonly url: string, readonly status: number) {
        super(`HTTP ${status} from ${url}`);
    }
}

export interface Fetched {
    url: string;
    status: number;
    body: string;
}

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function throttle() {
    const wait = lastRequestAt + MIN_DELAY_MS + Math.random() * JITTER_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
}

function backoffMs(attempt: number, retryAfter: string | null): number {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 120_000);
    return Math.min(5000 * 2 ** attempt, 60_000);
}

/**
 * GET a page. `accept` lists statuses the caller handles itself (robots.txt
 * treats 404 as "no rules"); anything else that is not 2xx throws.
 */
export async function politeGet(url: string, accept: number[] = []): Promise<Fetched> {
    for (let attempt = 0; ; attempt++) {
        await throttle();
        let res: Response;
        try {
            res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'es-MX,es;q=0.9' },
                redirect: 'follow',
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
        } catch (err) {
            if (attempt >= MAX_RETRIES) throw err;
            await sleep(backoffMs(attempt, null));
            continue;
        }

        if (res.ok || accept.includes(res.status)) {
            return { url: res.url, status: res.status, body: await res.text() };
        }
        if (res.status === 401 || res.status === 403) throw new BlockedError(url, res.status);
        if (res.status === 429 || res.status >= 500) {
            if (attempt >= MAX_RETRIES) {
                if (res.status === 429) throw new BlockedError(url, res.status);
                throw new HttpError(url, res.status);
            }
            await sleep(backoffMs(attempt, res.headers.get('retry-after')));
            continue;
        }
        throw new HttpError(url, res.status);
    }
}
