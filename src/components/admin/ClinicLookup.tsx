import { useEffect, useState, type ReactNode } from 'react';
import { fetchProvider, searchProviders, type ProviderDetail, type ProviderHit } from '../../lib/adminApi';
import { Card } from './charts';
import { pretty, regionName } from './labels';

type Val = unknown;

function empty(v: Val): boolean {
    if (v == null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v as object).length === 0;
    return false;
}

function show(v: Val): ReactNode {
    if (empty(v)) return <span className="adm-missing">missing</span>;
    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
    if (Array.isArray(v)) return v.every((x) => typeof x !== 'object') ? v.join(', ') : <pre>{JSON.stringify(v, null, 2)}</pre>;
    if (typeof v === 'object') return <pre>{JSON.stringify(v, null, 2)}</pre>;
    const s = String(v);
    return /^https?:\/\//.test(s) ? <a href={s} target="_blank" rel="noreferrer">{s}</a> : s;
}

const GROUPS: { title: string; keys: [string, string][] }[] = [
    { title: 'Identity', keys: [['name', 'Name'], ['specialty', 'Specialties'], ['description', 'Description'], ['source', 'Data source'], ['doctoraliaId', 'Doctoralia id'], ['googlePlaceId', 'Google place id']] },
    { title: 'Contact', keys: [['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['socials', 'Social links'], ['bookingUrl', 'Booking link']] },
    { title: 'Location', keys: [['country', 'Country'], ['region', 'Region'], ['city', 'City'], ['address', 'Address'], ['postalCode', 'Postal code'], ['lat', 'Latitude'], ['lng', 'Longitude']] },
    { title: 'Care', keys: [['languages', 'Languages'], ['languages_confirmed', 'Languages confirmed'], ['insurances', 'Insurances'], ['services', 'Services'], ['priceFromMxn', 'Price from (MXN)'], ['hours', 'Hours']] },
    { title: 'Reputation', keys: [['rating', 'Rating'], ['reviewCount', 'Review count'], ['clicks', 'Clicks']] },
    { title: 'Listing', keys: [['status', 'Status'], ['tier', 'Plan tier'], ['verified', 'Verified'], ['licensed', 'Licensed'], ['promoted', 'Promoted'], ['featuredRank', 'Featured rank'], ['updated_at', 'Last updated'], ['imageUrl', 'Main image'], ['galleryUrls', 'Gallery images']] },
];

const CHECKS: [string, string][] = [
    ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['address', 'Address'], ['hours', 'Hours'],
    ['description', 'Description'], ['imageUrl', 'Photo'], ['languages', 'Languages'], ['insurances', 'Insurances'], ['services', 'Services'], ['socials', 'Socials'],
];

function Detail({ d }: { d: ProviderDetail }) {
    const p = d.provider;
    const have = CHECKS.filter(([k]) => !empty(p[k]));
    const shown = new Set(GROUPS.flatMap((g) => g.keys.map(([k]) => k)));
    const extra = Object.keys(p).filter((k) => !shown.has(k) && !['id', 'name_norm', 'city_norm', 'phone_norm', 'updated_by'].includes(k) && !empty(p[k]));

    return (
        <div className="adm-stack">
            <Card>
                <div className="adm-clinic-h">
                    <div>
                        <h2>{String(p.name)}</h2>
                        <p>{[p.city, p.country].filter(Boolean).join(', ')}{p.region ? ` · ${regionName(String(p.region))}` : ''}</p>
                    </div>
                    <div className="adm-badges">
                        <span className={`adm-badge ${d.owners.length ? 'ok' : ''}`}>{d.owners.length ? 'Claimed' : 'Unclaimed'}</span>
                        <span className="adm-badge">{pretty(String(p.status))}</span>
                        {p.verified === true && <span className="adm-badge ok">Verified</span>}
                        <a className="adm-btn" href={`/providers/${String(p.id)}`} target="_blank" rel="noreferrer">Open public page</a>
                    </div>
                </div>
                <div className="adm-complete">
                    <div className="adm-complete-h"><b>{have.length} of {CHECKS.length}</b> key fields filled in</div>
                    <div className="adm-chips">
                        {CHECKS.map(([k, l]) => <span key={k} className={`adm-chip ${empty(p[k]) ? 'no' : 'yes'}`}>{empty(p[k]) ? '✕' : '✓'} {l}</span>)}
                    </div>
                </div>
            </Card>

            <div className="adm-grid2">
                <Card title="Ownership and activity">
                    <dl className="adm-dl">
                        <div><dt>Owners</dt><dd>{d.owners.length ? d.owners.map((o) => `${o.email ?? 'unknown'} (${o.role}, since ${o.since.slice(0, 10)})`).join('; ') : <span className="adm-missing">nobody has claimed it</span>}</dd></div>
                        <div><dt>Claim requests</dt><dd>{d.claims.length ? d.claims.map((c) => `${pretty(c.status)} by ${c.email ?? 'unknown'} on ${c.created_at.slice(0, 10)}`).join('; ') : '–'}</dd></div>
                        <div><dt>Gallery photos</dt><dd>{d.photos}</dd></div>
                        <div><dt>Patient inquiries</dt><dd>{d.inquiries}</dd></div>
                        <div><dt>Forum threads</dt><dd>{d.threads}</dd></div>
                        <div><dt>Survey responses linked</dt><dd>{d.survey_responses.length ? d.survey_responses.map((s) => `${s.form_slug}/${s.segment}${s.outcome ? ` → ${pretty(s.outcome)}` : ''} on ${s.created_at.slice(0, 10)}`).join('; ') : '–'}</dd></div>
                    </dl>
                </Card>
                {GROUPS.slice(0, 1).map((g) => (
                    <Card key={g.title} title={g.title}>
                        <dl className="adm-dl">{g.keys.map(([k, l]) => <div key={k}><dt>{l}</dt><dd>{show(p[k])}</dd></div>)}</dl>
                    </Card>
                ))}
            </div>

            <div className="adm-grid2">
                {GROUPS.slice(1).map((g) => (
                    <Card key={g.title} title={g.title}>
                        <dl className="adm-dl">{g.keys.map(([k, l]) => <div key={k}><dt>{l}</dt><dd>{show(p[k])}</dd></div>)}</dl>
                    </Card>
                ))}
            </div>

            {d.details && (
                <Card title="Doctoralia detail profile" hint="provider_details" wide>
                    <dl className="adm-dl">
                        {Object.entries(d.details).filter(([k, v]) => k !== 'provider_id' && !empty(v)).map(([k, v]) => <div key={k}><dt>{pretty(k)}</dt><dd>{show(v)}</dd></div>)}
                    </dl>
                </Card>
            )}

            {extra.length > 0 && (
                <Card title="Other fields" wide>
                    <dl className="adm-dl">{extra.map((k) => <div key={k}><dt>{pretty(k)}</dt><dd>{show(p[k])}</dd></div>)}</dl>
                </Card>
            )}

            <details className="adm-raw"><summary>Raw record (JSON)</summary><pre>{JSON.stringify(d, null, 2)}</pre></details>
        </div>
    );
}

/** Search any clinic and see everything we hold on it. */
export function ClinicLookup() {
    const [q, setQ] = useState('');
    const [result, setResult] = useState<{ q: string; hits: ProviderHit[]; error?: string } | null>(null);
    const [picked, setPicked] = useState<{ id: string; d: ProviderDetail | null; error?: string } | null>(null);

    useEffect(() => {
        const term = q.trim();
        if (term.length < 2) return;
        let cancelled = false;
        const t = window.setTimeout(() => {
            searchProviders(term)
                .then((hits) => { if (!cancelled) setResult({ q: term, hits }); })
                .catch((e: Error) => { if (!cancelled) setResult({ q: term, hits: [], error: e.message }); });
        }, 250);
        return () => { cancelled = true; window.clearTimeout(t); };
    }, [q]);

    const pick = (id: string) => {
        setPicked({ id, d: null });
        fetchProvider(id)
            .then((d) => setPicked((cur) => (cur?.id === id ? { id, d } : cur)))
            .catch((e: Error) => setPicked((cur) => (cur?.id === id ? { id, d: null, error: e.message } : cur)));
    };

    const term = q.trim();
    const current = result && result.q === term ? result : null;

    return (
        <div className="adm-stack">
            <Card title="Find a clinic" hint="by name, email, phone or website">
                <input className="adm-input adm-input-lg" placeholder="Start typing a clinic name…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                {term.length >= 2 && !current && <p className="adm-empty">Searching…</p>}
                {current?.error && <p className="adm-err">{current.error}</p>}
                {current && !current.error && current.hits.length === 0 && <p className="adm-empty">No clinics match “{term}”.</p>}
                {term.length >= 2 && current && current.hits.length > 0 && (
                    <ul className="adm-hits">
                        {current.hits.map((h) => (
                            <li key={h.id}>
                                <button type="button" className={picked?.id === h.id ? 'on' : ''} onClick={() => pick(h.id)}>
                                    <b>{h.name}</b>
                                    <span>{[h.city, h.region ? regionName(h.region) : null, (h.specialty ?? []).map(pretty).join(', ')].filter(Boolean).join(' · ')}</span>
                                    <em>{h.claimed ? 'claimed' : pretty(h.source)}{h.status !== 'live' ? ` · ${h.status}` : ''}</em>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
            {picked?.error && <p className="adm-err">{picked.error}</p>}
            {picked && !picked.d && !picked.error && <p className="adm-empty">Loading…</p>}
            {picked?.d && <Detail d={picked.d} />}
        </div>
    );
}
