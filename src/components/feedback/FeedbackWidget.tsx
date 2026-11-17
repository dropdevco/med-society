import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Check, MessageSquarePlus, X } from 'lucide-react';
import { useSession } from '../../hooks/useSession';
import { recentErrors } from '../../lib/clientErrors';
import { distinctId, track } from '../../lib/posthog';
import './feedback.css';

type Kind = 'bug' | 'content' | 'idea' | 'other';
const KINDS: Kind[] = ['bug', 'content', 'idea', 'other'];
const MAX = 2000;

/** Pages where a floating button does not belong: the co-branded study, and the admin tool itself. */
const HIDDEN_ON = ['/research', '/admin'];

/** Server error code → translation key. Anything else is the generic message. */
const ERROR_KEY: Record<string, string> = {
    too_many: 'feedback.errors.tooMany',
    bad_message: 'feedback.errors.tooShort',
    message_too_long: 'feedback.errors.tooLong',
    bad_email: 'feedback.errors.badEmail',
};

/**
 * "Feedback" button, bottom-right of every page, and the small form it opens.
 *
 * What it sends is judged by api/feedback.ts, which decides whether the report
 * is real before anyone is emailed. The strongest evidence is what this tab
 * itself recorded going wrong (src/lib/clientErrors.ts), so that is attached.
 *
 * The form is a centered modal like the provider one (blurred backdrop, Esc,
 * focus trap, page scroll locked). A draft survives closing it; only a
 * successful send clears it.
 */
