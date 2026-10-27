import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { useNoIndex } from '../hooks/useNoIndex';
import { fetchForms, fetchSite, isAdmin, type FormsOverview, type SiteOverview } from '../lib/adminApi';
import { Card, DailyChart, HBars, Kpi, SplitBar } from '../components/admin/charts';
import { SERIES, fmt, pct, type Series } from '../components/admin/format';
import { TrafficPanel, ResponsesPanel } from '../components/admin/FormsPanel';
import { DirectoryPanel, AccountsPanel } from '../components/admin/SitePanel';
import { ClinicLookup } from '../components/admin/ClinicLookup';
import { BillingPanel } from '../components/admin/BillingPanel';
import { SEGMENTS, SEGMENT_LABEL, regionName } from '../components/admin/labels';
import '../components/admin/admin.css';

const TABS = [
    ['overview', 'Overview'],
    ['traffic', 'Form traffic'],
    ['responses', 'Survey responses'],
    ['directory', 'Directory'],
    ['accounts', 'Accounts & leads'],
    ['billing', 'Billing'],
    ['clinic', 'Clinic lookup'],
] as const;
type Tab = (typeof TABS)[number][0];

function NotFound() {
    return (
        <main className="adm-gate">
            <h1>Page not found</h1>
            <p>That page doesn’t exist.</p>
            <Link to="/">Back to MedSociety</Link>
        </main>
    );
}

/**
 * Admin analytics. Access is decided by the database (public.app_admins), so
 * a non-admin gets the same page as a mistyped URL and every data call is
 * refused server-side regardless of what this component renders.
 */
export function AdminPage() {
    useNoIndex();
    const { user, loading: sessionLoading } = useSession();
    const [params, setParams] = useSearchParams();
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [forms, setForms] = useState<FormsOverview | null>(null);
    const [site, setSite] = useState<SiteOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const userId = user?.id ?? null;
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;
        void isAdmin().then((ok) => { if (!cancelled) setAllowed(ok); });
        return () => { cancelled = true; };
    }, [userId]);

    const apply = useCallback((p: Promise<[FormsOverview, SiteOverview]>) => {
        p.then(([f, s]) => { setForms(f); setSite(s); setError(null); })
            .catch((e: Error) => setError(e.message))
            .finally(() => setLoading(false));
    }, []);
    const fetchAll = () => Promise.all([fetchForms(), fetchSite()]);
    const refresh = () => { setLoading(true); apply(fetchAll()); };

    useEffect(() => {
        if (allowed) apply(Promise.all([fetchForms(), fetchSite()]));
    }, [allowed, apply]);

    if (sessionLoading) return <main className="adm-gate"><p>Loading…</p></main>;
    if (!user) return <Navigate to="/login?next=/admin" replace />;
    if (allowed === null) return <main className="adm-gate"><p>Loading…</p></main>;
    if (!allowed) return <NotFound />;

    const tab = (TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'overview') as Tab;

    return (
        <main className="adm">
            <header className="adm-top">
                <div>
                    <h1>MedSociety analytics</h1>
                    <p>{user.email} · {forms ? `data as of ${forms.generated_at.slice(0, 16).replace('T', ' ')} UTC` : 'loading…'}</p>
                </div>
                <button type="button" className="adm-btn" onClick={refresh} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            </header>

            <nav className="adm-tabs" aria-label="Dashboard sections">
                {TABS.map(([k, l]) => (
                    <button key={k} type="button" className={tab === k ? 'on' : ''} aria-current={tab === k ? 'page' : undefined}
                        onClick={() => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })}>{l}</button>
                ))}
            </nav>

            {error && <p className="adm-err" role="alert">Could not load data: {error}</p>}
            {!error && tab !== 'clinic' && tab !== 'billing' && (!forms || !site) && <p className="adm-empty">Loading data…</p>}

            {forms && site && tab === 'overview' && <Overview forms={forms} site={site} go={(t) => setParams({ tab: t }, { replace: true })} />}
            {forms && tab === 'traffic' && <TrafficPanel data={forms} />}
            {forms && tab === 'responses' && <ResponsesPanel data={forms} />}
            {site && tab === 'directory' && <DirectoryPanel site={site} />}
            {site && tab === 'accounts' && <AccountsPanel site={site} />}
            {tab === 'billing' && <BillingPanel />}
            {tab === 'clinic' && <ClinicLookup />}
        </main>
    );
}

