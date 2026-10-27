import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import type { ProviderStats } from '../../hooks/useProviderStats';
import type { CompletenessTarget } from '../../utils/profileCompleteness';
import { buildInsights } from '../../utils/statsInsights';
import { termLabel } from '../../utils/termLabels';
import { dailyCsv } from '../../utils/statsCsv';
import { IconChart, IconClipboard, IconStar, IconViews } from '../icons/Icons';

type Rec = Record<string, number>;

interface PanelProps {
    clinic: Provider;
    stats: ProviderStats | null;
    loading: boolean;
    error: boolean;
    galleryCount: number;
    onGo: (target: CompletenessTarget) => void;
    onSeePlans: () => void;
}

/**
 * The Insights tab. What a clinic sees is decided by the database, not here
 * (`my_provider_stats` leaves out what the plan does not include), so a locked
 * card is a promise about the plan rather than a CSS trick over data that is
 * already in the page.
 */
export function StatsPanel({ clinic, stats, loading, error, galleryCount, onGo, onSeePlans }: PanelProps) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;
    const insights = useMemo(
        () => (stats?.ready ? buildInsights(clinic, stats, galleryCount, lang) : []),
        [clinic, stats, galleryCount, lang],
    );

    if (loading) return <p style={{ color: 'var(--gray-500)' }}>{t('account.loading')}</p>;
    if (error || !stats) return <Card><p style={{ color: 'var(--gray-400)' }}>{t('analytics.loadError')}</p></Card>;

    if (!stats.ready) return <Collecting stats={stats} />;

    const isFeatured = stats.tier === 'featured';
    const hasReport = stats.tier !== 'basic' && !!stats.totals;
    const n = (v: number) => v.toLocaleString(lang);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
            <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', fontWeight: 600 }}>{t('analytics.period')}</p>

            {!hasReport && (
                <>
                    <div style={tileGrid}>
                        <Tile icon={<IconViews size={18} />} value={n(stats.views_30d ?? 0)} label={t('analytics.views')} />
                    </div>
                    <Locked
                        title={t('analytics.lock.promotedTitle')}
                        body={t('analytics.lock.basicBody')}
                        cta={t('analytics.lock.cta')}
                        onClick={onSeePlans}
                    />
                </>
            )}

            {hasReport && stats.totals && (
                <>
                    <div style={tileGrid}>
                        <Tile
                            icon={<IconViews size={18} />}
                            value={n(stats.totals.views)}
                            label={t('analytics.views')}
                            delta={deltaOf(stats.totals.views, stats.prev?.views, stats.prev_complete, t)}
                        />
                        <Tile
                            icon={<IconViews size={18} />}
                            value={n(stats.totals.visitors)}
                            label={t('analytics.visitors')}
                        />
                        <Tile
                            icon={<IconClipboard size={18} />}
                            value={n(stats.totals.contacts)}
                            label={t('analytics.contacts')}
                            delta={deltaOf(stats.totals.contacts, stats.prev?.contacts, stats.prev_complete, t)}
                        />
                        <Tile
                            icon={<IconClipboard size={18} />}
                            value={n(stats.totals.inquiries)}
                            label={t('analytics.inquiries')}
                        />
                    </div>

                    {stats.plan_lift && <PlanLift lift={stats.plan_lift} />}

                    <div style={twoCol}>
                        <Card title={t('analytics.contactsByMethod')}>
                            <Bars
                                data={stats.contacts_by_method ?? {}}
                                label={(k) => t(`analytics.method.${k}`, { defaultValue: k })}
                                empty={t('analytics.noContactsYet')}
                            />
                        </Card>
                        <Card title={t('analytics.sources')}>
                            <Bars
                                data={stats.sources ?? {}}
                                label={(k) => t(`analytics.channel.${k}`, { defaultValue: k })}
                            />
                        </Card>
                    </div>
                </>
            )}

            {isFeatured && stats.totals && <FeaturedSections stats={stats} lang={lang} clinic={clinic} />}

            {hasReport && !isFeatured && (
                <Locked
                    title={t('analytics.lock.featuredTitle')}
                    body={t('analytics.lock.featuredBody')}
                    cta={t('analytics.lock.cta')}
                    onClick={onSeePlans}
                />
            )}

            {insights.length > 0 && (
                <Card title={t('analytics.insights')}>
                    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.85rem', margin: 0, padding: 0 }}>
                        {insights.map((i) => (
                            <li key={i.id} style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                                <span style={{ color: 'var(--gold)', display: 'flex', marginTop: 2 }}><IconStar size={15} filled /></span>
                                <span style={{ fontSize: '0.9rem', lineHeight: 1.55, color: 'var(--gray-300)' }}>
                                    {t(`analytics.insight.${i.id}`, i.params)}
                                    {i.target && (
                                        <>
                                            {' '}
                                            <button
                                                type="button"
                                                onClick={() => onGo(i.target!)}
                                                style={{ background: 'none', color: 'var(--gold)', fontWeight: 700, textDecoration: 'underline', padding: 0 }}
                                            >
                                                {t('analytics.insightGo')}
                                            </button>
                                        </>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Card>
            )}
        </div>
    );
}

/** The Overview's three numbers: real when there are enough, an honest "collecting" when not. */
export function StatsSummary({ clinic, stats, loading, onSeeInsights }: {
    clinic: Provider;
    stats: ProviderStats | null;
    loading: boolean;
    onSeeInsights: () => void;
}) {
    const { t, i18n } = useTranslation();
    const n = (v: number) => v.toLocaleString(i18n.language);
    const ready = !!stats?.ready;
    const views = stats?.totals?.views ?? stats?.views_30d;
    const contacts = stats?.totals?.contacts;

    // Not enough traffic yet: say nothing about traffic (no "—" tiles, no
    // "collecting" note, no link to a hidden tab). The rating is not traffic, so
    // it stays when there are reviews.
    if (!ready) {
        if (clinic.reviewCount <= 0) return null;
        return (
            <div style={tileGrid}>
                <Tile icon={<IconStar size={18} filled />} value={clinic.rating.toFixed(1)} label={t('account.statRating')} />
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div style={tileGrid}>
                <Tile
                    icon={<IconViews size={18} />}
                    value={ready && views != null ? n(views) : '—'}
                    label={t('account.statViews')}
                />
                <Tile
                    icon={<IconClipboard size={18} />}
                    value={ready && contacts != null ? n(contacts) : '—'}
                    label={t('account.statContacts')}
                    alarming={ready && contacts === 0}
                />
                <Tile
                    icon={<IconStar size={18} filled />}
                    value={clinic.reviewCount > 0 ? clinic.rating.toFixed(1) : '—'}
                    label={t('account.statRating')}
                />
            </div>
            {!loading && (
                <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)', lineHeight: 1.6 }}>
                    {ready
                        ? contacts == null ? t('analytics.summaryBasic') : t('analytics.summaryReal')
                        : t('analytics.summaryCollecting')}
                    {' '}
                    <button
                        type="button"
                        onClick={onSeeInsights}
                        style={{ background: 'none', color: 'var(--gold)', fontWeight: 700, textDecoration: 'underline', padding: 0, fontSize: 'inherit' }}
                    >
                        {t('analytics.seeInsights')}
                    </button>
                </p>
            )}
        </div>
    );
}

// ── Featured: the full picture ───────────────────────────────────────────────

function FeaturedSections({ stats, lang, clinic }: { stats: ProviderStats; lang: string; clinic: Provider }) {
    const { t } = useTranslation();
    const totals = stats.totals!;
    const n = (v: number) => v.toLocaleString(lang);
    const sections = stats.sections ?? {};
    const sectionTotal = totals.views;
    const countryName = useMemo(() => {
        try { return new Intl.DisplayNames([lang], { type: 'region' }); } catch { return null; }
    }, [lang]);
    const weekday = (i: number) =>
        new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + i)));

    return (
        <>
            <Card title={t('analytics.trend')} action={<CsvButton stats={stats} clinic={clinic} />}>
                <Trend daily={stats.daily ?? []} lang={lang} />
            </Card>

            <Card title={t('analytics.funnel')}>
                <Funnel
                    rows={[
                        { label: t('analytics.funnelSeen'), value: totals.impressions },
                        { label: t('analytics.funnelOpened'), value: totals.clicks },
                        { label: t('analytics.funnelViewed'), value: totals.views },
                        { label: t('analytics.funnelContacted'), value: totals.contacts },
                        { label: t('analytics.funnelInquired'), value: totals.inquiries },
                    ]}
                    lang={lang}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem 1.4rem', marginTop: '0.9rem', fontSize: '0.84rem', color: 'var(--gray-400)' }}>
                    {totals.impressions > 0 && (
                        <span>{t('analytics.clickRate', { pct: Math.round((totals.clicks / totals.impressions) * 100) })}</span>
                    )}
                    {totals.views > 0 && (
                        <span>{t('analytics.contactRate', { pct: Math.round((totals.contacts / totals.views) * 100) })}</span>
                    )}
                    {totals.avg_position != null && (
                        <span>{t('analytics.avgPosition', { pos: totals.avg_position })}</span>
                    )}
                </div>
                {stats.benchmark && (
                    <p style={{ marginTop: '0.9rem', fontWeight: 700, fontSize: '0.92rem' }}>
                        {t('analytics.benchmark', {
                            pct: stats.benchmark.percentile,
                            n: stats.benchmark.peers,
                            specialty: t(`specialties.${stats.benchmark.specialty}`, { defaultValue: stats.benchmark.specialty }),
                        })}
                    </p>
                )}
            </Card>

            <div style={twoCol}>
                <Card title={t('analytics.byHour')}>
                    <Columns values={stats.by_hour ?? []} labelOf={(i) => (i % 6 === 0 ? `${i}h` : '')} titleOf={(i, v) => `${i}:00 — ${n(v)}`} />
                </Card>
                <Card title={t('analytics.byDay')}>
                    <Columns values={stats.by_dow ?? []} labelOf={weekday} titleOf={(i, v) => `${weekday(i)} — ${n(v)}`} />
                </Card>
            </div>

            <Card title={t('analytics.audience')}>
                <div style={threeCol}>
                    <div>
                        <h4 style={miniTitle}>{t('analytics.country')}</h4>
                        <Bars
                            data={stats.countries ?? {}}
                            limit={5}
                            label={(k) => (k.length === 2 && countryName ? (countryName.of(k.toUpperCase()) ?? k) : t('analytics.unknown'))}
                        />
                    </div>
                    <div>
                        <h4 style={miniTitle}>{t('analytics.device')}</h4>
                        <Bars data={stats.devices ?? {}} label={(k) => t(`analytics.deviceName.${k}`, { defaultValue: k === 'unknown' ? t('analytics.unknown') : k })} />
                    </div>
                    <div>
                        <h4 style={miniTitle}>{t('analytics.language')}</h4>
                        <Bars data={stats.langs ?? {}} label={(k) => t(`languages.${k}`, { defaultValue: k === 'unknown' ? t('analytics.unknown') : k })} />
                    </div>
                </div>
            </Card>

            {sectionTotal > 0 && Object.keys(sections).length > 0 && (
                <Card title={t('analytics.sections')}>
                    <Bars
                        data={sections}
                        total={sectionTotal}
                        label={(k) => t(`analytics.section.${k}`, { defaultValue: k })}
                        suffix={t('analytics.reached')}
                    />
                </Card>
            )}

            {stats.demand && stats.demand.searches > 0 && (
                <Card title={t('analytics.demand')}>
                    <p style={{ fontSize: '0.84rem', color: 'var(--gray-400)', marginBottom: '0.9rem' }}>{t('analytics.demandBody')}</p>
                    <div style={tileGrid}>
                        <Tile icon={<IconChart size={18} />} value={n(stats.demand.searches)} label={t('analytics.searches')} />
                        <Tile
                            icon={<IconChart size={18} />}
                            value={`${Math.round((stats.demand.no_results / stats.demand.searches) * 100)}%`}
                            label={t('analytics.noResults')}
                        />
                    </div>
                    {stats.demand.terms.length > 0 && (
                        <>
                            <h4 style={{ ...miniTitle, marginTop: '1.1rem' }}>{t('analytics.topServices')}</h4>
                            <Bars
                                data={Object.fromEntries(stats.demand.terms.map((x) => [x.term, x.searches]))}
                                label={(k) => termLabel(k, lang)}
                            />
                        </>
                    )}
                    {Object.keys(stats.demand.filters).length > 0 && (
                        <p style={{ marginTop: '1rem', fontSize: '0.84rem', color: 'var(--gray-400)', lineHeight: 1.6 }}>
                            {t('analytics.filtersUsed')}{' '}
                            {Object.entries(stats.demand.filters)
                                .sort((a, b) => b[1] - a[1])
                                .map(([k, v]) => `${t(`analytics.filter.${k}`, { defaultValue: k })} ${Math.round((v / stats.demand!.searches) * 100)}%`)
                                .join(' · ')}
                        </p>
                    )}
                </Card>
            )}
        </>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

const tileGrid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.9rem' };
const twoCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.4rem' };
const threeCol: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1.4rem' };
const miniTitle: React.CSSProperties = {
    fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--gray-500)', margin: '0 0 0.6rem',
};

function Card({ title, action, children }: { title?: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section
            style={{
                padding: '1.2rem 1.25rem', borderRadius: 'var(--radius)',
                background: 'var(--surface)', border: '1px solid var(--border)',
            }}
        >
            {(title || action) && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.9rem' }}>
                    {title && <h3 style={{ fontSize: '0.95rem', fontWeight: 800, margin: 0 }}>{title}</h3>}
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

function Tile({ icon, value, label, delta, alarming = false }: {
    icon: React.ReactNode; value: string; label: string; delta?: { text: string; up: boolean } | null; alarming?: boolean;
}) {
    return (
        <div style={{ padding: '1.1rem', borderRadius: 'var(--radius)', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <span style={{ color: alarming ? 'var(--red)' : 'var(--gray-500)', display: 'flex' }}>{icon}</span>
            <p className="display" style={{ fontSize: '2rem', marginTop: '0.4rem', color: alarming ? 'var(--red)' : 'var(--white)' }}>{value}</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>{label}</p>
            {delta && (
                <p style={{ fontSize: '0.74rem', fontWeight: 700, marginTop: '0.35rem', color: delta.up ? 'var(--green, #2f9e6b)' : 'var(--gray-400)' }}>
                    {delta.text}
                </p>
            )}
        </div>
    );
}

/** "▲ 12% vs the 30 days before", or nothing when the earlier window is not fully covered. */
function deltaOf(
    now: number, before: number | undefined, complete: boolean | undefined,
    t: (k: string, o?: Record<string, unknown>) => string,
): { text: string; up: boolean } | null {
    if (!complete || before == null || before <= 0) return null;
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return { text: t('analytics.same'), up: false };
    return pct > 0
        ? { text: t('analytics.up', { pct }), up: true }
        : { text: t('analytics.down', { pct: Math.abs(pct) }), up: false };
}

function Bars({ data, label, total, limit = 6, suffix, empty }: {
    data: Rec; label: (key: string) => string; total?: number; limit?: number; suffix?: string; empty?: string;
}) {
    const rows = Object.entries(data).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
    if (rows.length === 0) return empty ? <p style={{ fontSize: '0.86rem', color: 'var(--gray-500)' }}>{empty}</p> : null;
    const denom = total ?? rows.reduce((a, [, v]) => a + v, 0);
    return (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.55rem', margin: 0, padding: 0 }}>
            {rows.map(([k, v]) => {
                const share = denom > 0 ? Math.min(100, Math.round((v / denom) * 100)) : 0;
                return (
                    <li key={k}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.84rem', marginBottom: 3 }}>
                            <span style={{ color: 'var(--gray-300)' }}>{label(k)}</span>
                            <span style={{ color: 'var(--gray-400)', fontWeight: 700 }}>
                                {total != null ? `${share}%${suffix ? ` ${suffix}` : ''}` : v.toLocaleString()}
                            </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--border)' }}>
                            <div style={{ width: `${Math.max(share, 2)}%`, height: '100%', borderRadius: 3, background: 'var(--gold)' }} />
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}

/** A small column chart. `values` are plotted left to right. */
function Columns({ values, labelOf, titleOf }: {
    values: number[]; labelOf: (i: number) => string; titleOf: (i: number, v: number) => string;
}) {
    const max = Math.max(1, ...values);
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 96 }}>
                {values.map((v, i) => (
                    <div
                        key={i}
                        title={titleOf(i, v)}
                        style={{
                            flex: 1, minWidth: 0, borderRadius: '3px 3px 0 0',
                            height: `${Math.max(v > 0 ? 6 : 2, (v / max) * 100)}%`,
                            background: v === max && v > 0 ? 'var(--gold)' : 'var(--gray-600, #555)',
                            opacity: v > 0 ? 1 : 0.35,
                        }}
                    />
                ))}
            </div>
            <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                {values.map((_, i) => (
                    <span key={i} style={{ flex: 1, minWidth: 0, fontSize: '0.64rem', color: 'var(--gray-500)', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {labelOf(i)}
                    </span>
                ))}
            </div>
        </div>
    );
}

/** Views per day over the last 30 days; days with no row are zeros. */
function Trend({ daily, lang }: { daily: { day: string; views: number; contacts: number }[]; lang: string }) {
    const days = useMemo(() => {
        const byDay = new Map(daily.map((d) => [d.day, d]));
        const out: { day: string; views: number; contacts: number }[] = [];
        const today = new Date();
        for (let i = 29; i >= 0; i--) {
            const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
            const key = d.toISOString().slice(0, 10);
            out.push(byDay.get(key) ?? { day: key, views: 0, contacts: 0 });
        }
        return out;
    }, [daily]);
    const W = 600, H = 120, PAD = 4;
    const max = Math.max(1, ...days.map((d) => d.views));
    const x = (i: number) => PAD + (i * (W - PAD * 2)) / (days.length - 1);
    const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
    const line = days.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.views).toFixed(1)}`).join(' ');
    const area = `${line} L${x(days.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
    const fmt = (iso: string) => new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="views per day">
                <path d={area} fill="var(--gold)" opacity="0.14" />
                <path d={line} fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinejoin="round" />
                {days.map((d, i) => d.contacts > 0 && (
                    <circle key={d.day} cx={x(i)} cy={y(d.views)} r="3.5" fill="var(--white)" stroke="var(--gold)" strokeWidth="2">
                        <title>{`${fmt(d.day)}: ${d.contacts}`}</title>
                    </circle>
                ))}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--gray-500)', marginTop: 4 }}>
                <span>{fmt(days[0].day)}</span>
                <span>max {max.toLocaleString(lang)}</span>
                <span>{fmt(days[days.length - 1].day)}</span>
            </div>
        </div>
    );
}

function Funnel({ rows, lang }: { rows: { label: string; value: number }[]; lang: string }) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.6rem', margin: 0, padding: 0 }}>
            {rows.map((r) => (
                <li key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 1fr) 2fr auto', gap: '0.7rem', alignItems: 'center', fontSize: '0.84rem' }}>
                    <span style={{ color: 'var(--gray-300)' }}>{r.label}</span>
                    <div style={{ height: 10, borderRadius: 5, background: 'var(--border)' }}>
                        <div style={{ width: `${r.value > 0 ? Math.max((r.value / max) * 100, 2) : 0}%`, height: '100%', borderRadius: 5, background: 'var(--gold)' }} />
                    </div>
                    <span style={{ fontWeight: 800, minWidth: 38, textAlign: 'right' }}>{r.value.toLocaleString(lang)}</span>
                </li>
            ))}
        </ul>
    );
}

function PlanLift({ lift }: { lift: NonNullable<ProviderStats['plan_lift']> }) {
    const { t, i18n } = useTranslation();
    const since = new Intl.DateTimeFormat(i18n.language, { month: 'long', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${lift.since}T12:00:00Z`));
    return (
        <Card title={t('analytics.planLiftTitle', { date: since })}>
            <p style={{ fontSize: '0.92rem', color: 'var(--gray-300)', lineHeight: 1.6 }}>
                {t('analytics.planLiftBody', { after: lift.after_per_day, before: lift.before_per_day })}
            </p>
        </Card>
    );
}

function Collecting({ stats }: { stats: ProviderStats }) {
    const { t, i18n } = useTranslation();
    const since = stats.collecting_since
        ? new Intl.DateTimeFormat(i18n.language, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
            .format(new Date(`${stats.collecting_since}T12:00:00Z`))
        : null;
    return (
        <Card>
            <div style={{ display: 'flex', gap: '0.9rem', alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--gold)', display: 'flex', marginTop: 2 }}><IconChart size={22} weight={1.8} /></span>
                <div>
                    <p style={{ fontWeight: 800, marginBottom: '0.4rem' }}>{t('analytics.collectingTitle')}</p>
                    <p style={{ fontSize: '0.9rem', color: 'var(--gray-400)', lineHeight: 1.65 }}>
                        {since ? t('analytics.collectingBody', { date: since }) : t('analytics.collectingBodyNoDate')}
                    </p>
                </div>
            </div>
        </Card>
    );
}

/** A plan teaser: describes what is included, shows no numbers, and goes to the plans. */
function Locked({ title, body, cta, onClick }: { title: string; body: string; cta: string; onClick: () => void }) {
    return (
        <section
            style={{
                padding: '1.2rem 1.25rem', borderRadius: 'var(--radius)',
                border: '1px dashed var(--border-strong)', background: 'transparent',
                display: 'flex', flexWrap: 'wrap', gap: '0.9rem 1.4rem', alignItems: 'center', justifyContent: 'space-between',
            }}
        >
            <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                <p style={{ fontWeight: 800, marginBottom: '0.3rem' }}>{title}</p>
                <p style={{ fontSize: '0.88rem', color: 'var(--gray-400)', lineHeight: 1.6 }}>{body}</p>
            </div>
            <button
                type="button"
                onClick={onClick}
                className="press"
                style={{
                    padding: '0.65rem 1.2rem', borderRadius: 'var(--radius-pill)', background: 'var(--brand)',
                    color: 'var(--on-brand)', fontWeight: 700, fontSize: '0.86rem', whiteSpace: 'nowrap',
                }}
            >
                {cta}
            </button>
        </section>
    );
}

function CsvButton({ stats, clinic }: { stats: ProviderStats; clinic: Provider }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            onClick={() => downloadCsv(stats, clinic)}
            style={{ background: 'none', color: 'var(--gold)', fontWeight: 700, fontSize: '0.8rem', textDecoration: 'underline', padding: 0 }}
        >
            {t('analytics.exportCsv')}
        </button>
    );
}

function downloadCsv(stats: ProviderStats, clinic: Provider) {
    const blob = new Blob(['﻿', dailyCsv(stats.daily ?? [])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const slug = clinic.name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clinic';
    a.href = url;
    a.download = `medsociety-${slug}-last-30-days.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}
