import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { safeNext, signIn, signInWithPasskey, signUp, supportsPasskeys } from '../lib/auth';
import { GoogleButton } from '../components/account/GoogleButton';
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
    // An invitation passes the invited address in router state (never the
    // URL), so the invitee signs up with the email the invite is bound to.
    const location = useLocation();
    const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(() =>
        new URLSearchParams(window.location.hash.replace(/^#/, '')).get('error')
            || new URLSearchParams(window.location.search).get('error')
            ? t('account.googleDenied')
            : null);
    const [checkInbox, setCheckInbox] = useState(false);

    // Same-site path only: this is spliced into redirect URLs below.
    const next = safeNext(params.get('next'));

    // Google sends a failed or cancelled sign-in back here with the reason in
    // the hash (implicit flow) or the query. Read once, then clear the URL so
    // a refresh does not show it again.
    const [returnedError] = useState(() => {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        return hash.get('error') ?? params.get('error');
    });
    useEffect(() => {
        if (returnedError && window.location.hash) {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }, [returnedError]);

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
            {/* Back to /login (not straight to `next`) so a failed Google sign-in has
                somewhere to report to; a successful one is forwarded by the
                signed-in redirect above. */}
            <GoogleButton
                redirectTo={`${window.location.origin}/login?next=${encodeURIComponent(next)}`}
                label={t('account.googleContinue')}
                embeddedHint={t('account.googleEmbedded')}
                onError={setError}
            />
            {mode === 'in' && supportsPasskeys() && (
                <button
                    type="button"
                    disabled={busy}
                    className="press"
                    onClick={async () => {
                        setBusy(true); setError(null);
                        const r = await signInWithPasskey();
                        setBusy(false);
                        // Success: the session listener forwards to `next`.
                        if (r.error) setError(t('account.passkeyFailed'));
                    }}
                    style={{ ...authButton, width: '100%', marginTop: '0.6rem', background: 'transparent', color: 'var(--text, inherit)', border: '1px solid var(--border-strong)', fontWeight: 600 }}
                >
                    {t('account.passkeySignIn')}
                </button>
            )}
            <p style={{ margin: '1.1rem 0', textAlign: 'center', fontSize: '0.8rem', color: 'var(--gray-500)' }}>
                {t('account.googleOr')}
            </p>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <Field label={t('account.email')}>
                    <input
                        type="email"
                        name="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </Field>

                <Field label={t('account.password')}>
                    <input
                        type="password"
                        name="password"
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
