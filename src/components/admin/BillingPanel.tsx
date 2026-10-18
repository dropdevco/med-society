import { useCallback, useEffect, useState } from 'react';
import {
    fetchBilling, resolveBillingEvent, searchProviders,
    type BillingEvent, type BillingOverview, type ProviderHit,
} from '../../lib/adminApi';
import { Card, Kpi } from './charts';
import { fmt } from './format';
import { pretty } from './labels';

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '–');

/**
 * Paid plans: who is paying, what the system could not place, and whether GHL
 * and the directory still agree. Normally everything here is automatic; this
 * tab exists for the payment nobody could be matched to.
 */
export function BillingPanel() {
    const [data, setData] = useState<BillingOverview | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        fetchBilling().then((d) => { setData(d); setError(null); }).catch((e: Error) => setError(e.message));
    }, []);
    useEffect(() => { load(); }, [load]);

    if (error) return <p className="adm-err" role="alert">Could not load billing: {error}</p>;
    if (!data) return <p className="adm-empty">Loading billing…</p>;

    const active = data.subscriptions.filter((s) => s.access && s.status !== 'comp');
    const unsynced = data.subscriptions.filter((s) => s.ghl_dirty);
    const money = (cur: string) => active.filter((s) => (s.currency ?? '').toUpperCase() === cur)
        .reduce((t, s) => t + (s.last_amount ?? 0), 0);

    return (
        <div className="adm-stack">
            <div className="adm-kpis">
                <Kpi label="Paying now" value={fmt(active.length)} sub={`${fmt(data.subscriptions.filter((s) => s.status === 'comp').length)} comped`} tone={active.length ? 'good' : undefined} />
                <Kpi label="Monthly, USD" value={`$${fmt(money('USD'))}`} sub="last payment of each active plan" />
                <Kpi label="Monthly, MXN" value={`$${fmt(money('MXN'))}`} sub="last payment of each active plan" />
                <Kpi label="Payments to place" value={fmt(data.needs_attention.length)} tone={data.needs_attention.length ? 'warn' : 'good'} sub="could not match to a listing" />
                <Kpi label="Waiting on GHL" value={fmt(unsynced.length)} tone={unsynced.length ? 'warn' : 'good'} sub="retried every morning" />
                <Kpi label="Tier drift" value={fmt(data.tier_drift.length)} tone={data.tier_drift.length ? 'warn' : 'good'} sub="should always be 0" />
            </div>

            {data.needs_attention.length > 0 && (
                <Card title="Payments that need a listing" hint="attach once; this person's later payments match by themselves">
                    {data.needs_attention.map((e) => <Unplaced key={e.id} ev={e} onDone={load} />)}
                </Card>
            )}

            {data.tier_drift.length > 0 && (
                <Card title="Listings whose plan disagrees with their payments">
                    <ul className="adm-attn">
                        {data.tier_drift.map((d) => <li key={d.provider_id}>{d.name} shows “{d.tier}”. The daily sync repairs this.</li>)}
                    </ul>
                </Card>
            )}

            <Card title="Subscriptions" wide>
                {data.subscriptions.length === 0 ? <p className="adm-empty">No payments yet.</p> : (
                    data.subscriptions.map((s) => (
                        <div className="adm-line" key={s.id}>
                            <b>
                                <a href={`/providers/${s.provider_id}`} target="_blank" rel="noreferrer">{s.provider_name}</a>
                                {' · '}{pretty(s.plan)}{s.market ? ` ${s.market.toUpperCase()}` : ''} · {pretty(s.status)}{s.access ? '' : ' (no access)'}
                            </b>
                            <span>
                                {s.status === 'comp' ? 'no end date' : `paid through ${day(s.paid_through)}`}
                                {' · last '}{s.last_amount != null ? `${s.last_amount} ${s.currency ?? ''}` : '–'} on {day(s.last_payment_at)}
                                {' · '}{s.payer_email ?? 'no payer email'}
                                {' · GHL '}{s.ghl_error ? `error: ${s.ghl_error}` : s.ghl_dirty ? 'pending' : 'synced'}
                            </span>
                        </div>
                    ))
                )}
            </Card>

            <Card title="Recent webhook events" hint="last 50" wide>
                {data.recent_events.length === 0 ? <p className="adm-empty">Nothing received yet. Send a test payment through the GHL workflow.</p> : data.recent_events.map((e) => (
                    <div className="adm-line" key={e.id}>
                        <b>{pretty(e.kind)} · {e.plan ? pretty(e.plan) : 'plan ?'}{e.market ? ` · ${e.market.toUpperCase()}` : ''} → {pretty(e.outcome)}</b>
                        <span>
                            {e.created_at.slice(0, 16).replace('T', ' ')} · {e.payer_email ?? 'no email'}
                            {e.provider_name ? ` · ${e.provider_name}` : ''}
                            {e.match_method ? ` · matched by ${e.match_method.replace('_', ' ')}` : ''}
                            {e.detail ? ` · ${e.detail}` : ''}
                        </span>
                    </div>
                ))}
            </Card>
        </div>
    );
}

function Unplaced({ ev, onDone }: { ev: BillingEvent; onDone: () => void }) {
    const [q, setQ] = useState('');
    const [hits, setHits] = useState<ProviderHit[]>([]);
    const [plan, setPlan] = useState(ev.plan ?? 'promoted');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    useEffect(() => {
        if (q.trim().length < 2) return;
        let cancelled = false;
        const id = window.setTimeout(() => {
            searchProviders(q).then((h) => { if (!cancelled) setHits(h); }).catch(() => undefined);
        }, 250);
        return () => { cancelled = true; window.clearTimeout(id); };
    }, [q]);

    const attach = async (pid: string) => {
        setBusy(true);
        setMsg(null);
        try {
            const r = await resolveBillingEvent(ev.id, pid, ev.plan ? null : plan);
            if (r.outcome === 'applied' || r.outcome === 'duplicate_period' || r.outcome === 'noted') onDone();
            else setMsg(`${r.outcome}${r.detail ? `: ${r.detail}` : ''}`);
        } catch (e) {
            setMsg((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="adm-stack" style={{ padding: '0.7rem 0' }}>
            <div className="adm-line">
                <b>{pretty(ev.kind)} · {ev.plan ? pretty(ev.plan) : 'plan not sent'}{ev.market ? ` · ${ev.market.toUpperCase()}` : ''} · {ev.amount != null ? `${ev.amount} ${ev.currency ?? ''}` : 'amount unknown'}</b>
                <span>{ev.created_at.slice(0, 16).replace('T', ' ')} · {ev.payer_email ?? 'no email'} {ev.payer_phone ?? ''} · {ev.detail ?? pretty(ev.outcome)}</span>
            </div>
            <div className="adm-filters">
                {!ev.plan && (
                    <label className="adm-sel"><span>Plan</span>
                        <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                            <option value="promoted">Promoted</option>
                            <option value="featured">Featured</option>
                        </select>
                    </label>
                )}
                <label className="adm-sel"><span>Find the clinic</span>
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, email, phone or website" />
                </label>
            </div>
            {q.trim().length >= 2 && hits.map((h) => (
                <div className="adm-line" key={h.id}>
                    <b>{h.name}</b>
                    <span>{[h.city, h.country].filter(Boolean).join(', ')} · {h.claimed ? 'claimed' : 'unclaimed'} · {h.phone ?? 'no phone'}</span>
                    <button type="button" className="adm-btn" disabled={busy} onClick={() => void attach(h.id)}>Attach payment</button>
                </div>
            ))}
            {msg && <p className="adm-err" role="alert">{msg}</p>}
        </div>
    );
}
