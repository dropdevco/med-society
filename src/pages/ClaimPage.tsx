import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../types/provider';
import { supabase } from '../lib/supabase';
import { fetchProviderRow } from '../lib/providerRead';
import { normalizeProvider } from '../utils/normalizeProvider';
import {
    DOC_ACCEPT, MAX_DOC_BYTES, fetchMyClaim, npiValid, requiredDocs, submitClaim, uploadClaimDocument,
    type ClaimError, type ClaimRole, type DocKind, type MyClaim,
} from '../lib/claims';
import { useSession } from '../hooks/useSession';
import { AuthShell, Field } from '../components/account/AuthShell';
import { authButton } from '../components/account/authStyles';
import { IconArrowRight, IconCheck } from '../components/icons/Icons';

const ROLES: ClaimRole[] = ['doctor', 'owner', 'manager'];
const REJECT_COOLDOWN_DAYS = 30;
const SECOND_DOC_ERROR: Partial<Record<DocKind, ClaimError>> = {
    cedula: 'cedula_document_required',
    license: 'license_document_required',
    business_proof: 'business_document_required',
    authorization_letter: 'authorization_required',
};

/**
 * "Is this your clinic?" — the one route from the public directory into the
 * portal.
 *
 * Nothing here grants anything. A claim asks for who you are (legal name and a
 * government ID), your credential (cédula / NPI + licence / business papers /
 * an authorisation letter, by role), and permission for us to confirm with the
 * clinic through the phone or email already on the listing. A person checks
 * all three in /admin before ownership is granted (migration 0047).
 */
