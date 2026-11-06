import { useCallback, useEffect, useState } from 'react';
import { confirmExactMatches, decideFacility, decideMatch, fetchFacilityQueue, fetchMatchQueue, fetchSources, type FacilityItem, type FacilityQueue, type MatchItem, type MatchQueue, type SourceOverview } from '../../lib/adminApi';
import { Card, Kpi } from './charts';
import { fmt } from './format';

const PAGE = 50;
const percent = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

/**
 * The doctor-matching review queue. A source record that carries a cédula we
 * hold confirms itself; everything else waits here, because a name alone is
 * never proof (docs/adr/0004). One decision per record: later runs reuse it.
 */
export function VerificationPanel() {
    const [sources, setSources] = useState<SourceOverview[] | null>(null);
    const [queue, setQueue] = useState<MatchQueue | null>(null);
    const [facilities, setFacilities] = useState<FacilityQueue | null>(null);
    const [source, setSource] = useState<string | null>(null);
    const [offset, setOffset] = useState(0);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [s, q, f] = await Promise.all([fetchSources(), fetchMatchQueue(source, PAGE, offset), fetchFacilityQueue()]);
            setSources(s);
            setQueue(q);
            setFacilities(f);
            setError(null);
        } catch (e) {
            setError((e as Error).message);
        }
    }, [source, offset]);

    useEffect(() => { void load(); }, [load]);

    const decide = async (item: MatchItem, decision: 'confirm' | 'reject', doctor?: string) => {
        setBusy(item.external_id);
        try {
            await decideMatch(item.source_slug, item.external_id, decision, doctor);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    const decideClinic = async (item: FacilityItem, decision: 'confirm' | 'reject', provider?: string) => {
        setBusy(item.external_id);
        try {
            await decideFacility(item.source_slug, item.external_id, decision, provider);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    const bulk = async () => {
        if (!source || !queue) return;
        if (!window.confirm(`Confirm all ${queue.exact} exact-name matches for ${source}? Each counts as your decision.`)) return;
        setBusy('bulk');
        try {
            await confirmExactMatches(source);
            await load();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    if (error && !sources) {
        return <p className="adm-empty">Verification isn’t available yet. If this is the first time, apply supabase/migrations/0035_doctors_sources_badges.sql and 0036_facility_badges.sql, then refresh. ({error})</p>;
    }
    if (!sources || !queue) return <p className="adm-empty">Loading data…</p>;

    return (
        <div className="adm-stack">
            <div className="adm-kpis">
                {sources.map((s) => (
                    <Kpi key={s.slug} label={s.name} value={fmt(s.badges)} tone={s.last_run?.status === 'red' ? 'warn' : undefined}
                        sub={`badges · ${fmt(s.matches.probable ?? 0)} to review · ${fmt(s.matches.unmatched ?? 0)} unmatched`} />
                ))}
            </div>

            <Card title="To review" hint={`${fmt(queue.total)} waiting · ${fmt(queue.exact)} with an exact name`}>
                <div className="adm-tools" role="group" aria-label="Filter by source">
                    <button type="button" className={`adm-btn${source === null ? '' : ' ghost'}`} aria-pressed={source === null}
                        onClick={() => { setSource(null); setOffset(0); }}>All sources</button>
                    {sources.map((s) => (
                        <button key={s.slug} type="button" className={`adm-btn${source === s.slug ? '' : ' ghost'}`} aria-pressed={source === s.slug}
                            onClick={() => { setSource(s.slug); setOffset(0); }}>{s.name}</button>
                    ))}
                    {source && queue.exact > 0 && (
                        <button type="button" className="adm-btn" disabled={busy !== null} onClick={() => void bulk()}>Confirm {fmt(queue.exact)} exact names</button>
                    )}
                </div>
                {error && <p className="adm-err" role="alert">{error}</p>}
                {queue.items.length === 0 && <p className="adm-empty">Nothing to review.</p>}
                {queue.items.map((m) => <Match key={`${m.source_slug}:${m.external_id}`} m={m} busy={busy !== null} decide={decide} />)}
                {queue.total > PAGE && (
                    <div className="adm-tools">
                        <button type="button" className="adm-btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
                        <span className="adm-missing">{offset + 1}–{Math.min(offset + PAGE, queue.total)} of {fmt(queue.total)}</span>
                        <button type="button" className="adm-btn ghost" disabled={offset + PAGE >= queue.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
                    </div>
                )}
            </Card>

            <Card title="Clinics to review" hint={`${fmt(facilities?.total ?? 0)} waiting`}>
                {!facilities?.items.length && <p className="adm-empty">Nothing to review.</p>}
                {facilities?.items.map((f) => <Clinic key={`${f.source_slug}:${f.external_id}`} f={f} busy={busy !== null} decide={decideClinic} />)}
            </Card>
        </div>
    );
}

/** A clinic record that only matched by name. A register number would have confirmed it (docs/adr/0008). */
function Clinic({ f, busy, decide }: { f: FacilityItem; busy: boolean; decide: (f: FacilityItem, d: 'confirm' | 'reject', provider?: string) => Promise<void> }) {
    return (
        <article className="adm-fb">
            <div className="adm-fb-top">
                <span className="adm-badge">{f.source_slug}</span>
                <span className="adm-badge">{`name ${percent(f.confidence)}`}</span>
                {f.url && <a href={f.url} target="_blank" rel="noreferrer">source ↗</a>}
            </div>
            <p className="adm-fb-msg"><strong>{f.name}</strong></p>
            <div className="adm-fb-top">
                {f.facts?.register && <span>register {f.facts.register}</span>}
                {f.valid_to && <span>valid to {f.valid_to}</span>}
            </div>
            {f.candidates.map((c) => (
                <div key={c.provider_id} className="adm-fb-acts">
                    <button type="button" className="adm-btn" disabled={busy} onClick={() => void decide(f, 'confirm', c.provider_id)}>Same clinic</button>
                    <span>{c.name} · {percent(c.similarity)}</span>
                    <a href={`/providers/${c.provider_id}`} target="_blank" rel="noreferrer">listing ↗</a>
                </div>
            ))}
            <div className="adm-fb-acts">
                <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void decide(f, 'reject')}>Not this clinic</button>
            </div>
        </article>
    );
}

function Match({ m, busy, decide }: { m: MatchItem; busy: boolean; decide: (m: MatchItem, d: 'confirm' | 'reject', doctor?: string) => Promise<void> }) {
    return (
        <article className="adm-fb">
            <div className="adm-fb-top">
                <span className="adm-badge">{m.source_slug}</span>
                <span className={`adm-badge${m.tier === 1 ? ' warn' : ''}`}>{m.tier === 1 ? 'cédula, check the name' : `name ${percent(m.confidence)}`}</span>
                {m.url && <a href={m.url} target="_blank" rel="noreferrer">source ↗</a>}
            </div>
            <p className="adm-fb-msg"><strong>{m.name}</strong></p>
            <div className="adm-fb-top">
                <span>{m.specialties.join(', ') || 'no specialty'}</span>
                {m.label && <span>{m.label}</span>}
                {m.region && <span>{m.region}</span>}
                {m.cedulas.length > 0 && <span>cédula {m.cedulas.join(', ')}</span>}
                {m.facts?.consejo && <span>{m.facts.consejo}</span>}
                {m.valid_to && <span>valid to {m.valid_to}</span>}
            </div>
            {m.candidates.map((c) => (
                <div key={c.doctor_id} className="adm-fb-acts">
                    <button type="button" className="adm-btn" disabled={busy} onClick={() => void decide(m, 'confirm', c.doctor_id)}>Same doctor</button>
                    <span>{c.display_name} · {percent(c.similarity)}</span>
                    {c.specialties.length > 0 && <span className="adm-missing">{c.specialties.join(', ')}</span>}
                    {c.regions.length > 0 && <span className="adm-missing">{c.regions.join(', ')}</span>}
                    {c.listings.slice(0, 2).map((id) => <a key={id} href={`/providers/${id}`} target="_blank" rel="noreferrer">listing ↗</a>)}
                </div>
            ))}
            <div className="adm-fb-acts">
                <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void decide(m, 'reject')}>Not this doctor</button>
            </div>
        </article>
    );
}
