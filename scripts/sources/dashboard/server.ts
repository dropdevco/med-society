/**
 * Local source-health dashboard: every scraper's status, the sites it reads,
 * the weekly timer, run history, and the contents of the last scrape.
 * Read-only, no dependencies, and bound to this machine only:
 *
 *   npm run sources:dashboard          # http://localhost:5180
 *   docker compose up -d dashboard
 *
 * It never contacts the sources itself; it reads what runs have written
 * (lib/history.ts). The /admin "Sources" tab replaces it for the team once
 * runs live in Supabase (roadmap phase 4).
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { ADAPTERS } from '../adapters';
import { findRun, recentRuns } from '../lib/history';
import { describeSchedule, nextRunAt, scheduleFromEnv } from '../lib/schedule';
import { HEARTBEAT_MS, readState } from '../schedule';

const HOST = process.env.SOURCES_DASHBOARD_HOST ?? '127.0.0.1';
const PORT = Number(process.env.SOURCES_DASHBOARD_PORT ?? 5180);
const PAGE = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html'), 'utf-8');

export function overview(now = Date.now()) {
    const schedule = scheduleFromEnv();
    const state = readState();
    const alive = !!state && now - Date.parse(state.heartbeatAt) < 3 * HEARTBEAT_MS;
    return {
        generatedAt: new Date(now).toISOString(),
        schedule: {
            description: describeSchedule(schedule),
            nextRunAt: alive ? state!.nextRunAt : new Date(nextRunAt(now, schedule)).toISOString(),
        },
        scheduler: state && {
            alive,
            running: alive && state.running,
            description: state.description,
            startedAt: state.startedAt,
            heartbeatAt: state.heartbeatAt,
            lastCycle: state.lastCycle,
        },
        sources: Object.values(ADAPTERS).map((a) => {
            const runs = recentRuns(a.slug, 26);
            return {
                slug: a.slug,
                name: a.name,
                kind: a.kind,
                access: a.access,
                permission: a.permission ?? null,
                targets: a.targets,
                latest: runs[0] ?? null,
                lastGood: runs.find((r) => r.status === 'green') ?? null,
                history: runs.map((r) => ({ id: r.id, startedAt: r.startedAt, status: r.status, entries: r.counts.entries, added: r.counts.added, removed: r.counts.removed })),
            };
        }),
    };
}

function send(res: http.ServerResponse, status: number, type: string, body: string) {
    res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:",
        'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
}

const json = (res: http.ServerResponse, status: number, data: unknown) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));

const server = http.createServer((req, res) => {
    if (req.method !== 'GET') return json(res, 405, { error: 'read-only' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
        if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE);
        if (url.pathname === '/api/overview') return json(res, 200, overview());
        if (url.pathname === '/api/run') {
            const source = url.searchParams.get('source') ?? '';
            if (!ADAPTERS[source]) return json(res, 404, { error: 'unknown source' });
            const run = findRun(source, url.searchParams.get('id') ?? 'latest');
            return run ? json(res, 200, run) : json(res, 404, { error: 'no such run' });
        }
        return json(res, 404, { error: 'not found' });
    } catch (err) {
        return json(res, 500, { error: (err as Error).message });
    }
});

server.listen(PORT, HOST, () => {
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`source dashboard on http://${shown}:${PORT}`);
});
