import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useSession } from '../hooks/useSession';
import { useNoIndex } from '../hooks/useNoIndex';
import { signOut } from '../lib/auth';
import { acceptInvite, invitePreview, type InvitePreview } from '../lib/team';
import { AuthShell } from '../components/account/AuthShell';
import { authButton } from '../components/account/authStyles';

/**
 * Where an invitation email lands: /invite/:token.
 *
 * Signed out, it says who invited you to what and sends you to sign up or in
 * (with ?next= back here). Signed in with the invited email, one button
 * accepts. Signed in as someone else, it says so plainly — the database will
 * refuse anyway, and "permission denied" is not an explanation.
 */
export function InvitePage() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { token = '' } = useParams<{ token: string }>();
    const { user, loading: sessionLoading } = useSession();
    const [preview, setPreview] = useState<InvitePreview | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useNoIndex();

    useEffect(() => {
        let cancelled = false;
        void invitePreview(token).then((res) => {
            if (!cancelled) setPreview(res.data ?? { state: 'invalid' });
        });
        return () => { cancelled = true; };
    }, [token]);

    if (sessionLoading || !preview) return <AuthShell title={t('account.loading')} />;

    if (preview.state !== 'valid') {
        return (
            <AuthShell title={t(`invite.state.${preview.state}`)} subtitle={t('invite.askAgain')}>
                <Link to="/dashboard" style={{ ...authButton, textDecoration: 'none' }}>{t('invite.toDashboard')}</Link>
            </AuthShell>
        );
    }

    const practitioner = preview.kind === 'practitioner';
    const title = practitioner
        ? t('invite.titlePractitioner', { clinic: preview.clinic_name })
        : t('invite.titleTeam', { clinic: preview.clinic_name });
    const body = practitioner
        ? t('invite.bodyPractitioner', { name: preview.provider_name, clinic: preview.clinic_name })
        : t(`invite.bodyTeam.${preview.role}`, { clinic: preview.clinic_name });

    const next = `/invite/${encodeURIComponent(token)}`;
    const invitedEmail = (preview.email ?? '').toLowerCase();
    const wrongAccount = !!user && (user.email ?? '').toLowerCase() !== invitedEmail;
    const unconfirmed = !!user && !wrongAccount && !user.email_confirmed_at;

    const accept = async () => {
        setBusy(true);
        setError(null);
        const res = await acceptInvite(token);
        setBusy(false);
        if (res.error) {
            setError(t(`team.err.${res.error}`, { defaultValue: t('team.err.unknown') }));
            return;
        }
        // A doctor invited to their own listing still verifies who they are:
        // the invite opened a claim, which they finish on the claim page.
        if (res.data?.status === 'claim') navigate(`/claim/${res.data.provider_id}`, { replace: true });
        else navigate('/dashboard', { replace: true });
    };

    return (
        <AuthShell title={title} subtitle={body}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <p className="acct-muted">{t('invite.forEmail', { email: preview.email })}</p>

                {!user && (
                    <>
                        <Link to={`/login?mode=signup&next=${encodeURIComponent(next)}`} state={{ email: preview.email }}
                            style={{ ...authButton, textDecoration: 'none' }}>
                            {t('invite.createAccount')}
                        </Link>
                        <Link to={`/login?next=${encodeURIComponent(next)}`} state={{ email: preview.email }}
                            className="acct-link" style={{ textAlign: 'center' }}>
                            {t('invite.haveAccount')}
                        </Link>
                    </>
                )}

                {wrongAccount && (
                    <>
                        <p className="acct-msg acct-msg--error acct-msg--block">
                            {t('invite.wrongAccount', { current: user?.email, invited: preview.email })}
                        </p>
                        <button type="button" style={authButton} onClick={() => { void signOut(); }}>
                            {t('invite.switchAccount')}
                        </button>
                    </>
                )}

                {unconfirmed && <p className="acct-muted">{t('invite.confirmFirst')}</p>}

                {user && !wrongAccount && !unconfirmed && (
                    <button type="button" style={authButton} disabled={busy} onClick={() => void accept()}>
                        {busy ? t('account.working') : t('invite.accept')}
                    </button>
                )}

                {error && <p className="acct-msg acct-msg--error" role="alert">{error}</p>}
            </div>
        </AuthShell>
    );
}
