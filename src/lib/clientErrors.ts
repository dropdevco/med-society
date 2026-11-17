/**
 * A small in-memory record of what went wrong in THIS tab, so a Feedback report
 * can say "and the browser saw this" instead of only "it's broken".
 *
 * That record is the evidence api/feedback.ts uses to tell a real bug from a
 * vague complaint: a report that arrives with an error recorded on the same
 * page is corroborated; one that arrives with nothing is just an opinion.
 *
 * Privacy: nothing leaves the tab unless the visitor sends a report, and then
 * only these short lines. Query strings are stripped (a search URL can describe
 * a symptom), request and response bodies are never read, and the cap is small.
 *
 * Never throws and never changes behaviour: the fetch wrapper hands back the
 * original response or rethrows the original error untouched.
 */

export interface RecordedError {
    type: 'error' | 'rejection' | 'http';
    msg: string;
    /** location.pathname when it happened. */
    path: string;
    at: number;
}

const MAX = 8;
const KEEP_MS = 30 * 60 * 1000;
const buffer: RecordedError[] = [];
let installed = false;

/** Same rule as api/feedback.ts `stripQuery`. */
function stripQuery(s: string): string {
    return s.replace(/(https?:\/\/[^\s?#'")]+|\/[\w./-]+)[?#][^\s'")]*/g, '$1');
}

/** Browser noise that is not a defect in this site. */
const IGNORED = /ResizeObserver loop|Script error\.?$|Non-Error promise rejection|AbortError|The operation was aborted|Load failed$/i;
/** Requests that must not be recorded: analytics, and the report itself. */
const SKIP_URL = /\/ingest\b|\/api\/feedback\b|\/api\/form-event\b/;

function push(type: RecordedError['type'], raw: unknown): void {
    try {
        const msg = stripQuery(String(raw ?? '').replace(/\s+/g, ' ').trim()).slice(0, 300);
        if (!msg || IGNORED.test(msg)) return;
        // The same line twice in a row (a render loop) is one finding, not eight.
        const last = buffer[buffer.length - 1];
        if (last && last.msg === msg && last.type === type) return;
        buffer.push({ type, msg, path: window.location.pathname, at: Date.now() });
        if (buffer.length > MAX) buffer.shift();
    } catch { /* recording must never throw */ }
}

export function installErrorCapture(): void {
    if (installed || typeof window === 'undefined') return;
    installed = true;

    window.addEventListener('error', (ev) => {
        // Errors from extensions and other origins say nothing about this site.
        if (ev.filename && !ev.filename.startsWith(window.location.origin)) return;
        push('error', ev.error instanceof Error ? `${ev.error.name}: ${ev.error.message}` : ev.message);
    });

    window.addEventListener('unhandledrejection', (ev) => {
        const r: unknown = ev.reason;
        push('rejection', r instanceof Error ? `${r.name}: ${r.message}` : r);
    });

    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        let label = '';
        try {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (!SKIP_URL.test(url)) {
                const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
                label = `${method} ${stripQuery(url.split(/[?#]/)[0])}`;
            }
        } catch { /* label stays empty: request goes through unrecorded */ }
        try {
            const res = await original(input, init);
            if (label && res.status >= 500) push('http', `${label} → ${res.status}`);
            return res;
        } catch (e) {
            const aborted = e instanceof DOMException && e.name === 'AbortError';
            if (label && !aborted) push('http', `${label} → network error`);
            throw e;
        }
    };
}

/** What happened in the last half hour, oldest first, ready to send. */
export function recentErrors(): Pick<RecordedError, 'type' | 'msg' | 'path'>[] {
    const cutoff = Date.now() - KEEP_MS;
    return buffer.filter((e) => e.at >= cutoff).map(({ type, msg, path }) => ({ type, msg, path }));
}
