import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { signIn, signUp } from '../lib/auth';
import { useSession } from '../hooks/useSession';
import { FORUM_PATH } from '../lib/forumRoutes';
import { IconArrowRight, IconCheck } from '../components/icons/Icons';
import { AuthShell, Field } from '../components/account/AuthShell';
import { authButton } from '../components/account/authStyles';

/**
 * One page for both signing in and signing up.
 *
 * Two pages with near-identical forms is two places to keep the copy, the
 * validation and the redirect in step, and the person arriving from "claim
 * this clinic" does not know yet which one they need. `?mode=signup` picks the
 * starting tab; `?next=` remembers where they were going.
 */
export function LoginPage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { user, loading: sessionLoading } = useSession();

    const [mode, setMode] = useState<'in' | 'up'>(params.get('mode') === 'signup' ? 'up' : 'in');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [checkInbox, setCheckInbox] = useState(false);

    const next = params.get('next') || '/dashboard';

    // Already signed in: nothing to do here. Declared rather than called —
    // navigate() during render mutates the router mid-paint, which React warns
    // about and which double-invokes under StrictMode. Replace rather than
    // push, so Back does not bounce straight back to this page.
    if (!sessionLoading && user) {
        return <Navigate to={next} replace />;
    }

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);

        const result = mode === 'in'
            ? await signIn(email, password)
            // The confirmation link returns them to where they were going (a
            // patient asking a question, not the clinic dashboard).
            : await signUp(email, password, `${window.location.origin}${next}`);

        setBusy(false);

        if (result.error) {
            setError(result.error);
            return;
        }

        if (mode === 'up') {
            // A project with email confirmation on returns a user with no
            // session, so there is nowhere to navigate to yet. Say so rather
            // than dropping them on a dashboard that will bounce them back.
            setCheckInbox(true);
            return;
        }

        navigate(next, { replace: true });
    };

    if (checkInbox) {
        return (
            <AuthShell title={t('account.checkInboxTitle')} subtitle={t('account.checkInboxBody', { email })}>
                <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent)' }}>
                    <IconCheck size={40} weight={2} />
                </div>
            </AuthShell>
        );
    }

    return (
        <AuthShell
            title={mode === 'in' ? t('account.signInTitle') : t('account.signUpTitle')}
            subtitle={next.startsWith(FORUM_PATH.patients)
                ? t('account.communityBody')
                // Sent here from a clinic page to message it: say why, and that the draft is safe.
                : next.startsWith('/providers/')
                    ? t('account.messageBody')
                    : mode === 'in' ? t('account.signInBody') : t('account.signUpBody')}
        >
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label={t('account.email')}>
                    <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </Field>

                <Field label={t('account.password')}>
                    <input
                        type="password"
                        required
                        minLength={8}
                        autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </Field>

                {error && (
                    <p role="alert" style={{ color: 'var(--red)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                        {error}
                    </p>
                )}

                <button type="submit" disabled={busy} className="press" style={authButton}>
                    {busy ? t('account.working') : mode === 'in' ? t('account.signIn') : t('account.signUp')}
                    <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
                </button>
            </form>

            <p style={{ marginTop: '1.4rem', fontSize: '0.86rem', color: 'var(--gray-400)', textAlign: 'center' }}>
                {mode === 'in' ? t('account.noAccount') : t('account.haveAccount')}{' '}
                <button
                    onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setError(null); }}
                    style={{ background: 'none', color: 'var(--accent)', fontWeight: 700, textDecoration: 'underline' }}
                >
                    {mode === 'in' ? t('account.signUp') : t('account.signIn')}
                </button>
            </p>

            <p style={{ marginTop: '0.8rem', fontSize: '0.82rem', color: 'var(--gray-500)', textAlign: 'center' }}>
                <Link to="/pricing" style={{ textDecoration: 'underline' }}>{t('account.whatIsThis')}</Link>
            </p>
        </AuthShell>
    );
}
