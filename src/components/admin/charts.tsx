import { useState, type ReactNode } from 'react';
import { SERIES, fmt, pct, type BarRow, type Series } from './format';

export function Card({ title, hint, children, wide }: { title?: string; hint?: string; children: ReactNode; wide?: boolean }) {
    return (
        <section className={`adm-card${wide ? ' adm-wide' : ''}`}>
            {title && (
                <header className="adm-card-h">
                    <h3>{title}</h3>
                    {hint && <span>{hint}</span>}
                </header>
            )}
            {children}
        </section>
    );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'good' | 'warn' }) {
    return (
        <div className={`adm-kpi${tone ? ` adm-${tone}` : ''}`}>
            <div className="adm-kpi-l">{label}</div>
            <div className="adm-kpi-v">{value}</div>
            {sub != null && <div className="adm-kpi-s">{sub}</div>}
        </div>
    );
}

/** Horizontal bars scaled to the largest row (or to `total`, for shares). */
export function HBars({ rows, total, color = SERIES[0], empty = 'No data yet', limit }: {
    rows: BarRow[]; total?: number; color?: string; empty?: string; limit?: number;
}) {
    const [all, setAll] = useState(false);
    if (!rows.length) return <p className="adm-empty">{empty}</p>;
    const shown = limit && !all ? rows.slice(0, limit) : rows;
    const max = total ?? Math.max(...rows.map((r) => r.value), 1);
    return (
        <div className="adm-bars">
            {shown.map((r) => (
                <div className="adm-bar" key={r.label}>
                    <div className="adm-bar-top">
                        <span className="adm-bar-l" title={r.label}>{r.label}</span>
                        <span className="adm-bar-v">
                            {fmt(r.value)}
                            {total ? <em> {pct(r.value, total)}</em> : null}
                            {r.sub ? <em> {r.sub}</em> : null}
                        </span>
                    </div>
                    <div className="adm-track"><div className="adm-fill" style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 1.5 : 0)}%`, background: r.color ?? color }} /></div>
                </div>
            ))}
            {limit && rows.length > limit && (
                <button type="button" className="adm-link" onClick={() => setAll(!all)}>
                    {all ? 'Show fewer' : `Show all ${rows.length}`}
                </button>
            )}
        </div>
    );
}

/** One bar split into labelled shares (region split, source mix). */
export function SplitBar({ rows }: { rows: BarRow[] }) {
    const total = rows.reduce((s, r) => s + r.value, 0);
    if (!total) return <p className="adm-empty">No data yet</p>;
    return (
        <div>
            <div className="adm-split" role="img" aria-label={rows.map((r) => `${r.label} ${r.value}`).join(', ')}>
                {rows.filter((r) => r.value > 0).map((r, i) => (
                    <div key={r.label} style={{ width: `${(r.value / total) * 100}%`, background: r.color ?? SERIES[i % SERIES.length] }} title={`${r.label}: ${fmt(r.value)}`} />
                ))}
            </div>
            <ul className="adm-legend">
                {rows.map((r, i) => (
                    <li key={r.label}><i style={{ background: r.color ?? SERIES[i % SERIES.length] }} />{r.label} <b>{fmt(r.value)}</b> <em>{pct(r.value, total)}</em></li>
                ))}
            </ul>
        </div>
    );
}

function addDays(day: string, n: number): string {
    const d = new Date(day + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

/** Daily trend, gaps filled with zero between the first and last day seen. */
export function DailyChart({ series, height = 150 }: { series: Series[]; height?: number }) {
    const [hover, setHover] = useState<number | null>(null);
    const days = series.flatMap((s) => [...s.byDay.keys()]).sort();
    if (!days.length) return <p className="adm-empty">No activity yet</p>;
    const first = days[0];
    const last = days[days.length - 1];
    const axis: string[] = [];
    for (let d = first; d <= last && axis.length < 400; d = addDays(d, 1)) axis.push(d);
    if (axis.length < 2) axis.unshift(addDays(first, -1));

    const W = 640;
    const H = height;
    const pad = { l: 28, r: 8, t: 8, b: 20 };
    const max = Math.max(1, ...series.flatMap((s) => axis.map((d) => s.byDay.get(d) ?? 0)));
    const x = (i: number) => pad.l + (i / (axis.length - 1)) * (W - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
    const ticks = [0, Math.ceil(max / 2), max];
    const labelAt = [0, Math.floor((axis.length - 1) / 2), axis.length - 1];

    return (
        <div className="adm-chart">
            <ul className="adm-legend">
                {series.map((s) => <li key={s.name}><i style={{ background: s.color }} />{s.name}</li>)}
            </ul>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map((s) => s.name).join(' and ') + ' per day'}
                onMouseLeave={() => setHover(null)}
                onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const px = ((e.clientX - r.left) / r.width) * W;
                    setHover(Math.min(axis.length - 1, Math.max(0, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (axis.length - 1)))));
                }}>
                {ticks.map((t) => (
                    <g key={t}>
                        <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="adm-grid" />
                        <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="adm-axis">{t}</text>
                    </g>
                ))}
                {labelAt.map((i) => (
                    <text key={i} x={x(i)} y={H - 4} textAnchor={i === 0 ? 'start' : i === axis.length - 1 ? 'end' : 'middle'} className="adm-axis">{axis[i].slice(5)}</text>
                ))}
                {series.map((s) => {
                    const pts = axis.map((d, i) => `${x(i).toFixed(1)},${y(s.byDay.get(d) ?? 0).toFixed(1)}`);
                    return (
                        <g key={s.name}>
                            <polygon points={`${x(0)},${y(0)} ${pts.join(' ')} ${x(axis.length - 1)},${y(0)}`} fill={s.color} opacity="0.1" />
                            <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
                        </g>
                    );
                })}
                {hover != null && (
                    <g>
                        <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} className="adm-cursor" />
                        {series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.byDay.get(axis[hover]) ?? 0)} r="3.5" fill={s.color} />)}
                    </g>
                )}
            </svg>
            <div className="adm-tip" aria-live="polite">
                {hover != null
                    ? <>{axis[hover]}: {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name} <b>{s.byDay.get(axis[hover]) ?? 0}</b></span>)}</>
                    : 'Hover the chart for daily values'}
            </div>
        </div>
    );
}

/** Funnel: each step as a bar, sized against the first, with drop-off shown. */
export function Funnel({ steps }: { steps: { label: string; value: number; sub?: string }[] }) {
    if (!steps.length) return <p className="adm-empty">No funnel data yet</p>;
    const top = Math.max(steps[0].value, 1);
    return (
        <div className="adm-funnel">
            {steps.map((s, i) => {
                const prev = i > 0 ? steps[i - 1].value : null;
                const drop = prev != null && prev > 0 ? Math.round(((prev - s.value) / prev) * 100) : null;
                return (
                    <div className="adm-fstep" key={s.label}>
                        <div className="adm-fbar" style={{ width: `${Math.max((s.value / top) * 100, 3)}%`, background: SERIES[0], opacity: 1 - Math.min(i, 6) * 0.1 }}>
                            <span>{fmt(s.value)}</span>
                        </div>
                        <div className="adm-fmeta">
                            <b>{s.label}</b>
                            <span>{pct(s.value, top)} of opens{drop != null && drop > 0 ? `, ${drop}% drop` : ''}{s.sub ? ` · ${s.sub}` : ''}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
