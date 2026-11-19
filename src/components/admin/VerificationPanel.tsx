import { useCallback, useEffect, useState } from 'react';
import { confirmExactMatches, decideFacility, decideMatch, fetchFacilityQueue, fetchMatchCompare, fetchMatchQueue, fetchNearBar, fetchSources, NEAR_BAR_LIMIT, type AiScore, type FacilityItem, type FacilityQueue, type MatchCompare, type MatchItem, type MatchQueue, type NearBarItem, type SourceOverview } from '../../lib/adminApi';
import { compareRows, defaultCandidate } from './compare';
import { Card, Kpi } from './charts';
import { fmt } from './format';

const PAGE = 50;
/** What PostgREST says when a function is not there yet (migration 0055 unapplied). */
const MISSING_FN = /function .* does not exist|PGRST202|Could not find the function/i;
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
    /** null until loaded; undefined when migration 0055 is not applied yet. */
    const [nearBar, setNearBar] = useState<NearBarItem[] | null | undefined>(null);
    const [nearBarError, setNearBarError] = useState<string | null>(null);
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
            // Its own request: the queue must still load before 0055 is applied.
            // Hidden only when 0055 is missing; any other failure is shown on the card.
            fetchNearBar().then((n) => { setNearBar(n); setNearBarError(null); }, (e: Error) => {
                if (MISSING_FN.test(e.message)) setNearBar(undefined); else { setNearBar([]); setNearBarError(e.message); }
            });
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
        return <p className="adm-empty">Verification isn’t available yet. If this is the first time, apply migrations 0042 to 0045 in supabase/migrations, then refresh. ({error})</p>;
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
                    <button type="button" className={`adm-btn${source === 'doctoralia' ? '' : ' ghost'}`} aria-pressed={source === 'doctoralia'}
                        onClick={() => { setSource('doctoralia'); setOffset(0); }}>Doctoralia: names that disagree</button>
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

            {nearBar !== undefined && (
                <Card title="Near the bar" hint={nearBar ? `${fmt(nearBar.length)}${nearBar.length >= NEAR_BAR_LIMIT ? "+ (showing the first " + fmt(NEAR_BAR_LIMIT) + ")" : ""} scored 70–89 or a cédula conflict · last 14 days` : 'loading'}>
                    <p className="adm-missing">The scorer links at 80 and above. These are the closest calls either side of it, and every cédula conflict; a daily e-mail lists new ones. Linked ones are on the site now: if one is wrong, tell whoever runs the scorer (scorer_split / scorer_undo_run).</p>
                    {nearBarError && <p className="adm-err" role="alert">{nearBarError}</p>}
                    {nearBar?.length === 0 && !nearBarError && <p className="adm-empty">Nothing near the bar.</p>}
                    {nearBar?.map((n) => <NearBar key={`${n.source_slug}:${n.external_id}`} n={n} />)}
                </Card>
            )}

            <Card title="Clinics to review" hint={`${fmt(facilities?.total ?? 0)} waiting`}>
                {!facilities?.items.length && <p className="adm-empty">Nothing to review.</p>}
                {facilities?.items.map((f) => <Clinic key={`${f.source_slug}:${f.external_id}`} f={f} busy={busy !== null} decide={decideClinic} />)}
            </Card>
        </div>
    );
}

const VERDICT: Record<AiScore['verdict'], string> = { approve: 'same', reject: 'different', needs_human: 'unsure' };

/** The AI scorer's view, shown as evidence beside the item (docs/adr/0012). The reviewer still decides. */
function AiLine({ s }: { s: AiScore | null | undefined }) {
    if (!s) return null;
    return (
        <p className="adm-fb-top" title={`${s.model} · run ${s.run} · ${new Date(s.scored_at).toLocaleString()}`}>
            <span className={`adm-badge${s.verdict === 'approve' ? '' : ' warn'}`}>{`AI ${s.score} · ${VERDICT[s.verdict]}`}</span>
            <span>{s.reason}</span>
        </p>
    );
}

/** Marks the candidate the AI scorer judged most likely, when it judged one. */
const aiPick = (s: AiScore | null | undefined, id: string) =>
    s && s.verdict !== 'reject' && s.candidate === id ? <span className="adm-badge">AI pick</span> : null;

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
            <AiLine s={f.ai_score} />
            {f.candidates.map((c) => (
                <div key={c.provider_id} className="adm-fb-acts">
                    <button type="button" className="adm-btn" disabled={busy} onClick={() => void decide(f, 'confirm', c.provider_id)}>Same clinic</button>
                    <span>{c.name} · {percent(c.similarity)}</span>
                    {aiPick(f.ai_score, c.provider_id)}
                    <a href={`/providers/${c.provider_id}`} target="_blank" rel="noreferrer">listing ↗</a>
                </div>
            ))}
            <div className="adm-fb-acts">
                <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void decide(f, 'reject')}>Not this clinic</button>
            </div>
        </article>
    );
}