function Overview({ forms, site, go }: { forms: FormsOverview; site: SiteOverview; go: (t: Tab) => void }) {
    const live = site.providers.completeness.live ?? 0;
    const liveBy = (r: string) => site.providers.by_region.filter((x) => x.region === r && x.status === 'live').reduce((s, x) => s + x.n, 0);
    const regs = [...new Set(site.providers.by_region.map((r) => r.region))].filter((r) => r !== '(none)').sort();
    const visits = forms.summary.reduce((s, r) => s + r.visits, 0);
    const subs = forms.summary.reduce((s, r) => s + r.submissions, 0);

    const dayMap = (f: (r: FormsOverview['daily'][number]) => number) => {
        const m = new Map<string, number>();
        for (const r of forms.daily) m.set(r.day, (m.get(r.day) ?? 0) + f(r));
        return m;
    };
    const series: Series[] = [
        { name: 'Form visits', color: SERIES[0], byDay: dayMap((r) => r.visits) },
        { name: 'Submissions', color: SERIES[1], byDay: dayMap((r) => r.submissions) },
    ];

    const attention: string[] = [];
    if (site.providers.flags.pending_review > 0) attention.push(`${site.providers.flags.pending_review} listing(s) waiting for review`);
    const sendErrors = forms.summary.reduce((s, r) => s + r.visits_with_send_error, 0);
    if (sendErrors > 0) attention.push(`${sendErrors} form visit(s) hit a send error`);
    if (site.community.leads > 0 && site.community.leads_by_status.some((l) => l.status === 'new')) attention.push('New sales leads are waiting');

    return (
        <div className="adm-stack">
            <div className="adm-kpis">
                <Kpi label="Live clinics" value={fmt(live)} sub={regs.map((r) => `${fmt(liveBy(r))} ${regionName(r)}`).join(' · ')} />
                <Kpi label="Clinics claimed" value={fmt(site.accounts.claimed_listings)} sub={`${pct(site.accounts.claimed_listings, live)} of live`} tone={site.accounts.claimed_listings > 0 ? 'good' : undefined} />
                <Kpi label="Accounts" value={fmt(site.accounts.users)} sub={`${fmt(site.accounts.signed_in_30d)} active in 30 days`} />
                <Kpi label="Survey responses" value={fmt(forms.responses_total)} tone={forms.responses_total > 0 ? 'good' : undefined} />
                <Kpi label="Form visits" value={fmt(visits)} sub={`${pct(subs, visits)} submitted`} />
                <Kpi label="Patient inquiries" value={fmt(site.community.inquiries)} sub={`${fmt(site.community.leads)} sales leads`} />
            </div>

            {attention.length > 0 && (
                <Card title="Needs attention">
                    <ul className="adm-attn">{attention.map((a) => <li key={a}>{a}</li>)}</ul>
                </Card>
            )}

            <div className="adm-grid2">
                <Card title="Form visits and submissions" hint="last 90 days">
                    <DailyChart series={series} />
                    <button type="button" className="adm-link" onClick={() => go('traffic')}>Open form traffic →</button>
                </Card>
                <Card title="Survey responses by audience">
                    <HBars rows={SEGMENTS.map((s) => ({ label: SEGMENT_LABEL[s], value: forms.responses_by.filter((r) => r.segment === s).reduce((t, r) => t + r.n, 0) }))} total={forms.responses_total || undefined} />
                    <button type="button" className="adm-link" onClick={() => go('responses')}>Open responses →</button>
                </Card>
            </div>

            <div className="adm-grid2">
                <Card title="Clinics per region" hint="live listings">
                    <SplitBar rows={regs.map((r, i) => ({ label: regionName(r), value: liveBy(r), color: SERIES[i % SERIES.length] }))} />
                    <button type="button" className="adm-link" onClick={() => go('directory')}>Open directory →</button>
                </Card>
                <Card title="Newest survey responses">
                    {forms.recent.filter((r) => r.session !== 'test').slice(0, 5).map((r) => (
                        <div className="adm-line" key={r.id}>
                            <b>{r.contact_name || r.contact_org || 'Anonymous'}</b>
                            <span>{SEGMENT_LABEL[r.segment] ?? r.segment} · {r.form_slug} · {r.created_at.slice(0, 10)}</span>
                        </div>
                    ))}
                    {forms.responses_total === 0 && <p className="adm-empty">No responses yet</p>}
                    <button type="button" className="adm-link" onClick={() => go('responses')}>See all →</button>
                </Card>
            </div>
        </div>
    );
}
