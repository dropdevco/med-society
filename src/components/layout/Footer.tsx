import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const TERMS_URL = 'https://legal.medsociety.one/terms-and-conditions';
const PRIVACY_URL = 'https://legal.medsociety.one/privacy-policy';

/**
 * Site-wide footer: copyright plus Contact and external legal links.
 * Mounted from App (hidden on research / admin), not inside each page.
 */
export function Footer() {
    const { t } = useTranslation();
    const year = new Date().getFullYear();

    return (
        <footer
            style={{
                borderTop: '1px solid var(--border)',
                padding: '2rem 1.5rem',
                textAlign: 'center',
                color: 'var(--gray-400)',
                fontSize: '0.85rem',
            }}
        >
            <p style={{ margin: '0 0 0.75rem' }}>
                {t('footer.copyright', { year })}
            </p>
            <nav
                aria-label={t('footer.navLabel')}
                style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    justifyContent: 'center',
                    gap: '0.35rem 0.85rem',
                    alignItems: 'center',
                }}
            >
                <Link
                    to="/contact"
                    style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                >
                    {t('footer.contact')}
                </Link>
                <span aria-hidden="true" style={{ color: 'var(--gray-300)' }}>|</span>
                <a
                    href={TERMS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                >
                    {t('footer.terms')}
                </a>
                <span aria-hidden="true" style={{ color: 'var(--gray-300)' }}>|</span>
                <a
                    href={PRIVACY_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)', textDecoration: 'underline' }}
                >
                    {t('footer.privacy')}
                </a>
            </nav>
        </footer>
    );
}
