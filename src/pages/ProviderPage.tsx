import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProvider } from '../hooks/useProvider';
import { ProviderView } from '../components/provider/ProviderView';
import { usePageMeta } from '../hooks/usePageMeta';
import { LogoMark } from '../components/brand/Logo';
import { IconChevronLeft } from '../components/icons/Icons';

const NAV_HEIGHT = 68;

/**
 * The dedicated page for one provider — what used to be a side-panel pop-up
 * (`ProviderDrawer`) that covered the results list. A URL of its own is the
 * whole point: it can be bookmarked, shared, opened in a new tab, and it
 * survives a refresh, none of which a `selectedProvider` piece of page state
 * ever could.
 */
export function ProviderPage() {
    const { t } = useTranslation();
    const { providerId } = useParams<{ providerId: string }>();
    const { provider, loading } = useProvider(providerId);
    const navigate = useNavigate();
    const location = useLocation();

    usePageMeta(provider);

    const goBack = () => {
        // `location.key === 'default'` means this tab has no in-app history to
        // go back to — a direct link or a hard refresh — so Back has nothing
        // to land on and would leave the app entirely (or do nothing).
        if (location.key !== 'default') navigate(-1);
        else navigate('/');
    };

    if (loading) {
        return (
            <main className="ms-page" id="main-content" style={{ paddingTop: NAV_HEIGHT }}>
                <div style={{ maxWidth: 1080, margin: '0 auto', padding: '2rem 1.25rem' }}>
                    <div className="skeleton" style={{ width: 140, height: 30, borderRadius: 8, marginBottom: '1.5rem' }} />
                    <div className="skeleton" style={{ width: '100%', height: 180, borderRadius: 'var(--radius)', marginBottom: '1.25rem' }} />
                    <div className="skeleton" style={{ width: '60%', height: 28, borderRadius: 8, marginBottom: '0.75rem' }} />
                    <div className="skeleton" style={{ width: '40%', height: 18, borderRadius: 8 }} />
                </div>
            </main>
        );
    }

    if (!provider) {
        return (
            <main className="ms-page" id="main-content" style={{ paddingTop: NAV_HEIGHT }}>
                <div style={{
                    maxWidth: 480, margin: '0 auto', padding: '4rem 1.25rem', textAlign: 'center',
                }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.25rem', color: 'var(--gray-500)' }}>
                        <LogoMark size={40} />
                    </div>
                    <p style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem' }}>
                        {t('providerPage.notFoundTitle')}
                    </p>
                    <p style={{ fontSize: '0.9rem', color: 'var(--gray-400)', marginBottom: '1.75rem', lineHeight: 1.55 }}>
                        {t('providerPage.notFoundBody')}
                    </p>
                    <Link
                        to="/"
                        className="press"
                        style={{
                            display: 'inline-flex', padding: '0.7rem 1.4rem',
                            borderRadius: 'var(--radius-pill)', background: 'var(--brand)',
                            color: 'var(--on-brand)', fontWeight: 700, fontSize: '0.9rem',
                            textDecoration: 'none',
                        }}
                    >
                        {t('providerPage.backToDirectory')}
                    </Link>
                </div>
            </main>
        );
    }

    return (
        <main className="ms-page" id="main-content" style={{ paddingTop: NAV_HEIGHT }}>
            <div style={{ maxWidth: 1080, margin: '0 auto', padding: '1.5rem 1.25rem 4rem' }}>
                <button
                    onClick={goBack}
                    className="press"
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        background: 'none', color: 'var(--gray-400)', fontWeight: 650,
                        fontSize: '0.85rem', padding: '0.3rem 0', marginBottom: '1.25rem',
                    }}
                >
                    <IconChevronLeft size={16} weight={2} /> {t('providerPage.backToResults')}
                </button>
                <ProviderView provider={provider} />
            </div>
        </main>
    );
}