export function FeedbackWidget() {
    const { t, i18n } = useTranslation();
    const { pathname } = useLocation();
    const { session, user } = useSession();
    const uid = useId();

    const [open, setOpen] = useState(false);
    const [kindChoice, setKindChoice] = useState<Kind | null>(null);
    const [message, setMessage] = useState('');
    const [email, setEmail] = useState('');
    const [honeypot, setHoneypot] = useState('');
    const [phase, setPhase] = useState<'idle' | 'sending' | 'sent'>('idle');
    const [error, setError] = useState<string | null>(null);

    const fabRef = useRef<HTMLButtonElement>(null);
    const areaRef = useRef<HTMLTextAreaElement>(null);
    const doneRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLElement>(null);

    // Wrong info is the likeliest report from a clinic's page; a broken page from anywhere else.
    const kind = kindChoice ?? (pathname.startsWith('/providers/') ? 'content' : 'bug');

    const close = useCallback(() => {
        setOpen(false);
        // Once sent, the next opening starts clean.
        if (phase === 'sent') { setPhase('idle'); setMessage(''); setKindChoice(null); }
        fabRef.current?.focus();
    }, [phase]);

    useEffect(() => {
        if (!open) return;
        (phase === 'sent' ? doneRef : areaRef).current?.focus();
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { close(); return; }
            // Modal: Tab stays inside the dialog.
            if (e.key !== 'Tab' || !dialogRef.current) return;
            const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), textarea, input:not([tabindex="-1"]):not([type="radio"]), input[type="radio"]:checked',
            ));
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            const active = document.activeElement;
            if (!dialogRef.current.contains(active)) { e.preventDefault(); first.focus(); }
            else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open, phase, close]);

    // The page behind a modal must not scroll.
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    if (HIDDEN_ON.some((p) => pathname.startsWith(p))) return null;

    const toggle = () => {
        if (open) return close();
        setOpen(true);
        track('feedback_opened', { path: pathname.startsWith('/providers/') ? '/providers/:id' : pathname });
    };

    async function submit(e: FormEvent) {
        e.preventDefault();
        if (phase === 'sending') return;
        const text = message.trim();
        if (text.length < 5) { setError(t('feedback.errors.tooShort')); areaRef.current?.focus(); return; }
        setPhase('sending');
        setError(null);
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    // Links the report to the account so the team can reply; anonymous works too.
                    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
                },
                body: JSON.stringify({
                    kind,
                    message: text,
                    email: user ? '' : email.trim(),
                    website: honeypot,
                    path: pathname,
                    language: i18n.language.startsWith('es') ? 'es' : 'en',
                    viewport: `${window.innerWidth}x${window.innerHeight}`,
                    build: import.meta.env.VITE_APP_BUILD_ID,
                    phId: distinctId(),
                    errors: recentErrors(),
                }),
            });
            const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
            if (!res.ok || !json?.ok) throw new Error(json?.error ?? 'server_error');
            track('feedback_submitted', { kind });
            setPhase('sent');
        } catch (err) {
            const code = err instanceof Error ? err.message : '';
            track('feedback_failed', { kind, reason: ERROR_KEY[code] ? code : 'other' });
            setError(t(ERROR_KEY[code] ?? 'feedback.errors.generic'));
            setPhase('idle');
        }
    }

    return (
        <>
            {open && (
                <div className="fb-modal">
                    <div className="fb-backdrop" onClick={close} aria-hidden="true" />
                <section ref={dialogRef} className="fb-panel" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`}>
                    <header className="fb-head">
                        <h2 id={`${uid}-title`}>{t('feedback.title')}</h2>
                        <button type="button" className="fb-x" onClick={close} aria-label={t('feedback.close')}>
                            <X size={18} aria-hidden />
                        </button>
                    </header>

                    {phase === 'sent' ? (
                        <div className="fb-sent" role="status">
                            <span className="fb-sent-icon" aria-hidden><Check size={22} /></span>
                            <p className="fb-sent-title">{t('feedback.thanks')}</p>
                            <p className="fb-sent-sub">{t('feedback.thanksSub')}</p>
                            <button ref={doneRef} type="button" className="fb-send" onClick={close}>{t('feedback.done')}</button>
                        </div>
                    ) : (
                        <form onSubmit={submit} noValidate>
                            <fieldset className="fb-kinds">
                                <legend>{t('feedback.kindLabel')}</legend>
                                {KINDS.map((k) => (
                                    <label key={k} className={kind === k ? 'is-on' : ''}>
                                        <input type="radio" name={`${uid}-kind`} value={k} checked={kind === k} onChange={() => setKindChoice(k)} />
                                        {t(`feedback.kinds.${k}`)}
                                    </label>
                                ))}
                            </fieldset>

                            <label className="fb-field" htmlFor={`${uid}-msg`}>{t('feedback.messageLabel')}</label>
                            <textarea
                                id={`${uid}-msg`}
                                ref={areaRef}
                                value={message}
                                onChange={(e) => { setMessage(e.target.value); if (error) setError(null); }}
                                maxLength={MAX}
                                rows={4}
                                placeholder={t(`feedback.placeholder.${kind}`)}
                                aria-invalid={error ? true : undefined}
                                aria-describedby={`${uid}-hint`}
                            />

                            {!user && (
                                <>
                                    <label className="fb-field" htmlFor={`${uid}-email`}>{t('feedback.emailLabel')}</label>
                                    <input
                                        id={`${uid}-email`}
                                        type="email"
                                        inputMode="email"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        maxLength={200}
                                    />
                                </>
                            )}

                            {/* Honeypot: invisible to people, tempting to bots. */}
                            <input
                                className="fb-hp"
                                type="text"
                                name="website"
                                tabIndex={-1}
                                autoComplete="off"
                                aria-hidden
                                value={honeypot}
                                onChange={(e) => setHoneypot(e.target.value)}
                            />

                            <p id={`${uid}-hint`} className="fb-hint">{t('feedback.privacy')}</p>
                            {error && <p className="fb-err" role="alert">{error}</p>}

                            <button type="submit" className="fb-send" disabled={phase === 'sending'}>
                                {phase === 'sending' ? t('feedback.sending') : t('feedback.send')}
                            </button>
                        </form>
                    )}
                </section>
                </div>
            )}

            <button
                ref={fabRef}
                type="button"
                className={`fb-fab${open ? ' is-open' : ''}`}
                onClick={toggle}
                aria-expanded={open}
                aria-label={t('feedback.openLabel')}
            >
                <MessageSquarePlus size={20} aria-hidden />
                <span className="fb-fab-text">{t('feedback.open')}</span>
            </button>
        </>
    );
}
