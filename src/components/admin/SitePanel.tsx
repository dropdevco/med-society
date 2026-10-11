import { useState } from 'react';
import type { SiteOverview } from '../../lib/adminApi';
import { Card, DailyChart, HBars, Kpi, SplitBar } from './charts';
import { SERIES, fmt, pct, type Series } from './format';
import { pretty, regionName } from './labels';

const FIELD_LABEL: Record<string, string> = {
    phone: 'Phone number', website: 'Website', email: 'Email', address: 'Street address', hours: 'Opening hours',
    description: 'Description', photo: 'Photo', languages: 'Languages spoken', insurances: 'Insurances accepted',
    services: 'Services / prices', socials: 'Social links', coordinates: 'Map location', reviews: 'Has reviews',
    detail_profile: 'Doctoralia detail profile',
};

function regions(site: SiteOverview): string[] {
    return [...new Set(site.providers.by_region.map((r) => r.region))].sort();
}

/** What the directory holds, by region, city, specialty and data quality. */
export function DirectoryPanel({ site }: { site: SiteOverview }) {
    const regs = regions(site);
    const [region, setRegion] = useState('all');
    const p = site.providers;
    const live = (r: string) => p.by_region.filter((x) => x.region === r && x.status === 'live').reduce((s, x) => s + x.n, 0);
    const liveTotal = p.completeness.live ?? 0;

    const specs = new Map<string, number>();
    for (const r of p.by_specialty.filter((x) => region === 'all' || x.region === region)) specs.set(r.specialty, (specs.get(r.specialty) ?? 0) + r.n);
    const cities = new Map<string, number>();
    for (const r of p.by_city.filter((x) => region === 'all' || x.region === region)) cities.set(r.city, (cities.get(r.city) ?? 0) + r.n);
    const sources = new Map<string, number>();
    for (const r of p.by_region_source.filter((x) => region === 'all' || x.region === region)) sources.set(r.source, (sources.get(r.source) ?? 0) + r.n);

    const toRows = (m: Map<string, number>, f = (s: string) => s) =>
        [...m.entries()].map(([label, value]) => ({ label: f(label), value })).sort((a, b) => b.value - a.value);

    return (
        <div className="adm-stack">
            <div className="adm-kpis">
                <Kpi label="Live listings" value={fmt(liveTotal)} sub={`${fmt(p.total)} rows in total`} />
                {regs.filter((r) => r !== '(none)').map((r) => <Kpi key={r} label={regionName(r)} value={fmt(live(r))} sub="live listings" />)}
                <Kpi label="Verified" value={fmt(p.flags.verified)} sub={pct(p.flags.verified, liveTotal)} />
                <Kpi label="Self-listed" value={fmt(p.flags.self_listed)} sub="added by clinics themselves" />
                <Kpi label="Pending review" value={fmt(p.flags.pending_review)} tone={p.flags.pending_review > 0 ? 'warn' : undefined} sub="waiting for approval" />
                <Kpi label="Hidden" value={fmt(p.flags.hidden)} />
            </div>

            <div className="adm-grid2">
                <Card title="Clinics per region" hint="live listings">
                    <SplitBar rows={regs.filter((r) => r !== '(none)').map((r, i) => ({ label: regionName(r), value: live(r), color: SERIES[i % SERIES.length] }))} />
                </Card>
                <Card title="Where the data came from" hint={region === 'all' ? 'all regions' : regionName(region)}>
                    <HBars rows={toRows(sources, pretty)} total={liveTotal || undefined} />
                </Card>
            </div>

            <div className="adm-filters">
                <label className="adm-sel"><span>Region</span>
                    <select value={region} onChange={(e) => setRegion(e.target.value)}>
                        <option value="all">All regions</option>
                        {regs.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}
                    </select>
                </label>
            </div>

            <div className="adm-grid2">
                <Card title="Clinics by city"><HBars rows={toRows(cities)} limit={12} /></Card>
                <Card title="Clinics by specialty"><HBars rows={toRows(specs, pretty)} limit={12} /></Card>
            </div>

            <Card title="What we know about each live clinic" hint="share of live listings with the field filled in" wide>
                <HBars
                    rows={Object.keys(FIELD_LABEL)
                        .map((k) => ({ label: FIELD_LABEL[k], value: p.completeness[k] ?? 0, sub: `of ${fmt(liveTotal)}` }))
                        .sort((a, b) => b.value - a.value)}
                    total={liveTotal || undefined}
                />
            </Card>

            <div className="adm-grid2">
                <Card title="Plan tiers"><HBars rows={p.by_tier.map((t) => ({ label: pretty(t.tier), value: t.n }))} /></Card>
                <Card title="Listing flags">
                    <HBars rows={[
                        { label: 'Verified', value: p.flags.verified },
                        { label: 'Licensed', value: p.flags.licensed },
                        { label: 'Promoted', value: p.flags.promoted },
                        { label: 'Languages confirmed', value: p.flags.languages_confirmed },
                    ]} total={p.total || undefined} />
                </Card>
            </div>
        </div>
    );
}

