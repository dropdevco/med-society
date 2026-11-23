import { useState } from 'react';
import { isEmbeddedBrowser, signInWithGoogle } from '../../lib/auth';

/**
 * "Continue with Google", shared by the login page and the border-health
 * onboarding. Each passes its own words, because the onboarding keeps its
 * strings in its own bilingual table rather than in i18next.
 *
 * Inside an in-app browser (WhatsApp, Instagram, Facebook) Google refuses to
 * sign anyone in, so the button is replaced by a line saying to open the page
 * in the phone's browser. Email and password stay available beside it.
 */
export function GoogleButton({ redirectTo, label, embeddedHint, onStart, onError }: {
    /** Absolute URL on this site, on the Supabase redirect allowlist. */
    redirectTo: string;
    label: string;
    embeddedHint: string;
    /** Runs just before leaving the page, e.g. to stash a half-finished request. */
    onStart?: () => void;
    onError?: (message: string) => void;
}) {
    const [busy, setBusy] = useState(false);

    if (isEmbeddedBrowser()) {
        return (
            <p style={{ fontSize: '0.82rem', lineHeight: 1.5, color: 'var(--gray-500)', textAlign: 'center' }}>
                {embeddedHint}
            </p>
        );
    }

    const go = async () => {
        setBusy(true);
        onStart?.();
        const { error } = await signInWithGoogle(redirectTo);
        // Success navigates away; only a failure gets here.
        if (error) {
            setBusy(false);
            onError?.(error);
        }
    };

    return (
        <button
            type="button"
            onClick={go}
            disabled={busy}
            className="press"
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.65rem',
                width: '100%',
                padding: '0.8rem 1.5rem',
                borderRadius: 'var(--radius-pill)',
                background: '#fff',
                color: '#1f1f1f',
                border: '1px solid var(--border-strong)',
                fontWeight: 600,
                fontSize: '0.95rem',
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.7 : 1,
            }}
        >
            <GoogleMark />
            {label}
        </button>
    );
}

/** Google's "G", in its own colours: Google's branding rules do not allow recolouring it. */
function GoogleMark() {
    return (
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
    );
}
