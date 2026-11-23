import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

/**
 * Any address the app has no page for. It used to redirect to the directory,
 * which hid broken links from visitors and showed crawlers the home page at
 * every mistyped URL. Now it says so, is `noindex`, and links to the two
 * places a visitor most likely wanted.
 */
export function NotFoundPage() {
    const { t } = useTranslation();
    useDocumentTitle(t('pageNotFound.pageTitle'), { noindex: true });

    const link: React.CSSProperties = {
        display: 'inline-block',
        padding: '0.7rem 1.1rem',
        borderRadius: 'var(--radius-pill)',
        textDecoration: 'none',
        fontWeight: 500,
    };

    return (
        <main id="main-content" style={{ paddingTop: 68 }}>
            <section style={{ maxWidth: 560, margin: '0 auto', padding: '4rem 1.25rem', textAlign: 'center' }}>
                <h1
                    style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
                        fontWeight: 400,
                        margin: '0 0 1rem',
                        letterSpacing: '-0.02em',
                    }}
                >
                    {t('pageNotFound.title')}
                </h1>
                <p style={{ color: 'var(--gray-400)', margin: '0 0 2rem', lineHeight: 1.6 }}>
                    {t('pageNotFound.body')}
                </p>
                <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Link to="/" style={{ ...link, background: 'var(--brand)', color: 'var(--on-brand)' }}>
                        {t('pageNotFound.directory')}
                    </Link>
                    <Link to="/hotels" style={{ ...link, border: '1px solid var(--border)', color: 'inherit' }}>
                        {t('pageNotFound.hotels')}
                    </Link>
                </div>
            </section>
        </main>
    );
}
