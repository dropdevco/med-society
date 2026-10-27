import { useMemo, useState } from 'react';
import type { FormsOverview, ResponseRow } from '../../lib/adminApi';
import { Card, DailyChart, Funnel, HBars, Kpi } from './charts';
import { SERIES, fmt, pct, type Series } from './format';
import { QUESTIONS, SEGMENTS, SEGMENT_LABEL, SLUG_LABEL, STATE_LABEL, answerLabel, flattenAnswer, pretty, questionLabel } from './labels';

function sum<T>(rows: T[], f: (r: T) => number | null | undefined): number {
    return rows.reduce((s, r) => s + (f(r) ?? 0), 0);
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
    return (
        <label className="adm-sel">
            <span>{label}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
        </label>
    );
}

const SLUG_OPTS: [string, string][] = [['all', 'All forms'], ...Object.entries(SLUG_LABEL)];
const SEG_OPTS: [string, string][] = [['all', 'All audiences'], ...SEGMENTS.map((s) => [s, SEGMENT_LABEL[s]] as [string, string])];
const LANG_OPTS: [string, string][] = [['all', 'EN + ES'], ['en', 'English'], ['es', 'Spanish']];

function group<T>(rows: T[], key: (r: T) => string, val: (r: T) => number) {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

/** Who opens each form, how far they get, and where they come from. */
export function TrafficPanel({ data }: { data: FormsOverview }) {
    const [slug, setSlug] = useState('all');
    const [seg, setSeg] = useState('all');
    const [lang, setLang] = useState('all');
    const ok = (r: { form_slug: string; form_segment: string; lang: string }) =>
        (slug === 'all' || r.form_slug === slug) && (seg === 'all' || r.form_segment === seg) && (lang === 'all' || r.lang === lang);

    const summary = data.summary.filter(ok);
    const visits = sum(summary, (r) => r.visits);
    const submitted = sum(summary, (r) => r.submissions);
    const started = sum(summary, (r) => r.started);
    const secs = summary.filter((r) => r.avg_seconds_to_submit != null && r.submissions > 0);
    const avgSecs = secs.length ? Math.round(sum(secs, (r) => (r.avg_seconds_to_submit ?? 0) * r.submissions) / sum(secs, (r) => r.submissions)) : null;

    const funnel = useMemo(() => {
        const rows = data.funnel.filter(ok);
        const byScreen = new Map<number, { reached: number; ids: Set<string>; errors: number }>();
        for (const r of rows) {
            const e = byScreen.get(r.screen_no) ?? { reached: 0, ids: new Set<string>(), errors: 0 };
            e.reached += r.visits_reached;
            e.errors += r.validation_errors;
            e.ids.add(r.step_id);
            byScreen.set(r.screen_no, e);
        }
        const steps = [{ label: 'Opened the form', value: visits }];
        for (const [n, e] of [...byScreen.entries()].sort((a, b) => a[0] - b[0])) {
            steps.push({ label: `Screen ${n}${seg !== 'all' ? ` (${pretty([...e.ids][0])})` : ''}`, value: e.reached, sub: e.errors ? `${e.errors} validation errors` : '' } as typeof steps[number]);
        }
        steps.push({ label: 'Submitted', value: submitted });
        return steps;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, slug, seg, lang, visits, submitted]);

    const daily = data.daily.filter(ok);
    const dayMap = (f: (r: (typeof daily)[number]) => number): Map<string, number> => {
        const m = new Map<string, number>();
        for (const r of daily) m.set(r.day, (m.get(r.day) ?? 0) + f(r));
        return m;
    };
    const series: Series[] = [
        { name: 'Visits', color: SERIES[0], byDay: dayMap((r) => r.visits) },
        { name: 'Submissions', color: SERIES[1], byDay: dayMap((r) => r.submissions) },
    ];

    const sources = useMemo(() => {
        const m = new Map<string, { ref: string; src: string; med: string; camp: string; content: string; visits: number; uniq: number; started: number; subs: number }>();
        for (const r of data.by_source.filter(ok)) {
            const k = [r.ref, r.utm_source, r.utm_medium, r.utm_campaign, r.utm_content, r.utm_term, r.referrer_host].join('|');
            const e = m.get(k) ?? {
                ref: r.ref ?? 'link', src: r.utm_source ?? r.referrer_host ?? 'direct', med: r.utm_medium ?? '', camp: r.utm_campaign ?? '',
                content: [r.utm_content, r.utm_term].filter(Boolean).join(' / '), visits: 0, uniq: 0, started: 0, subs: 0,
            };
            e.visits += r.visits; e.uniq += r.unique_visitors; e.started += r.started; e.subs += r.submissions;
            m.set(k, e);
        }
        return [...m.values()].sort((a, b) => b.visits - a.visits);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, slug, seg, lang]);

    const aud = data.audience.filter(ok);

    return (
        <div className="adm-stack">
            <div className="adm-filters">
                <Select label="Form" value={slug} onChange={setSlug} options={SLUG_OPTS} />
                <Select label="Audience" value={seg} onChange={setSeg} options={SEG_OPTS} />
                <Select label="Language" value={lang} onChange={setLang} options={LANG_OPTS} />
            </div>

            <div className="adm-kpis">
                <Kpi label="Page opens" value={fmt(sum(summary, (r) => r.page_opens))} sub="every load, incl. repeats" />
                <Kpi label="Visits" value={fmt(visits)} sub="distinct sessions" />
                <Kpi label="Unique visitors" value={fmt(sum(summary, (r) => r.unique_visitors))} sub="per device" />
                <Kpi label="Started" value={fmt(started)} sub={`${pct(started, visits)} of visits`} />
                <Kpi label="Submitted" value={fmt(submitted)} sub={`${pct(submitted, visits)} of visits`} tone={submitted > 0 ? 'good' : undefined} />
                <Kpi label="Abandoned" value={fmt(sum(summary, (r) => r.abandoned))} sub="started, never sent" />
                <Kpi label="Avg time to submit" value={avgSecs != null ? `${Math.floor(avgSecs / 60)}m ${avgSecs % 60}s` : '–'} />
                <Kpi label="Send errors" value={fmt(sum(summary, (r) => r.visits_with_send_error))} sub="visits that hit one" tone={sum(summary, (r) => r.visits_with_send_error) > 0 ? 'warn' : undefined} />
            </div>

            <div className="adm-grid2">
                <Card title="Visits and submissions per day" hint="last 90 days · test sessions and bots excluded">
                    <DailyChart series={series} />
                </Card>
                <Card title="Where people drop off" hint="visits reaching each screen">
                    <Funnel steps={funnel} />
                </Card>
            </div>

            <Card title="Traffic sources" hint="who sent them: ?by=, utm_*, referrer" wide>
                <div className="adm-tablewrap">
                    <table className="adm-table">
                        <thead><tr><th>Ref</th><th>Source</th><th>Medium</th><th>Campaign</th><th>Content / term</th><th className="n">Visits</th><th className="n">Unique</th><th className="n">Started</th><th className="n">Submitted</th><th className="n">Conv.</th></tr></thead>
                        <tbody>
                            {sources.length === 0 && <tr><td colSpan={10} className="adm-empty">No traffic yet</td></tr>}
                            {sources.map((s, i) => (
                                <tr key={i}>
                                    <td>{s.ref}</td><td>{s.src}</td><td>{s.med || '–'}</td><td>{s.camp || '–'}</td><td>{s.content || '–'}</td>
                                    <td className="n">{fmt(s.visits)}</td><td className="n">{fmt(s.uniq)}</td><td className="n">{fmt(s.started)}</td><td className="n">{fmt(s.subs)}</td><td className="n">{pct(s.subs, s.visits)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <div className="adm-grid3">
                <Card title="Country"><HBars rows={group(aud, (r) => r.country ?? 'unknown', (r) => r.visits)} limit={8} /></Card>
                <Card title="City"><HBars rows={group(aud, (r) => [r.city, r.region].filter(Boolean).join(', ') || 'unknown', (r) => r.visits)} limit={8} /></Card>
                <Card title="Device"><HBars rows={group(aud, (r) => r.device_type ?? 'unknown', (r) => r.visits)} limit={8} /></Card>
                <Card title="Browser"><HBars rows={group(aud, (r) => r.browser ?? 'unknown', (r) => r.visits)} limit={8} /></Card>
                <Card title="Operating system"><HBars rows={group(aud, (r) => r.os ?? 'unknown', (r) => r.visits)} limit={8} /></Card>
                <Card title="Language"><HBars rows={group(summary, (r) => (r.lang === 'es' ? 'Spanish' : 'English'), (r) => r.visits)} /></Card>
            </div>
        </div>
    );
}

function csvCell(v: unknown): string {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: ResponseRow[]) {
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r.answers ?? {})))].sort();
    const head = ['id', 'created_at', 'form', 'audience', 'lang', 'ref', 'session', 'name', 'organization', 'email', 'phone', 'follow_up', 'duration_s', 'outcome', ...keys];
    const lines = [head.join(',')];
    for (const r of rows) {
        lines.push([r.id, r.created_at, r.form_slug, r.segment, r.lang, r.ref, r.session, r.contact_name, r.contact_org, r.contact_email, r.contact_phone, r.follow_up, r.duration_s, r.outcome, ...keys.map((k) => flattenAnswer(r.segment, k, r.answers?.[k] ?? ''))].map(csvCell).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'medsociety-survey-responses.csv';
    a.click();
    URL.revokeObjectURL(url);
}

/** What people answered: totals, per-question breakdowns, and every response. */
export function ResponsesPanel({ data }: { data: FormsOverview }) {
    const [slug, setSlug] = useState('all');
    const [seg, setSeg] = useState<string>('provider');
    const [showTest, setShowTest] = useState(false);
    const [q, setQ] = useState('');
    const [open, setOpen] = useState<number | null>(null);

    const by = data.responses_by.filter((r) => slug === 'all' || r.form_slug === slug);
    const total = sum(by, (r) => r.n);
    const followUps = sum(by, (r) => r.follow_up);
    const dur = by.filter((r) => r.avg_duration_s != null);
    const avgDur = dur.length ? Math.round(sum(dur, (r) => (r.avg_duration_s ?? 0) * r.n) / sum(dur, (r) => r.n)) : null;

    const dayMap = (s: string) => new Map(data.responses_daily.filter((r) => r.segment === s).map((r) => [r.day, r.n]));
    const series: Series[] = SEGMENTS.map((s, i) => ({ name: SEGMENT_LABEL[s], color: SERIES[i], byDay: dayMap(s) }));

    const answerRows = data.answers.filter((a) => a.segment === seg);
    const questions = QUESTIONS[seg] ?? [];
    const segTotal = sum(data.responses_by.filter((r) => r.segment === seg && (slug === 'all' || r.form_slug === slug)), (r) => r.n);

    const rows = data.recent
        .filter((r) => (slug === 'all' || r.form_slug === slug) && (showTest || r.session !== 'test'))
        .filter((r) => !q || [r.contact_name, r.contact_org, r.contact_email, r.contact_phone, r.city, r.industry, r.ref].some((v) => (v ?? '').toLowerCase().includes(q.toLowerCase())));

    return (
        <div className="adm-stack">
            <div className="adm-filters">
                <Select label="Form" value={slug} onChange={setSlug} options={SLUG_OPTS} />
                <Select label="Audience (breakdowns)" value={seg} onChange={setSeg} options={SEG_OPTS.slice(1)} />
            </div>

            <div className="adm-kpis">
                <Kpi label="Responses" value={fmt(total)} sub={`${fmt(data.responses_test)} test rows hidden`} tone={total > 0 ? 'good' : undefined} />
                {SEGMENTS.map((s) => <Kpi key={s} label={SEGMENT_LABEL[s]} value={fmt(sum(by.filter((r) => r.segment === s), (r) => r.n))} />)}
                <Kpi label="Said yes to follow-up" value={fmt(followUps)} sub={pct(followUps, total)} />
                <Kpi label="Avg time to complete" value={avgDur != null ? `${Math.floor(avgDur / 60)}m ${avgDur % 60}s` : '–'} />
            </div>

            <div className="adm-grid2">
                <Card title="Responses per day" hint="last 90 days"><DailyChart series={series} /></Card>
                <Card title="Where responses came from" hint="?by= value">
                    <HBars rows={data.by_ref.map((r) => ({ label: r.ref, value: r.n }))} total={data.responses_total || undefined} limit={8} />
                </Card>
            </div>

            <div className="adm-grid3">
                <Card title={`City · ${SEGMENT_LABEL[seg]}`}><HBars rows={data.by_city.filter((r) => r.segment === seg).map((r) => ({ label: pretty(r.city), value: r.n }))} limit={8} /></Card>
                <Card title={`Industry · ${SEGMENT_LABEL[seg]}`}><HBars rows={data.by_industry.filter((r) => r.segment === seg).map((r) => ({ label: pretty(r.industry), value: r.n }))} limit={8} /></Card>
                <Card title={`State · ${SEGMENT_LABEL[seg]}`} hint="optional question">
                    <HBars rows={answerRows.filter((a) => a.q === 'state_key').map((a) => ({ label: STATE_LABEL[a.v] ?? a.v, value: a.n })).sort((a, b) => b.value - a.value)} limit={10} empty="No state answers yet (the question is new)" />
                </Card>
                <Card title={`Country · ${SEGMENT_LABEL[seg]}`} hint="from the state answer">
                    <HBars rows={answerRows.filter((a) => a.q === 'state_country').map((a) => ({ label: a.v, value: a.n })).sort((a, b) => b.value - a.value)} empty="No state answers yet" />
                </Card>
                {seg === 'provider' && (
                    <Card title="What providers did next" hint="claim, list, or neither">
                        <HBars rows={data.outcomes.filter((r) => r.segment === 'provider').map((r) => ({ label: pretty(r.outcome), value: r.n }))} />
                    </Card>
                )}
            </div>

            <Card title={`Every question · ${SEGMENT_LABEL[seg]}`} hint={`${segTotal} responses`} wide>
                {segTotal === 0 && <p className="adm-empty">No responses from this audience yet.</p>}
                <div className="adm-qgrid">
                    {questions.map((m) => {
                        const rowsQ = answerRows.filter((a) => a.q === m.id).sort((a, b) => b.n - a.n);
                        if (!rowsQ.length) return null;
                        const asList = m.kind === 'text' || m.kind === 'textarea';
                        return (
                            <div className="adm-q" key={m.id}>
                                <h4>{questionLabel(seg, m.id)}</h4>
                                {asList
                                    ? <ul className="adm-quotes">{rowsQ.slice(0, 12).map((a) => <li key={a.v}>{a.v}{a.n > 1 ? <em> ×{a.n}</em> : null}</li>)}</ul>
                                    : <HBars rows={rowsQ.map((a) => ({ label: answerLabel(seg, m.id, a.v), value: a.n }))} total={segTotal} limit={6} />}
                            </div>
                        );
                    })}
                </div>
            </Card>

            <Card title="All responses" hint={`latest ${data.recent.length}`} wide>
                <div className="adm-tools">
                    <input className="adm-input" aria-label="Search responses" placeholder="Search name, company, email, phone, city…" value={q} onChange={(e) => setQ(e.target.value)} />
                    <label className="adm-check"><input type="checkbox" checked={showTest} onChange={(e) => setShowTest(e.target.checked)} /> Show test rows</label>
                    <button type="button" className="adm-btn" onClick={() => downloadCsv(rows)} disabled={!rows.length}>Download CSV ({rows.length})</button>
                </div>
                <div className="adm-tablewrap">
                    <table className="adm-table">
                        <thead><tr><th>When</th><th>Form</th><th>Audience</th><th>Lang</th><th>Name</th><th>Organization</th><th>Contact</th><th>City</th><th>Follow-up</th><th>Via</th></tr></thead>
                        <tbody>
                            {rows.length === 0 && <tr><td colSpan={10} className="adm-empty">No responses match</td></tr>}
                            {rows.map((r) => (
                                <ResponseRowView key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
}

function ResponseRowView({ r, open, onToggle }: { r: ResponseRow; open: boolean; onToggle: () => void }) {
    const entries = Object.entries(r.answers ?? {}).filter(([k]) => k !== 'utm');
    const utm = r.answers?.utm && typeof r.answers.utm === 'object' ? Object.entries(r.answers.utm as Record<string, string>) : [];
    return (
        <>
            <tr className={`adm-click${r.session === 'test' ? ' adm-testrow' : ''}`} onClick={onToggle} tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }} aria-expanded={open}>
                <td>{r.created_at.slice(0, 16).replace('T', ' ')}</td>
                <td>{r.form_slug}</td><td>{SEGMENT_LABEL[r.segment] ?? r.segment}</td><td>{r.lang}</td>
                <td>{r.contact_name || '–'}</td><td>{r.contact_org || '–'}</td>
                <td>{[r.contact_email, r.contact_phone].filter(Boolean).join(' · ') || '–'}</td>
                <td>{r.city || '–'}</td><td>{r.follow_up == null ? '–' : r.follow_up ? 'Yes' : 'No'}</td><td>{r.ref ?? 'link'}</td>
            </tr>
            {open && (
                <tr className="adm-detail">
                    <td colSpan={10}>
                        <dl className="adm-dl">
                            {entries.map(([k, v]) => (
                                <div key={k}><dt>{questionLabel(r.segment, k)}</dt><dd>{flattenAnswer(r.segment, k, v) || '–'}</dd></div>
                            ))}
                            {utm.length > 0 && <div><dt>Campaign tags</dt><dd>{utm.map(([k, v]) => `${k.replace('utm_', '')}: ${v}`).join(' · ')}</dd></div>}
                            {r.outcome && <div><dt>Onboarding outcome</dt><dd>{pretty(r.outcome)}</dd></div>}
                            {r.duration_s != null && <div><dt>Time to complete</dt><dd>{Math.floor(r.duration_s / 60)}m {r.duration_s % 60}s</dd></div>}
                            {r.session === 'test' && <div><dt>Session</dt><dd>test</dd></div>}
                        </dl>
                    </td>
                </tr>
            )}
        </>
    );
}
