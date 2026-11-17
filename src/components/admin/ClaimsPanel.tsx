import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    claimDocumentUrl, decideClaim, fetchClaimDetail, fetchClaimEmails, fetchClaimQueue,
    type ClaimChecks, type ClaimEmail, type ClaimDetail, type ClaimQueue, type ClaimQueueItem, type ClaimStatus,
} from '../../lib/adminApi';
import { Card, Kpi } from './charts';
import { fmt } from './format';
import { pretty, regionName } from './labels';

type Filter = 'review' | 'waiting' | 'incomplete' | 'decided' | 'all';
const FILTERS: [Filter, string, (s: ClaimStatus) => boolean][] = [
    ['review', 'To review', (s) => s === 'pending'],
    ['waiting', 'Waiting on claimant', (s) => s === 'needs_info'],
    ['incomplete', 'Started, not submitted', (s) => s === 'incomplete'],
    ['decided', 'Decided', (s) => s === 'approved' || s === 'rejected'],
    ['all', 'Everything', () => true],
];

const CEDULA_LABEL: Record<string, [string, string]> = {
    matches_listing_doctor: ['Cédula matches this listing’s doctor in our registry', 'ok'],
    belongs_to_other_doctor: ['Cédula belongs to a DIFFERENT doctor in our registry', 'bad'],
    differs_from_file: ['Cédula differs from the one on file for this doctor', 'bad'],
    not_in_registry: ['Cédula not in our registry (check SEP)', 'warn'],
    not_given: ['No cédula given', ''],
};

// Public registries the reviewer checks by hand. A cédula number alone proves
// nothing about who is claiming (SEP is public): the ID photo and the call to
// the listing's own phone are what tie the person to it.
const SEP_LOOKUP = 'https://www.cedulaprofesional.sep.gob.mx/cedula/presidencia/indexAvanzada.action';
const STATE_BOARDS: Record<string, string> = {
    TX: 'https://profile.tmb.state.tx.us/',
    CA: 'https://search.dca.ca.gov/',
    NM: 'https://nmmb.state.nm.us/',
    AZ: 'https://azbomprod.azmd.gov/glsuiteweb/clients/azbom/public/webverificationsearch.aspx',
};

/**
 * Listing claims (migration 0047). Nothing is granted until someone here
 * approves it, and approval needs three things the database insists on: the
 * ID matches the legal name, the credential was checked at its registry, and
 * the clinic was reached through a channel already on the listing.
 */
