import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '../brand/Logo';

/**
 * The centred card every account screen sits in, plus the form primitives the
 * portal shares.
 *
 * Deliberately not a copy of InquiryModal's local `Field`/`inputStyle`: that
 * one is a modal over a marketing page, this is a page in its own right. What
 * they do share is the input styling, and it is defined once here so the
 * portal does not drift into looking like a different product from the
 * directory it belongs to.
 */
export function AuthShell({ title, subtitle, children, wide = false }: {
    title: string;
    subtitle?: string;
    /** Optional: a loading or not-found screen is a title and nothing else. */
    children?: ReactNode;
    wide?: boolean;
}) {
    return (
        <main
            id="main-content"
            style={{
                minHeight: '100vh',
                paddingTop: 68,
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'center',
                background: 'var(--surface)',
            }}
        >
            <div
                className="ms-auth-card"
                style={{
                    width: '100%',
                    maxWidth: wide ? 780 : 420,
                    margin: '3.5rem 1.25rem 5rem',
                    padding: '2.25rem',
                    background: 'var(--navy-800)',
                    border: '1px solid var(--border)',
                    borderRadius: 'calc(var(--radius) + 4px)',
                    boxShadow: 'var(--shadow-sm)',
                }}
            >
                <Link to="/" aria-label="MedSociety" style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.4rem' }}>
                    <LogoMark size={34} />
                </Link>

                <h1
                    className="display"
                    style={{ fontSize: '1.8rem', textAlign: 'center', lineHeight: 1.2, marginBottom: subtitle ? '0.6rem' : '1.6rem' }}
                >
                    {title}
                </h1>

                {subtitle && (
                    <p style={{
                        textAlign: 'center', color: 'var(--gray-400)',
                        fontSize: '0.92rem', lineHeight: 1.6, marginBottom: '1.7rem',
                    }}>
                        {subtitle}
                    </p>
                )}

                {children}
            </div>
        </main>
    );
}

/**
 * Label plus control. The input styling is applied by `.ms-auth-card input`
 * and friends in index.css rather than inline, so a field can be a text input,
 * a textarea or a select without this component knowing which.
 */
export function Field({ label, hint, children }: {
    label: string;
    hint?: string;
    children: ReactNode;
}) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-300)' }}>
                {label}
            </span>
            {children}
            {hint && (
                <span style={{ fontSize: '0.76rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>
                    {hint}
                </span>
            )}
        </label>
    );
}