function dayMap(rows: { day: string; n: number }[]): Map<string, number> {
    return new Map(rows.map((r) => [r.day, r.n]));
}

function Mini({ rows, cols }: { rows: Record<string, string | null>[]; cols: [string, string][] }) {
    if (!rows.length) return <p className="adm-empty">Nothing yet</p>;
    return (
        <div className="adm-tablewrap">
            <table className="adm-table">
                <thead><tr>{cols.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead>
                <tbody>
                    {rows.map((r, i) => (
                        <tr key={i}>{cols.map(([k]) => <td key={k}>{k === 'created_at' ? (r[k] ?? '').slice(0, 10) : r[k] || '–'}</td>)}</tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Accounts, claimed clinics, and everything patients and clinics send in. */
export function AccountsPanel({ site }: { site: SiteOverview }) {
    const a = site.accounts;
    const c = site.community;
    const live = site.providers.completeness.live ?? 0;
    const series: Series[] = [{ name: 'New accounts', color: SERIES[0], byDay: dayMap(a.signups_daily) }];

    return (
        <div className="adm-stack">
            <div className="adm-kpis">
                <Kpi label="Accounts" value={fmt(a.users)} sub={`${fmt(a.confirmed)} confirmed`} />
                <Kpi label="Active in 30 days" value={fmt(a.signed_in_30d)} sub={pct(a.signed_in_30d, a.users)} />
                <Kpi label="Clinics claimed" value={fmt(a.claimed_listings)} sub={`${pct(a.claimed_listings, live)} of live listings`} tone={a.claimed_listings > 0 ? 'good' : undefined} />
                <Kpi label="Clinic owners" value={fmt(a.owners)} sub="accounts that own a listing" />
                <Kpi label="Photos uploaded" value={fmt(a.photos)} />
                <Kpi label="Team invites" value={`${fmt(a.invites.accepted)} / ${fmt(a.invites.sent)}`} sub="accepted / sent" />
                <Kpi label="Patient inquiries" value={fmt(c.inquiries)} />
                <Kpi label="Sales leads" value={fmt(c.leads)} />
                <Kpi label="Forum threads" value={fmt(c.threads)} sub={`${fmt(c.replies)} replies`} />
            </div>

            <div className="adm-grid2">
                <Card title="New accounts per day" hint="last 90 days"><DailyChart series={series} /></Card>
                <Card title="Claimed clinics by region">
                    <HBars rows={a.claimed_by_region.map((r) => ({ label: regionName(r.region), value: r.n }))} empty="No claimed clinics yet" />
                    <h4 className="adm-sub">Claim requests</h4>
                    <HBars rows={a.claims_by_status.map((r) => ({ label: pretty(r.status), value: r.n }))} empty="No claim requests yet" />
                </Card>
            </div>

            <Card title="Claimed listings" hint="who owns what" wide>
                <div className="adm-tablewrap">
                    <table className="adm-table">
                        <thead><tr><th>Clinic</th><th>City</th><th>Region</th><th>Status</th><th>Owner</th><th>Role</th><th>Since</th></tr></thead>
                        <tbody>
                            {site.owners.length === 0 && <tr><td colSpan={7} className="adm-empty">No claimed listings yet</td></tr>}
                            {site.owners.map((o) => (
                                <tr key={`${o.id}-${o.owner_email}`}>
                                    <td><a href={`/providers/${o.id}`} target="_blank" rel="noreferrer">{o.name}</a></td>
                                    <td>{o.city ?? '–'}</td><td>{o.region ? regionName(o.region) : '–'}</td><td>{pretty(o.status)}</td>
                                    <td>{o.owner_email ?? '–'}</td><td>{pretty(o.role)}</td><td>{o.claimed_at.slice(0, 10)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Card>

            <div className="adm-grid2">
                <Card title="Sales leads" hint="from the pricing page">
                    <HBars rows={c.leads_by_status.map((r) => ({ label: pretty(r.status), value: r.n }))} empty="No leads yet" />
                    <Mini rows={c.recent_leads} cols={[['created_at', 'Date'], ['clinic', 'Clinic'], ['contact', 'Contact'], ['email', 'Email'], ['plan', 'Plan'], ['status', 'Status']]} />
                </Card>
                <Card title="Patient inquiries" hint="messages sent to clinics">
                    <HBars rows={c.inquiries_by_status.map((r) => ({ label: pretty(r.status), value: r.n }))} empty="No inquiries yet" />
                    <Mini rows={c.recent_inquiries} cols={[['created_at', 'Date'], ['provider_name', 'Clinic'], ['contact_kind', 'Via'], ['language', 'Lang'], ['status', 'Status']]} />
                </Card>
            </div>
        </div>
    );
}