export function ClaimsPanel({ onChanged }: { onChanged?: () => void }) {
    const [data, setData] = useState<ClaimQueue | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('review');
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(() => {
        fetchClaimQueue().then((q) => { setData(q); setError(null); }).catch((e: Error) => setError(e.message));
    }, []);
    useEffect(load, [load]);

    const items = useMemo(() => {
        const test = FILTERS.find(([k]) => k === filter)![2];
        return data ? data.items.filter((i) => test(i.status)) : [];
    }, [data, filter]);

    if (error) {
        return <p className="adm-err" role="alert">Could not load claims: {error}. If this is the first time, apply supabase/migrations/0047_claim_verification.sql.</p>;
    }
    if (!data) return <p className="adm-empty">Loading claims…</p>;

    return (
        <div className="adm-stack">
            <div className="adm-kpis">
                <Kpi label="To review" value={fmt(data.counts.pending)} tone={data.counts.pending ? 'warn' : 'good'} sub="submitted with documents" />
                <Kpi label="Waiting on claimant" value={fmt(data.counts.needs_info)} sub="we asked for more" />
                <Kpi label="Started, not submitted" value={fmt(data.counts.incomplete)} sub="from the survey" />
                <Kpi label="Decided, 30 days" value={`${fmt(data.counts.approved_30d)} / ${fmt(data.counts.rejected_30d)}`} sub="approved / rejected" />
            </div>

            <Card title="Claims" hint={`${items.length} shown`}>
                <div className="adm-tools" role="group" aria-label="Filter claims">
                    {FILTERS.map(([k, l]) => (
                        <button key={k} type="button" className={`adm-btn${filter === k ? '' : ' ghost'}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
                    ))}
                </div>
                {items.length === 0 && <p className="adm-empty">Nothing here.</p>}
                {items.map((c) => (
                    <ClaimRow
                        key={c.id} c={c} open={open === c.id}
                        toggle={() => setOpen(open === c.id ? null : c.id)}
                        onDecided={() => { setOpen(null); load(); onChanged?.(); }}
                    />
                ))}
            </Card>
        </div>
    );
}

function ClaimRow({ c, open, toggle, onDecided }: { c: ClaimQueueItem; open: boolean; toggle: () => void; onDecided: () => void }) {
    const ced = c.cedula_check ? CEDULA_LABEL[c.cedula_check] : null;
    return (
        <article className="adm-fb">
            <div className="adm-fb-top">
                <span className={`adm-badge ${c.status === 'pending' ? 'warn' : c.status === 'approved' ? 'ok' : c.status === 'rejected' ? 'bad' : ''}`}>{pretty(c.status)}</span>
                <b style={{ color: 'var(--white)', fontSize: 14 }}>{c.provider_name}</b>
                <span>{[c.city, c.region ? regionName(c.region) : null, c.country].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="adm-fb-top">
                <span>{c.legal_name ?? '(no name yet)'} · {c.account_email ?? 'unknown account'} · {c.claimant_role ? pretty(c.claimant_role) : 'role not given'}</span>
                <span>{c.documents} document(s)</span>
                <span>{c.submitted_at ? `submitted ${c.submitted_at.slice(0, 16).replace('T', ' ')}` : `started ${c.created_at.slice(0, 10)}`}</span>
            </div>
            {(c.flags.length > 0 || (ced && ced[1])) && (
                <div className="adm-fb-top">
                    {ced && ced[1] && <span className={`adm-badge ${ced[1]}`}>{ced[0]}</span>}
                    {c.flags.filter((f) => !f.startsWith('Cédula')).map((f) => <span key={f} className="adm-badge bad">{f}</span>)}
                </div>
            )}
            <div className="adm-fb-acts">
                <button type="button" className={`adm-btn${open ? ' ghost' : ''}`} onClick={toggle}>{open ? 'Close' : c.status === 'pending' ? 'Review' : 'Open'}</button>
            </div>
            {open && <ClaimReview id={c.id} onDecided={onDecided} />}
        </article>
    );
}

function ClaimReview({ id, onDecided }: { id: string; onDecided: () => void }) {
    const [d, setD] = useState<ClaimDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [checks, setChecks] = useState<ClaimChecks>({ id_matches_name: false, credential_verified: false, contact_confirmed: false });
    const [message, setMessage] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [emails, setEmails] = useState<ClaimEmail[] | null>(null);

    useEffect(() => {
        fetchClaimEmails(id).then(setEmails).catch(() => setEmails(null));
        fetchClaimDetail(id).then((x) => { setD(x); setNote(x.claim.reviewer_note ?? ''); }).catch((e: Error) => setError(e.message));
    }, [id]);

    if (error && !d) return <p className="adm-err" role="alert">{error}</p>;
    if (!d) return <p className="adm-empty">Loading…</p>;

    const { claim: c, listing: l } = d;
    const s = c.signals;
    const open = c.status === 'pending' || c.status === 'needs_info';
    const credentialLabel = c.claimant_role === 'doctor'
        ? (l.country === 'US' ? 'NPI and state licence checked at NPPES and the state board' : 'Cédula checked at SEP: same name, a medical degree, matches the document')
        : c.claimant_role === 'owner' ? 'Business document is genuine and in the clinic’s name' : 'Authorisation letter confirmed with the doctor or owner';

    const decide = async (decision: 'approve' | 'reject' | 'needs_info') => {
        setBusy(true);
        setError(null);
        try {
            await decideClaim(id, decision, message, note, checks);
            onDecided();
        } catch (e) {
            setError(friendly((e as Error).message));
        } finally {
            setBusy(false);
        }
    };

    const openDoc = async (path: string) => {
        try { window.open(await claimDocumentUrl(path), '_blank', 'noopener'); }
        catch (e) { setError((e as Error).message); }
    };

    return (
        <div className="adm-claim">
            <div className="adm-grid2">
                <section>
                    <h3>Listing on file</h3>
                    <dl className="adm-dl">
                        <div><dt>Name</dt><dd>{l.name}</dd></div>
                        <div><dt>Address</dt><dd>{l.address ?? '–'}</dd></div>
                        <div><dt>Phone</dt><dd>{l.phone ? <a href={`tel:${l.phone}`}>{l.phone}</a> : <span className="adm-missing">none: confirm another way</span>}</dd></div>
                        <div><dt>Email</dt><dd>{l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '–'}</dd></div>
                        <div><dt>Website</dt><dd>{l.website ? <a href={l.website} target="_blank" rel="noreferrer">{l.website}</a> : '–'}</dd></div>
                        <div><dt>Source</dt><dd>{l.source ?? '–'}</dd></div>
                        <div><dt>Registry doctor</dt><dd>{s.registry_doctor ?? '–'}{s.cedulas_on_file?.length ? ` (cédula ${s.cedulas_on_file.join(', ')})` : ''}</dd></div>
                        <div><dt>Owners now</dt><dd>{d.owners.length ? d.owners.map((o) => `${o.email ?? '?'} (${o.role})`).join('; ') : 'none'}</dd></div>
                    </dl>
                </section>
                <section>
                    <h3>Claimant</h3>
                    <dl className="adm-dl">
                        <div><dt>Legal name</dt><dd>{c.legal_name ?? '–'}</dd></div>
                        <div><dt>Role</dt><dd>{c.claimant_role ? pretty(c.claimant_role) : '–'}</dd></div>
                        <div><dt>Phone</dt><dd>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : '–'}</dd></div>
                        <div><dt>Account</dt><dd>{s.account_email ?? '–'} · {s.account_age_days} day(s) old{s.email_confirmed ? '' : ' · NOT confirmed'}</dd></div>
                        {c.cedula && <div><dt>Cédula</dt><dd>{c.cedula} · <a href={SEP_LOOKUP} target="_blank" rel="noreferrer">check at SEP</a></dd></div>}
                        {c.npi && <div><dt>NPI</dt><dd>{c.npi} · <a href={`https://npiregistry.cms.hhs.gov/provider-view/${c.npi}`} target="_blank" rel="noreferrer">check at NPPES</a>{s.npi_valid === false ? ' · checksum FAILS' : ''}</dd></div>}
                        {c.license_number && <div><dt>Licence</dt><dd>{c.license_number} ({c.license_state}){c.license_state && STATE_BOARDS[c.license_state] ? <> · <a href={STATE_BOARDS[c.license_state]} target="_blank" rel="noreferrer">state board</a></> : ''}</dd></div>}
                        {c.rfc && <div><dt>RFC</dt><dd>{c.rfc}</dd></div>}
                    </dl>
                </section>
            </div>

            <section>
                <h3>Signals</h3>
                <div className="adm-chips">
                    <Chip ok={s.email_matches_listing} label="Account email = listing email" />
                    <Chip ok={s.email_domain_matches_website} label="Email domain = clinic website" />
                    <Chip ok={s.phone_matches_listing} label="Phone given = listing phone" />
                    {s.cedula_check !== 'not_given' && <Chip ok={s.cedula_check === 'matches_listing_doctor'} label={CEDULA_LABEL[s.cedula_check]?.[0] ?? s.cedula_check} />}
                    {s.name_similarity != null && <Chip ok={s.name_similarity >= 0.5} label={`Name similarity ${Math.round(s.name_similarity * 100)}%`} />}
                </div>
                {s.flags.length > 0 && <ul className="adm-attn" style={{ marginTop: 10, color: 'var(--red)' }}>{s.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
                <p className="adm-fb-why" style={{ marginTop: 8 }}>Signals are hints, not proof: an account email that matches the listing is strong; a matching cédula only shows the claimant can read a public registry.</p>
            </section>

            <section>
                <h3>Documents</h3>
                {d.documents.length === 0 && <p className="adm-missing">No documents.</p>}
                <div className="adm-fb-acts">
                    {d.documents.map((doc) => (
                        <button key={doc.id} type="button" className="adm-btn ghost" onClick={() => void openDoc(doc.path)}>
                            Open {pretty(doc.kind)} ({doc.created_at.slice(0, 10)})
                        </button>
                    ))}
                </div>
            </section>

            {c.evidence && <section><h3>Claimant’s note and survey answers</h3><p className="adm-fb-msg">{c.evidence}</p></section>}

            {(d.rival_claims.length > 0 || d.other_claims.length > 0) && (
                <section>
                    <h3>Other claims</h3>
                    {d.rival_claims.map((r) => <p key={r.id} className="adm-fb-why">On this listing: {r.legal_name ?? '?'} ({r.email ?? '?'}) · {pretty(r.status)}</p>)}
                    {d.other_claims.map((o) => <p key={o.id} className="adm-fb-why">By this account: {o.provider_name} · {pretty(o.status)} · {o.created_at.slice(0, 10)}</p>)}
                </section>
            )}

            <section>
                <h3>History</h3>
                {c.history.map((h, i) => (
                    <p key={i} className="adm-fb-why">{h.at.slice(0, 16).replace('T', ' ')} · {h.by} · {pretty(h.event)} → {pretty(h.status)}{h.note ? ` · “${h.note}”` : ''}</p>
                ))}
            </section>

            <section>
                <h3>E-mails</h3>
                {emails === null && <p className="adm-missing">Not available (migration 0048 not applied?).</p>}
                {emails?.length === 0 && <p className="adm-missing">None queued yet.</p>}
                {emails?.map((m, i) => (
                    <p key={i} className="adm-fb-why">
                        {pretty(m.kind)} · queued {m.created_at.slice(0, 16).replace('T', ' ')} · {m.sent_at ? `sent ${m.sent_at.slice(0, 16).replace('T', ' ')}` : <span style={{ color: 'var(--red)' }}>not sent{m.attempts ? ` after ${m.attempts} attempt(s)` : ''}{m.last_error ? `: ${m.last_error}` : ''}</span>}
                    </p>
                ))}
            </section>

            {open ? (
                <section className="adm-decide">
                    <h3>Decision</h3>
                    <label><input type="checkbox" checked={checks.id_matches_name} onChange={(e) => setChecks({ ...checks, id_matches_name: e.target.checked })} /> The photo ID is genuine and shows the legal name above</label>
                    <label><input type="checkbox" checked={checks.credential_verified} onChange={(e) => setChecks({ ...checks, credential_verified: e.target.checked })} /> {credentialLabel}</label>
                    <label><input type="checkbox" checked={checks.contact_confirmed} onChange={(e) => setChecks({ ...checks, contact_confirmed: e.target.checked })} /> I reached the clinic through the phone or email <b>already on the listing</b> (not the claimant’s), and they confirmed this person</label>
                    <textarea className="adm-input adm-input-lg" rows={2} placeholder="Message to the claimant (required to reject or ask for more; shown to them)" value={message} onChange={(e) => setMessage(e.target.value)} />
                    <textarea className="adm-input adm-input-lg" rows={2} placeholder="Internal note (never shown). Required, 20+ characters, to approve without the contact check." value={note} onChange={(e) => setNote(e.target.value)} />
                    {error && <p className="adm-err" role="alert">{error}</p>}
                    <div className="adm-fb-acts">
                        <button type="button" className="adm-btn" disabled={busy || c.status !== 'pending'} onClick={() => void decide('approve')}>Approve</button>
                        <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void decide('needs_info')}>Ask for more</button>
                        <button type="button" className="adm-btn ghost" disabled={busy} onClick={() => void decide('reject')}>Reject</button>
                    </div>
                </section>
            ) : (
                <p className="adm-fb-why">Decided {c.reviewed_at?.slice(0, 16).replace('T', ' ')}{c.review_note ? ` · told claimant: “${c.review_note}”` : ''}{c.reviewer_note ? ` · note: ${c.reviewer_note}` : ''}</p>
            )}
        </div>
    );
}

function Chip({ ok, label }: { ok: boolean; label: string }) {
    return <span className={`adm-chip ${ok ? 'yes' : 'no'}`}>{ok ? '✓' : '✗'} {label}</span>;
}

function friendly(message: string): string {
    if (message.includes('check_id_required')) return 'Tick the ID check before approving.';
    if (message.includes('check_credential_required')) return 'Tick the credential check before approving.';
    if (message.includes('contact_or_reason_required')) return 'Confirm with the clinic through the listing’s own phone or email, or write an internal note (20+ characters) explaining why that was not possible.';
    if (message.includes('message_required')) return 'Write a message to the claimant (10+ characters) saying why, or what you need.';
    if (message.includes('approve_only_pending')) return 'This claim is waiting on the claimant; it can be approved once they respond.';
    if (message.includes('claim_not_open')) return 'This claim was already decided. Refresh the list.';
    return message;
}
