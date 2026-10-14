import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Logo } from '../brand/Logo';
import { IconSun, IconMoon, IconLanguage } from '../icons/Icons';
import { useSession } from '../../hooks/useSession';
import { useIsClinician } from '../../hooks/useIsClinician';
import { FORUMS_LISTED, FORUM_PATH } from '../../lib/forumRoutes';

/**
 * Light is the product default. A previously stored preference still wins,
 * so anyone who deliberately chose dark keeps it across visits.
 */
function initialTheme(): string {
    return localStorage.getItem('theme') || 'light';
}

export function Navbar() {
    const { pathname } = useLocation();
    const { t, i18n } = useTranslation();
    const [theme, setTheme] = useState<string>(initialTheme);
    const { session, user } = useSession();
    // Only the (unlisted-until-launch) Med Society link needs this answer.
    const { isClinician } = useIsClinician(FORUMS_LISTED ? user?.id ?? null : null);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const isSpanish = i18n.language.startsWith('es');

    return (
        <nav
            className="ms-nav"
            style={{
                position: 'fixed',
                top: 0, left: 0, right: 0,
                zIndex: 100,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 1.5rem',
                height: '68px',
                background: 'var(--nav-bg)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderBottom: '1px solid var(--nav-border)',
            }}
        >
            {/* On a phone the wordmark is hidden and the shield alone is 34px.
                The padding grows the tap target to 44px; the negative margin
                keeps the layout where it was. */}
            <Link
                to="/"
                aria-label="MedSociety home"
                style={{ display: 'flex', alignItems: 'center', padding: '0.4rem 0.5rem', margin: '-0.4rem -0.5rem' }}
            >
                <Logo size={34} idle />
            </Link>

            <div className="ms-nav-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div className="ms-nav-links" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <NavLink to="/" label={t('nav.findProviders')} active={pathname === '/'} />
                    {/* Unlisted until the forums launch (lib/forumRoutes.ts). */}
                    {FORUMS_LISTED && (
                        <NavLink to={FORUM_PATH.patients} label={t('nav.askDoctor')} active={pathname.startsWith(FORUM_PATH.patients)} />
                    )}
                    {FORUMS_LISTED && isClinician && (
                        <NavLink to={FORUM_PATH.society} label={t('nav.medSociety')} active={pathname.startsWith(FORUM_PATH.society)} />
                    )}
                </div>

                {/*
                  The clinic-facing page used to be a peer nav link, which made
                  the one thing we want a clinic owner to do look like a second
                  tab of the directory they were already reading. It is a call
                  to action now, and it goes straight to what a listing costs
                  rather than to a page about the idea of listing.
                */}
                <Link
                    to="/pricing"
                    className="ms-nav-cta press"
                    aria-current={pathname === '/pricing' ? 'page' : undefined}
                >
                    {t('nav.listYourClinic')}
                </Link>

                {/*
                  One link either way. Signed out it says "sign in"; signed in
                  it goes to the dashboard — the destination is the same route
                  and the guard there decides, so the nav never has to know
                  whether a session is still loading.
                */}
                <Link
                    to={session ? '/dashboard' : '/login'}
                    className="ms-nav-account"
                    aria-current={pathname === '/dashboard' ? 'page' : undefined}
                >
                    {session ? t('nav.myClinic') : t('nav.signIn')}
                </Link>

                {/*
                  Both languages stay on screen rather than showing only the
                  active one — a single "ES" pill makes you guess whether
                  clicking it means "switch to Spanish" or "you're in
                  Spanish, click to leave". Two labels with one highlighted
                  removes the guess.
                */}
                <div
                    role="group"
                    aria-label={t('nav.languageGroup', { defaultValue: 'Language' })}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.2rem',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '3px',
                    }}
                >
                    <IconLanguage size={14} style={{ color: 'var(--gray-400)', margin: '0 0.2rem' }} />
                    <LangOption
                        label="EN"
                        active={!isSpanish}
                        title={t('nav.switchToEnglish')}
                        onClick={() => i18n.changeLanguage('en')}
                    />
                    <LangOption
                        label="ES"
                        active={isSpanish}
                        title={t('nav.switchToSpanish')}
                        onClick={() => i18n.changeLanguage('es')}
                    />
                </div>

                <button
                    className="press"
                    onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                    title={t('nav.toggleTheme')}
                    aria-label={t('nav.toggleTheme')}
                    style={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        color: 'var(--white)',
                        width: 38, height: 38,
                        borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--gold)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                    {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
                </button>
            </div>
        </nav>
    );
}

function LangOption({ label, active, title, onClick }: {
    label: string; active: boolean; title: string; onClick: () => void;
}) {
    return (
        <button
            className="press"
            onClick={onClick}
            aria-pressed={active}
            title={title}
            aria-label={title}
            style={{
                padding: '0.3rem 0.6rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.76rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                whiteSpace: 'nowrap',
                color: active ? 'var(--on-brand)' : 'var(--gray-400)',
                background: active ? 'var(--brand)' : 'transparent',
            }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = 'var(--white)'; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = 'var(--gray-400)'; }}
        >
            {label}
        </button>
    );
}

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
    return (
        <Link
            to={to}
            className="press ms-nav-link"
            style={{
                padding: '0.45rem 0.95rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.9rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: active ? 'var(--on-brand)' : 'var(--gray-300)',
                background: active ? 'var(--brand)' : 'transparent',
                border: `1px solid ${active ? 'var(--brand)' : 'transparent'}`,
            }}
            onMouseEnter={(e) => {
                if (!active) {
                    const el = e.currentTarget as HTMLElement;
                    el.style.color = 'var(--white)';
                    el.style.background = 'var(--surface)';
                }
            }}
            onMouseLeave={(e) => {
                if (!active) {
                    const el = e.currentTarget as HTMLElement;
                    el.style.color = 'var(--gray-300)';
                    el.style.background = 'transparent';
                }
            }}
        >
            {label}
        </Link>
    );
}
