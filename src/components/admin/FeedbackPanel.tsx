import { useMemo, useState } from 'react';
import { setFeedbackStatus, type FeedbackItem, type FeedbackOverview } from '../../lib/adminApi';
import { Card, Kpi } from './charts';
import { fmt } from './format';
import { pretty } from './labels';

type Filter = 'attention' | 'queue' | 'closed' | 'all';

const FILTERS: [Filter, string][] = [
    ['attention', 'Needs attention'],
    ['queue', 'To review'],
    ['closed', 'Resolved / dismissed'],
    ['all', 'Everything'],
];

const VERDICT_TONE: Record<string, string> = { real_bug: 'bad', likely_bug: 'warn', content_issue: 'warn' };

const open = (f: FeedbackItem) => f.status === 'new' || f.status === 'open';
const FILTER_TEST: Record<Filter, (f: FeedbackItem) => boolean> = {
    attention: (f) => f.escalated && open(f),
    queue: (f) => open(f),
    closed: (f) => !open(f),
    all: () => true,
};

/**
 * Everything visitors sent through the Feedback widget, with what the checks
 * made of it. Escalated reports (bugs backed by evidence) are what get emailed;
 * the rest is kept here so nothing is lost, but does not ask for attention.
 */
export function FeedbackPanel({ data, onChanged }: { data: FeedbackOverview | null; onChanged: () => void }) {
    const [filter, setFilter] = useState<Filter | null>(null);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const active: Filter = filter ?? (data && data.counts.needs_attention > 0 ? 'attention' : 'queue');
    const items = useMemo(() => (data ? data.items.filter(FILTER_TEST[active]) : []), [data, active]);

    if (!data) {
        return (
            <p className="adm-empty">
                Feedback isn’t available yet. If this is the first time, run supabase/migrations/0030_site_feedback.sql in the Supabase SQL editor, then refresh.
            </p>
        );
    }

    const act = async (f: FeedbackItem, status: FeedbackItem['status']) => {
        setBusy(f.id);
        setError(null);
        try {
            await setFeedbackStatus(f.id, status);
            onChanged();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="adm-stack">
            <div className="adm-kpis">
                <Kpi label="Needs attention" value={fmt(data.counts.needs_attention)} tone={data.counts.needs_attention ? 'warn' : 'good'} sub="bugs backed by evidence" />
                <Kpi label="To review" value={fmt(data.counts.unreviewed)} sub="not yet looked at" />
                <Kpi label="Last 30 days" value={fmt(data.counts.last_30d)} sub={data.by_verdict.map((v) => `${v.n} ${pretty(v.verdict).toLowerCase()}`).join(' · ') || undefined} />
                <Kpi label="All time" value={fmt(data.counts.total)} />
            </div>

            <Card title="Reports" hint={`${items.length} shown · latest 300 kept in view`}>
                <div className="adm-tools" role="group" aria-label="Filter reports">
                    {FILTERS.map(([k, l]) => (
                        <button key={k} type="button" className={`adm-btn${active === k ? '' : ' ghost'}`} aria-pressed={active === k}
                            onClick={() => setFilter(k)}>{l}</button>
                    ))}
                </div>
                {error && <p className="adm-err" role="alert">{error}</p>}
                {items.length === 0 && <p className="adm-empty">Nothing here.</p>}
                {items.map((f) => <Report key={f.id} f={f} busy={busy === f.id} act={act} />)}
            </Card>
        </div>
    );
}

function Report({ f, busy, act }: { f: FeedbackItem; busy: boolean; act: (f: FeedbackItem, s: FeedbackItem['status']) => Promise<void> }) {
    const who = f.account_email ?? f.contact_email;
    const closed = f.status === 'resolved' || f.status === 'dismissed';
    return (
        <article className="adm-fb">
            <div className="adm-fb-top">
                {f.verdict && <span className={`adm-badge ${VERDICT_TONE[f.verdict] ?? ''}`}>{pretty(f.verdict)}{f.confidence != null ? ` · ${f.confidence}%` : ''}</span>}
                {f.severity && f.severity !== 'low' && <span className={`adm-badge ${f.severity === 'high' ? 'bad' : 'warn'}`}>{f.severity} severity</span>}
                {f.escalated && <span className="adm-badge bad">{f.notified_at ? 'emailed' : 'escalated'}</span>}
                <span>{pretty(f.kind)} · {f.created_at.slice(0, 16).replace('T', ' ')} UTC</span>
                {f.page_path && <a href={f.page_path} target="_blank" rel="noreferrer">{f.page_path}</a>}
                {closed && <span className="adm-badge">{pretty(f.status)}</span>}
            </div>

            <p className="adm-fb-msg">{f.message}</p>
            {f.reason && <p className="adm-fb-why">Check: {f.reason} <span className="adm-missing">({f.triage_source === 'model' ? 'model' : 'keyword rules'})</span></p>}

            {f.client_errors.length > 0 && (
                <pre className="adm-fb-errs">{f.client_errors.map((e) => `${e.type}  ${e.path}  ${e.msg}`).join('\n')}</pre>
            )}

            <div className="adm-fb-top">
                {who ? <span>{who}</span> : <span>anonymous</span>}
                {f.duplicate_count > 0 && <span>{f.duplicate_count} identical before</span>}
                {f.viewport && <span>{f.viewport}</span>}
                {f.language && <span>{f.language}</span>}
                {f.app_build && <span>build {f.app_build.slice(0, 7)}</span>}
            </div>

            <div className="adm-fb-acts">
                {f.status === 'new' && <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void act(f, 'open')}>Mark in progress</button>}
                {!closed && <button type="button" className="adm-btn" disabled={busy} onClick={() => void act(f, 'resolved')}>Resolved</button>}
                {!closed && <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void act(f, 'dismissed')}>Dismiss</button>}
                {closed && <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void act(f, 'new')}>Reopen</button>}
                {who && <a className="adm-btn ghost" href={`mailto:${who}`}>Reply</a>}
            </div>
        </article>
    );
}
