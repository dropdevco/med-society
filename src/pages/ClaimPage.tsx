import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../types/provider';
import { supabase } from '../lib/supabase';
import { fetchProviderRow } from '../lib/providerRead';
import { normalizeProvider } from '../utils/normalizeProvider';
import { submitClaim } from '../lib/auth';
import { useSession } from '../hooks/useSession';
import { AuthShell, Field } from '../components/account/AuthShell';
import { authButton } from '../components/account/authStyles';
import { IconArrowRight, IconCheck } from '../components/icons/Icons';

/**
 * "Is this your clinic?" — the one route from the public directory into the
 * portal.
 *
 * Nothing here grants anything. It writes a row a person reviews, and says so
 * plainly: a claim flow that looked instant would either be a lie or an
 * invitation to take over someone else's listing.
 */
export function ClaimPage() {
    const { t } = useTranslation();
    const { providerId } = useParams<{ providerId: string }>();
    const navigate = useNavigate();
    const { user, loading: sessionLoading } = useSession();

    const [provider, setProvider] = useState<Provider | null>(null);
    const [loading, setLoading] = useState(true);
    const [evidence, setEvidence] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    useEffect(() => {
        if (!supabase || !providerId) { setLoading(false); return; }
        let live = true;
        fetchProviderRow(providerId)
            .catch(() => null)
            .then((row) => {
                if (!live) return;
                setProvider(row ? normalizeProvider(row) : null);
                setLoading(false);
            });
        return () => { live = false; };
    }, [providerId]);

    // Sign in first, and come straight back here afterwards rather than to a
    // generic dashboard — the person was halfway through claiming something.
    if (!sessionLoading && !user) {
        return <Navigate to={`/login?mode=signup&next=/claim/${providerId}`} replace />;
    }

    if (loading || sessionLoading) {
        return <AuthShell title={t('account.loading')} />;
    }

    if (!provider) {
        return (
            <AuthShell title={t('account.claimNotFound')} subtitle={t('account.claimNotFoundBody')}>
                <Link to="/" style={{ ...authButton, textDecoration: 'none' }}>
                    {t('account.backToDirectory')}
                </Link>
            </AuthShell>
        );
    }

    if (done) {
        return (
            <AuthShell title={t('account.claimSentTitle')} subtitle={t('account.claimSentBody')}>
                <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent)', marginBottom: '1.5rem' }}>
                    <IconCheck size={40} weight={2} />
                </div>
                <button onClick={() => navigate('/dashboard')} className="press" style={authButton}>
                    {t('account.goToDashboard')}
                    <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
                </button>
            </AuthShell>
        );
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        setBusy(true);
        setError(null);
        const result = await submitClaim(provider.id, user.id, evidence);
        setBusy(false);
        if (result.error) setError(result.error);
        else setDone(true);
    };

    return (
        <AuthShell title={t('account.claimTitle')} subtitle={t('account.claimBody')}>
            <div
                style={{
                    padding: '1rem 1.1rem',
                    borderRadius: 'var(--radius)',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    marginBottom: '1.5rem',
                }}
            >
                <p style={{ fontWeight: 800, fontSize: '1.02rem', lineHeight: 1.3 }}>{provider.name}</p>
                <p style={{ fontSize: '0.86rem', color: 'var(--gray-400)', marginTop: '0.3rem', lineHeight: 1.5 }}>
                    {provider.address}
                </p>
            </div>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label={t('account.evidenceLabel')} hint={t('account.evidenceHint')}>
                    <textarea
                        required
                        maxLength={2000}
                        value={evidence}
                        onChange={(e) => setEvidence(e.target.value)}
                        placeholder={t('account.evidencePlaceholder')}
                    />
                </Field>

                {error && (
                    <p role="alert" style={{ color: 'var(--red)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                        {error}
                    </p>
                )}

                <button type="submit" disabled={busy} className="press" style={authButton}>
                    {busy ? t('account.working') : t('account.claimSubmit')}
                    <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
                </button>
            </form>
        </AuthShell>
    );
}
