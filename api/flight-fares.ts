/**
 * GET /api/flight-fares?from=LAX&to=SAN&depart=2026-12-10[&return=2026-12-15]
 *
 * The cheapest recently seen fare for a route and dates, from the Travelpayouts
 * (Aviasales) Data API's cache of other people's searches. It is not live
 * availability and nothing can be booked here: the page shows it as "recently
 * found" next to the same outbound search link (docs/travel-booking.md, F4).
 *
 * Off until TRAVELPAYOUTS_TOKEN (server only) is set: without it every request
 * answers { ok: true, fare: null }. Any failure answers the same way, so the
 * Flights tab never breaks because of this.
 *
 * The endpoint's response fields come from public client code, not from an
 * official schema (the vendor's help pages could not be read): check one real
 * response after the token is set.
 *
 * Self-contained, like every file in api/.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

type Req = IncomingMessage;
type Res = ServerResponse;

/** The only places we send patients to. */
const DESTINATIONS = new Set(['SAN', 'TIJ', 'ELP', 'CJS']);
const ENDPOINT = 'https://api.travelpayouts.com/aviasales/v3/prices_for_dates';

export interface FareQuery { from: string; to: string; depart: string; ret: string }
export interface Fare { price: number; currency: 'USD'; transfers: number | null; airline: string | null }

const isDay = (d: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};

/** The query, or null when anything is off. `today` is UTC; yesterday is allowed for visitors behind it. */
export function readQuery(params: URLSearchParams, today = new Date().toISOString().slice(0, 10)): FareQuery | null {
    const from = (params.get('from') ?? '').toUpperCase();
    const to = (params.get('to') ?? '').toUpperCase();
    const depart = params.get('depart') ?? '';
    const ret = params.get('return') ?? '';
    const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
    const latest = new Date(Date.parse(`${today}T00:00:00Z`) + 400 * 864e5).toISOString().slice(0, 10);
    if (!/^[A-Z]{3}$/.test(from) || !DESTINATIONS.has(to) || from === to) return null;
    if (!isDay(depart) || depart < earliest || depart > latest) return null;
    if (ret && (!isDay(ret) || ret <= depart || ret > latest)) return null;
    return { from, to, depart, ret };
}

export function upstreamUrl(q: FareQuery): string {
    const p = new URLSearchParams({
        origin: q.from, destination: q.to, departure_at: q.depart,
        one_way: q.ret ? 'false' : 'true', currency: 'usd', sorting: 'price', limit: '10',
    });
    if (q.ret) p.set('return_at', q.ret);
    return `${ENDPOINT}?${p.toString()}`;
}

/** The cheapest usable item that really lands where asked, or null. */
export function pickFare(body: unknown, q: FareQuery): Fare | null {
    const b = body as { success?: boolean; currency?: string; data?: unknown } | null;
    if (!b || b.success === false || !Array.isArray(b.data)) return null;
    if (b.currency && b.currency.toLowerCase() !== 'usd') return null;
    let best: Fare | null = null;
    for (const item of b.data as Record<string, unknown>[]) {
        const price = Number(item?.price);
        if (!Number.isFinite(price) || price <= 0) continue;
        if (typeof item.destination_airport === 'string' && item.destination_airport !== q.to) continue;
        if (best && price >= best.price) continue;
        best = {
            price, currency: 'USD',
            transfers: Number.isInteger(item.transfers) ? item.transfers as number : null,
            airline: typeof item.airline === 'string' && /^[A-Z0-9]{2,3}$/.test(item.airline) ? item.airline : null,
        };
    }
    return best;
}

function send(res: Res, status: number, body: unknown, cache: string) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cache);
    res.end(JSON.stringify(body));
}

export default async function handler(req: Req, res: Res) {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'method_not_allowed' }, 'no-store');
    const q = readQuery(new URL(req.url ?? '/', 'http://local').searchParams);
    if (!q) return send(res, 400, { ok: false, error: 'invalid_query' }, 'public, s-maxage=3600');
    const token = process.env.TRAVELPAYOUTS_TOKEN?.trim();
    if (!token) return send(res, 200, { ok: true, fare: null }, 'public, s-maxage=300');
    try {
        const r = await fetch(upstreamUrl(q), {
            headers: { 'X-Access-Token': token, 'Accept-Encoding': 'gzip, deflate' },
            signal: AbortSignal.timeout(4000),
        });
        if (!r.ok) {
            console.warn('[flight-fares] upstream', r.status);
            return send(res, 200, { ok: true, fare: null }, 'public, s-maxage=60');
        }
        // Cached at the edge for an hour: the data is itself a cache, and it keeps us far under the rate limit.
        return send(res, 200, { ok: true, fare: pickFare(await r.json(), q) }, 'public, s-maxage=3600');
    } catch (e) {
        console.warn('[flight-fares] failed', e instanceof Error ? e.name : 'error');
        return send(res, 200, { ok: true, fare: null }, 'public, s-maxage=60');
    }
}