export function ClaimPage() {
    const { t } = useTranslation();
    const { providerId } = useParams<{ providerId: string }>();
    const navigate = useNavigate();
    const { user, loading: sessionLoading } = useSession();

    const [provider, setProvider] = useState<Provider | null>(null);
    const [claim, setClaim] = useState<MyClaim | null>(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);

    const [role, setRole] = useState<ClaimRole | null>(null);
    const [legalName, setLegalName] = useState('');
    const [phone, setPhone] = useState('');
    const [cedula, setCedula] = useState('');
    const [npi, setNpi] = useState('');
    const [licenseNumber, setLicenseNumber] = useState('');
    const [licenseState, setLicenseState] = useState('');
    const [rfc, setRfc] = useState('');
    const [note, setNote] = useState('');
    const [files, setFiles] = useState<Partial<Record<DocKind, File>>>({});
    const [consent, setConsent] = useState(false);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<ClaimError | null>(null);
    const [done, setDone] = useState(false);

    const userId = user?.id ?? null;
    useEffect(() => {
        if (!supabase || !providerId || !userId) { setLoading(false); return; }
        let live = true;
        Promise.all([
            fetchProviderRow(providerId).catch(() => null),
            fetchMyClaim(providerId).catch(() => null),
        ]).then(([row, mine]) => {
            if (!live) return;
            setProvider(row ? normalizeProvider(row) : null);
            setClaim(mine);
            if (mine?.claimant_role) setRole(mine.claimant_role);
            setLoading(false);
        });
        return () => { live = false; };
    }, [providerId, userId]);

    // Sign in first, and come straight back here afterwards rather than to a
    // generic dashboard — the person was halfway through claiming something.
    if (!sessionLoading && !user) {
        return <Navigate to={`/login?mode=signup&next=/claim/${providerId}`} replace />;
    }
    if (loading || sessionLoading) return <AuthShell title={t('account.loading')} />;

    if (!provider) {
        return (
            <AuthShell title={t('account.claimNotFound')} subtitle={t('account.claimNotFoundBody')}>
                <Link to="/" style={{ ...authButton, textDecoration: 'none' }}>{t('account.backToDirectory')}</Link>
            </AuthShell>
        );
    }

    if (claim?.status === 'approved') return <Navigate to="/dashboard" replace />;

    const dashboardButton = (
        <button onClick={() => navigate('/dashboard')} className="press" style={authButton}>
            {t('account.goToDashboard')}
            <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
        </button>
    );

    if (done) {
        return (
            <AuthShell title={t('account.claimSentTitle')} subtitle={t('account.claimSentBody')}>
                <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent)', marginBottom: '1.5rem' }}>
                    <IconCheck size={40} weight={2} />
                </div>
                {dashboardButton}
            </AuthShell>
        );
    }

    if (claim?.status === 'pending' && !editing) {
        return (
            <AuthShell title={t('account.claimPendingTitle')} subtitle={t('account.claimSentBody')}>
                <ListingBox provider={provider} />
                <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {dashboardButton}
                    <button type="button" className="press bho-secondary" onClick={() => setEditing(true)}>
                        {t('account.claimAmend')}
                    </button>
                </div>
            </AuthShell>
        );
    }

    if (claim?.status === 'rejected' && claim.reviewed_at && !editing) {
        const retry = new Date(new Date(claim.reviewed_at).getTime() + REJECT_COOLDOWN_DAYS * 86_400_000);
        const canRetry = retry.getTime() <= Date.now();
        return (
            <AuthShell title={t('account.claimRejectedTitle')}>
                <ListingBox provider={provider} />
                {claim.review_note && <p className="ms-claim-note warn" style={{ marginBottom: '1.25rem' }}>{claim.review_note}</p>}
                {canRetry
                    ? <button type="button" className="press" style={authButton} onClick={() => setEditing(true)}>{t('account.claimTryAgain')}</button>
                    : <p className="ms-claim-note">{t('account.claimRetryAfter', { date: retry.toLocaleDateString() })}</p>}
            </AuthShell>
        );
    }

    const country: 'MX' | 'US' = provider.country === 'US' ? 'US' : 'MX';
    // A claim already in review keeps the documents it has; only a new one must upload all of them.
    const hasDocsOnFile = claim?.status === 'pending' || claim?.status === 'needs_info';
    const needed = role ? requiredDocs(role, country) : [];
    const shownDocs: DocKind[] = role ? [...needed, 'other'] : [];

    const validate = (): ClaimError | null => {
        if (!role) return 'bad_role';
        if (legalName.trim().length < 5) return 'bad_legal_name';
        if (phone.replace(/\D/g, '').length < 7) return 'bad_phone';
        const ced = cedula.replace(/\D/g, '');
        if (role === 'doctor' && country === 'MX' && !/^\d{6,9}$/.test(ced)) return 'cedula_required';
        if (role === 'doctor' && country === 'US') {
            if (!npiValid(npi.replace(/\D/g, ''))) return 'npi_invalid';
            if (!licenseNumber.trim() || !/^[A-Za-z]{2}$/.test(licenseState.trim())) return 'license_required';
        }
        if (ced && !/^\d{6,9}$/.test(ced)) return 'bad_cedula';
        if (rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(rfc.replace(/[\s-]/g, ''))) return 'bad_rfc';
        if (!hasDocsOnFile) {
            if (!files.government_id) return 'id_document_required';
            const second = needed.find((k) => k !== 'government_id');
            if (second && !files[second]) return SECOND_DOC_ERROR[second] ?? 'bad_documents';
        }
        for (const f of Object.values(files)) if (f && f.size > MAX_DOC_BYTES) return 'file_too_large';
        if (!consent) return 'consent_required';
        return null;
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !role) { setError('bad_role'); return; }
        const problem = validate();
        if (problem) { setError(problem); return; }
        setBusy(true);
        setError(null);
        try {
            const documents: { kind: DocKind; path: string }[] = [];
            for (const kind of shownDocs) {
                const file = files[kind];
                if (file) documents.push({ kind, path: await uploadClaimDocument(user.id, provider.id, kind, file) });
            }
            const result = await submitClaim({
                providerId: provider.id, role, legalName, phone, cedula, npi, licenseNumber,
                licenseState: licenseState.toUpperCase(), rfc, note, documents, consent,
            });
            if ('error' in result) setError(result.error);
            else if (result.status === 'owner') navigate('/dashboard');
            else setDone(true);
        } catch (err) {
            setError(((err as Error).message as ClaimError) || 'upload_failed');
        } finally {
            setBusy(false);
        }
    };

    return (
        <AuthShell wide title={t('account.claimTitle')} subtitle={t('account.claimBody')}>
            <ListingBox provider={provider} />

            {claim?.status === 'needs_info' && claim.review_note && (
                <div className="ms-claim-note warn" style={{ marginBottom: '1.25rem' }}>
                    <strong>{t('account.claimNeedsInfo')}</strong>
                    <p style={{ marginTop: '0.35rem' }}>{claim.review_note}</p>
                </div>
            )}

            <div className="ms-claim-note" style={{ marginBottom: '1.5rem' }}>
                <strong>{t('account.claimHowTitle')}</strong>
                <ul>
                    <li>{t('account.claimHow1')}</li>
                    <li>{t('account.claimHow2')}</li>
                    <li>{t('account.claimHow3')}</li>
                </ul>
            </div>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }} noValidate>
                <fieldset className="ms-claim-section" style={{ border: 0, paddingTop: 0, margin: 0, padding: 0 }}>
                    <h2>{t('account.claimRoleTitle')}</h2>
                    {ROLES.map((r) => (
                        <label key={r} className="ms-claim-choice">
                            <input type="radio" name="role" value={r} checked={role === r} onChange={() => { setRole(r); setError(null); }} />
                            <span>
                                <strong>{t(`account.claimRole.${r}`)}</strong>
                                <br /><span style={{ color: 'var(--gray-400)' }}>{t(`account.claimRoleHint.${r}`)}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>

                {role && (
                    <>
                        <section className="ms-claim-section">
                            <h2>{t('account.claimWhoTitle')}</h2>
                            <Field label={t('account.claimLegalName')} hint={t('account.claimLegalNameHint')}>
                                <input required autoComplete="name" maxLength={160} value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                            </Field>
                            <Field label={t('account.claimPhone')} hint={t('account.claimPhoneHint')}>
                                <input required type="tel" autoComplete="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
                            </Field>
                        </section>

                        <section className="ms-claim-section">
                            <h2>{t('account.claimCredentialTitle')}</h2>
                            {role === 'doctor' && country === 'MX' && (
                                <Field label={t('account.claimCedula')} hint={t('account.claimCedulaHint')}>
                                    <input required inputMode="numeric" maxLength={12} value={cedula} onChange={(e) => setCedula(e.target.value)} />
                                </Field>
                            )}
                            {role === 'doctor' && country === 'US' && (
                                <>
                                    <Field label={t('account.claimNpi')} hint={t('account.claimNpiHint')}>
                                        <input required inputMode="numeric" maxLength={12} value={npi} onChange={(e) => setNpi(e.target.value)} />
                                    </Field>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 7rem', gap: '0.75rem' }}>
                                        <Field label={t('account.claimLicense')}>
                                            <input required maxLength={40} value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} />
                                        </Field>
                                        <Field label={t('account.claimLicenseState')}>
                                            <input required maxLength={2} placeholder="TX" value={licenseState} onChange={(e) => setLicenseState(e.target.value.toUpperCase())} />
                                        </Field>
                                    </div>
                                </>
                            )}
                            {role !== 'doctor' && country === 'MX' && (
                                <Field label={t('account.claimRfc')} hint={t('account.claimRfcHint')}>
                                    <input maxLength={16} value={rfc} onChange={(e) => setRfc(e.target.value.toUpperCase())} />
                                </Field>
                            )}
                            {role !== 'doctor' && (
                                <p style={{ fontSize: '0.84rem', color: 'var(--gray-400)', lineHeight: 1.5 }}>
                                    {t(role === 'owner' ? 'account.claimOwnerExplain' : 'account.claimManagerExplain')}
                                </p>
                            )}
                        </section>

                        <section className="ms-claim-section">
                            <h2>{t('account.claimDocsTitle')}</h2>
                            {hasDocsOnFile && <p className="ms-claim-note">{t('account.claimDocsOnFile')}</p>}
                            {shownDocs.map((kind) => (
                                <Field
                                    key={kind}
                                    label={`${t(`account.claimDoc.${kind}`)}${needed.includes(kind) && !hasDocsOnFile ? ' *' : ''}`}
                                    hint={t(`account.claimDocHint.${kind === 'business_proof' ? `business_proof_${country}` : kind}`)}
                                >
                                    <input
                                        type="file"
                                        accept={DOC_ACCEPT}
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            setFiles((prev) => ({ ...prev, [kind]: f ?? undefined }));
                                        }}
                                    />
                                </Field>
                            ))}
                            <p style={{ fontSize: '0.78rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>{t('account.claimDocsPrivacy')}</p>
                        </section>

                        <section className="ms-claim-section">
                            <Field label={t('account.claimNoteLabel')} hint={t('account.claimNoteHint')}>
                                <textarea maxLength={1500} value={note} onChange={(e) => setNote(e.target.value)} />
                            </Field>
                            <label className="ms-claim-choice">
                                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                                <span>{t('account.claimConsent')}</span>
                            </label>
                        </section>
                    </>
                )}

                {error && (
                    <p role="alert" style={{ color: 'var(--red)', fontSize: '0.88rem', lineHeight: 1.5 }}>
                        {t(`account.claimError.${error}`, { defaultValue: t('account.claimError.unknown') })}
                    </p>
                )}

                <button type="submit" disabled={busy || !role} className="press" style={authButton}>
                    {busy ? t('account.working') : t('account.claimSubmit')}
                    <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
                </button>
            </form>
        </AuthShell>
    );
}

function ListingBox({ provider }: { provider: Provider }) {
    return (
        <div style={{
            padding: '1rem 1.1rem', borderRadius: 'var(--radius)', background: 'var(--surface)',
            border: '1px solid var(--border)', marginBottom: '1.5rem',
        }}>
            <p style={{ fontWeight: 800, fontSize: '1.02rem', lineHeight: 1.3 }}>{provider.name}</p>
            <p style={{ fontSize: '0.86rem', color: 'var(--gray-400)', marginTop: '0.3rem', lineHeight: 1.5 }}>{provider.address}</p>
        </div>
    );
}