/** A record scored near the bar, with its side-by-side on demand. */
function NearBar({ n }: { n: NearBarItem }) {
    return (
        <article className="adm-fb">
            <div className="adm-fb-top">
                <span className={`adm-badge${n.score >= 80 ? ' ok' : ' warn'}`}>{`AI ${n.score}`}</span>
                {n.tier === 1 && <span className="adm-badge bad">cédula conflict</span>}
                <span className="adm-badge">{n.linked ? 'linked, badge live' : n.status === 'confirmed' ? 'confirmed' : 'waiting'}</span>
                <span>{n.source_slug}</span>
                <span>{new Date(n.scored_at).toLocaleDateString()}</span>
            </div>
            <p className="adm-fb-msg"><strong>{n.name}</strong>{n.candidate && <> → {n.candidate}</>}</p>
            <p className="adm-fb-top"><span>{n.reason}</span></p>
            <CompareToggle source={n.source_slug} external={n.external_id} />
        </article>
    );
}

function CompareToggle({ source, external }: { source: string; external: string }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <div className="adm-fb-acts">
                <button type="button" className="adm-btn ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide comparison' : 'Compare side by side'}</button>
            </div>
            {open && <SideBySide source={source} external={external} />}
        </>
    );
}

/**
 * The source record and one candidate doctor, field by field, with what
 * disagrees highlighted (migration 0055). Loads when opened.
 */
function SideBySide({ source, external }: { source: string; external: string }) {
    const [c, setC] = useState<MatchCompare | null | undefined>(undefined);
    const [err, setErr] = useState<string | null>(null);
    const [pick, setPick] = useState<string | null>(null);
    useEffect(() => {
        let live = true;
        fetchMatchCompare(source, external).then((r) => { if (live) setC(r); }, (e: Error) => { if (live) setErr(e.message); });
        return () => { live = false; };
    }, [source, external]);

    if (err) return <p className="adm-err" role="alert">{MISSING_FN.test(err) ? 'Needs migration 0055 (supabase/migrations/0055_review_compare.sql).' : err}</p>;
    if (c === undefined) return <p className="adm-empty">Loading comparison…</p>;
    if (!c || !c.candidates.length) return <p className="adm-empty">No candidate doctor to compare with.</p>;
    const cand = c.candidates.find((x) => x.doctor_id === pick) ?? defaultCandidate(c)!;
    const rows = compareRows(c, cand);
    const differs = rows.filter((r) => r.state === 'differs').length;

    return (
        <div className="adm-compare">
            {c.candidates.length > 1 && (
                <div className="adm-tools" role="group" aria-label="Candidate">
                    {c.candidates.map((x) => (
                        <button key={x.doctor_id} type="button" className={`adm-btn${x.doctor_id === cand.doctor_id ? '' : ' ghost'}`}
                            aria-pressed={x.doctor_id === cand.doctor_id} onClick={() => setPick(x.doctor_id)}>
                            {x.display_name}{x.linked ? ' · linked' : ''}{c.ai?.candidate === x.doctor_id ? ' · AI pick' : ''}
                        </button>
                    ))}
                </div>
            )}
            <div className="adm-tablewrap">
                <table className="adm-table">
                    <thead><tr><th scope="col"></th><th scope="col">Source record</th><th scope="col">{cand.linked ? 'Linked doctor' : 'Candidate doctor'}</th></tr></thead>
                    <tbody>
                        {rows.map((r) => (
                            <tr key={r.label} className={r.state === 'differs' ? 'is-differs' : r.state === 'same' ? 'is-same' : undefined}>
                                <th scope="row">{r.label}{r.state === 'differs' && <span className="adm-badge bad">differs</span>}{r.state === 'same' && <span className="adm-badge ok">same</span>}</th>
                                <td>{r.record}</td>
                                <td>{r.candidate}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <p className="adm-missing">
                {differs ? `${differs} field${differs > 1 ? 's' : ''} disagree.` : 'Nothing the two sides both hold disagrees.'}
                {c.ai && ` AI ${c.ai.score} (${VERDICT[c.ai.verdict]}): ${c.ai.reason}`}
                {c.link && ` Linked by the scorer at ${c.link.score}, ${new Date(c.link.linked_at).toLocaleDateString()}.`}
                {' '}{cand.listings.slice(0, 3).map((l) => <a key={l.id} href={`/providers/${l.id}`} target="_blank" rel="noreferrer">{l.name} ↗ </a>)}
            </p>
        </div>
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
            <AiLine s={m.ai_score} />
            <CompareToggle source={m.source_slug} external={m.external_id} />
            {m.candidates.map((c) => (
                <div key={c.doctor_id} className="adm-fb-acts">
                    <button type="button" className="adm-btn" disabled={busy} onClick={() => void decide(m, 'confirm', c.doctor_id)}>Same doctor</button>
                    <span>{c.display_name} · {percent(c.similarity)}</span>
                    {aiPick(m.ai_score, c.doctor_id)}
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
