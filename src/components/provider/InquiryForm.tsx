import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { sendInquiry } from '../../lib/inquiries';
import { clearDraft, loadDraft, saveDraft } from '../../lib/inquiryDraft';
import { useSession } from '../../hooks/useSession';
import { track } from '../../lib/posthog';
import { providerProps } from '../../utils/analytics';
import { hueOf, portraitUrlSized } from '../../utils/images';
import { IconCheck, IconPhone } from '../icons/Icons';

const MAX_MESSAGE = 1000;
/** The character count only appears when the limit is in sight; until then it is noise. */
const COUNT_FROM = MAX_MESSAGE * 0.8;
type Status = 'idle' | 'sending' | 'sent' | 'error';
type ErrorKind = 'server' | 'network' | 'too_many' | 'auth';

/**
 * One-tap openers, like the suggested replies in a messaging app. Each drops a
 * ready-made sentence into the message, so the most common questions cost a
 * tap and a blank box is never the first thing a patient has to fill.
 */
const STARTERS = [
    { id: 'prices', label: 'inquiry.starterPrices', text: 'inquiry.starterPricesText' },
    { id: 'availability', label: 'inquiry.starterAvailability', text: 'inquiry.starterAvailabilityText' },
    { id: 'insurance', label: 'inquiry.starterInsurance', text: 'inquiry.starterInsuranceText' },
    { id: 'english', label: 'inquiry.starterEnglish', text: 'inquiry.starterEnglishText' },
] as const;

/** 'email' | 'phone' | null while the field is empty or still ambiguous. */
function detectKind(value: string): 'email' | 'phone' | null {
    const v = value.trim();
    if (!v) return null;
    if (v.includes('@')) return 'email';
    return /^[\d\s+().-]+$/.test(v) ? 'phone' : null;
}

function contactValid(value: string): boolean {
    const v = value.trim();
    const kind = detectKind(v);
    if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
    if (kind === 'phone') {
        const digits = v.replace(/\D/g, '').length;
        return digits >= 8 && digits <= 15;
    }
    return false;
}

const TITLES = /^(dr|dra|drs|lic|mtro|mtra|c\.?d|md|dds|dmd)\.?$/i;

/** "Dra. Ana López" → "AL"; the title is not part of the name. */
function initialsOf(name: string): string {
    const words = name.split(/\s+/).filter((w) => w && !TITLES.test(w));
    const letters = (words.length ? words : name.split(/\s+/)).slice(0, 2).map((w) => w.charAt(0).toUpperCase());
    return letters.join('') || '?';
}

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function UserIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...stroke}>
            <circle cx="12" cy="8" r="3.6" />
            <path d="M4.5 20c.9-3.6 3.9-5.6 7.5-5.6s6.6 2 7.5 5.6" />
        </svg>
    );
}

function UserPlusIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...stroke}>
            <circle cx="10" cy="8" r="3.5" />
            <path d="M3.5 20c.8-3.5 3.4-5.5 6.5-5.5 1.1 0 2.2.3 3.1.8" />
            <path d="M19 8.5v6M16 11.5h6" />
        </svg>
    );
}

function MailIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...stroke}>
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="m4 7 8 6 8-6" />
        </svg>
    );
}

function SendIcon() {
    return (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" {...stroke}>
            <path d="M21 3 10.4 13.6" />
            <path d="M21 3l-6.7 18-3.9-7.4L3 9.7 21 3z" />
        </svg>
    );
}

/** The clinic's portrait when there is a real one, else its monogram (as on the cards). */
function ClinicAvatar({ provider }: { provider: Provider }) {
    const photo = portraitUrlSized(provider.imageUrl, 'thumb');
    return (
        <span
            className={`inq-avatar${photo ? '' : ' ms-mono'}`}
            style={{ ['--mono-h' as string]: `${hueOf(provider.id)}deg` } as React.CSSProperties}
            aria-hidden="true"
        >
            {photo ? <img src={photo} alt="" width={34} height={34} loading="lazy" decoding="async" /> : initialsOf(provider.name)}
        </span>
    );
}

/**
 * A patient's message to a clinic, written as a message rather than filled in
 * as a form — and sent from an account.
 *
 * The clinic speaks first (a greeting bubble), the patient answers in one
 * compose card, and what they sent comes back as a conversation.
 *
 * Sending needs an account (api/inquiry.ts enforces it; this only explains it).
 * A visitor who is signed out can still write: the message is the part worth
 * not losing, so it is kept while they create an account and is waiting,
 * with their email already filled in as the way to reach them, when they come
 * back. Asking for the account at the moment of sending — after the question is
 * written — rather than in front of an empty box.
 */
export function InquiryForm({ provider, onSent }: { provider: Provider; onSent?: () => void }) {
    const { t, i18n } = useTranslation();
    const navigate = useNavigate();
    const uid = useId();
    const { user, loading: checkingSession } = useSession();

    // A message written before signing up, restored once; see lib/inquiryDraft.ts.
    const [draft] = useState(() => loadDraft(provider.id));
    const [message, setMessage] = useState(draft?.message ?? '');
    const [restored, setRestored] = useState(draft !== null);

    // null = untouched, so the account's own details fill in until the patient
    // types something else (derived, not copied into state by an effect).
    const [nameInput, setNameInput] = useState<string | null>(null);
    const [contactInput, setContactInput] = useState<string | null>(null);
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const accountName = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : '';
    const name = nameInput ?? accountName;
    const contact = contactInput ?? user?.email ?? '';

    const [honeypot, setHoneypot] = useState('');
    const [touched, setTouched] = useState({ name: false, contact: false, message: false });
    const [status, setStatus] = useState<Status>('idle');
    const [errorKind, setErrorKind] = useState<ErrorKind>('server');
    // Blocks a second submit in the same tick, before state has re-rendered.
    const inFlight = useRef(false);
    const textRef = useRef<HTMLTextAreaElement>(null);
    const formRef = useRef<HTMLFormElement>(null);

    const kind = detectKind(contact);
    const errors = {
        name: name.trim().length < 2 ? t('inquiry.errName') : '',
        contact: contactValid(contact) ? '' : t('inquiry.errContact'),
        message:
            message.trim().length < 5
                ? t('inquiry.errMessage')
                : message.length > MAX_MESSAGE
                  ? t('inquiry.errTooLong', { max: MAX_MESSAGE })
                  : '',
    };
    const show = (k: keyof typeof errors) => touched[k] && errors[k];

    // The message box grows with what is written, up to a cap, then scrolls.
    useLayoutEffect(() => {
        const el = textRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
    }, [message, status, user]);

    // Back from signing up with a message waiting: bring it into view, so the
    // patient lands on the thing they came to do rather than the top of the page.
    const signedIn = Boolean(user);
    useEffect(() => {
        if (restored && signedIn) formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [restored, signedIn]);

    const reset = () => {
        setMessage('');
        setNameInput(null);
        setContactInput(null);
        setRestored(false);
        setTouched({ name: false, contact: false, message: false });
        setStatus('idle');
    };

    const addStarter = (text: string) => {
        setMessage((m) => {
            const base = m.trimEnd();
            if (base.includes(text)) return m;
            return base ? `${base} ${text}` : text;
        });
        // Back into the box with the caret at the end, ready to add to it.
        requestAnimationFrame(() => {
            const el = textRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        });
    };

    /**
     * To the account page and back. The draft is saved first so the message is
     * still here on return; `next` is this provider, so a confirmation link
     * opened in another tab lands on the same clinic.
     */
    const goAuth = (mode: 'up' | 'in') => {
        if (mode === 'up' && errors.message) {
            // Nothing worth saving yet — and nothing to come back to.
            setTouched((s) => ({ ...s, message: true }));
            textRef.current?.focus();
            return;
        }
        track('inquiry_login_prompt', { provider_id: provider.id, mode });
        saveDraft(provider.id, { message });
        const next = encodeURIComponent(`/providers/${provider.id}`);
        navigate(`/login?${mode === 'up' ? 'mode=signup&' : ''}next=${next}`);
    };

    async function submit(e?: FormEvent) {
        e?.preventDefault();
        if (!user) return goAuth('up');
        if (inFlight.current || status === 'sending') return;
        setTouched({ name: true, contact: true, message: true });
        if (errors.name || errors.contact || errors.message) return;

        inFlight.current = true;
        setStatus('sending');
        const result = await sendInquiry({
            providerId: provider.id,
            providerName: provider.name,
            name: name.trim(),
            contact: contact.trim(),
            message: message.trim(),
            language: i18n.language?.startsWith('en') ? 'en' : 'es',
            sourceUrl: window.location.href,
            website: honeypot,
        });
        inFlight.current = false;

        if (result.ok) {
            track('inquiry_sent', providerProps(provider, { message_length: message.trim().length }));
            clearDraft(provider.id);
            setStatus('sent');
            onSent?.();
        } else {
            track('inquiry_failed', { provider_id: provider.id, reason: result.error });
            setErrorKind(
                result.error === 'network' ? 'network' : result.error === 'too_many' ? 'too_many' : result.error === 'auth' ? 'auth' : 'server',
            );
            setStatus('error');
        }
    }

    if (status === 'sent') {
        // What the patient wrote, sent as their own bubble, then our answer —
        // so "sent" looks like a message that went, not a form that cleared.
        return (
            <div className="inq inq-sent" role="status">
                <span className="inq-sr">{t('inquiry.successTitle')}</span>
                <div className="inq-line is-out">
                    <div className="inq-bubble is-out">{message.trim()}</div>
                </div>
                <p className="inq-delivered">
                    <IconCheck size={13} weight={2.6} /> {t('inquiry.delivered')}
                </p>
                <div className="inq-line is-in is-late">
                    <span className="inq-avatar is-brand" aria-hidden="true"><IconCheck size={16} weight={2.4} /></span>
                    <div className="inq-bubble is-in">
                        <span className="inq-sender">MedSociety</span>
                        <p>
                            {t('inquiry.successReply', {
                                name: name.trim().split(/\s+/)[0],
                                clinic: provider.name,
                                contact: contact.trim(),
                            })}
                        </p>
                    </div>
                </div>
                <button type="button" className="inq-link" onClick={reset}>
                    {t('inquiry.sendAnother')}
                </button>
            </div>
        );
    }

    const sending = status === 'sending';
    const hint =
        kind === 'email' ? t('inquiry.hintEmail') : kind === 'phone' ? t('inquiry.hintPhone') : t('inquiry.hintIdle');
    const errorText =
        errorKind === 'network'
            ? t('inquiry.errorNetwork')
            : errorKind === 'too_many'
              ? t('inquiry.errorTooMany')
              : errorKind === 'auth'
                ? t('inquiry.errorAuth')
                : t('inquiry.errorGeneric');

    return (
        <form ref={formRef} className="inq" onSubmit={submit} noValidate aria-busy={sending}>
            <h3 className="inq-sr">{t('inquiry.messageTitle', { clinic: provider.name })}</h3>

            {/* The clinic speaks first. */}
            <div className="inq-line is-in">
                <ClinicAvatar provider={provider} />
                <div className="inq-bubble is-in">
                    <span className="inq-sender">{provider.name}</span>
                    <p>{t('inquiry.greeting')}</p>
                </div>
            </div>

            {/* Back from creating an account, with the message still here. */}
            {user && restored && (
                <div className="inq-line is-in">
                    <span className="inq-avatar is-brand" aria-hidden="true"><IconCheck size={16} weight={2.4} /></span>
                    <div className="inq-bubble is-in">
                        <span className="inq-sender">MedSociety</span>
                        <p>{t('inquiry.welcomeBack', { email: user.email })}</p>
                    </div>
                </div>
            )}

            {/* Honeypot: off-screen, unfocusable, ignored by people. */}
            <div className="inq-hp" aria-hidden="true">
                <label>
                    Website
                    <input type="text" name="website" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
                </label>
            </div>

            <div className="inq-starters" role="group" aria-label={t('inquiry.startersLabel')}>
                {STARTERS.map((s) => {
                    const text = t(s.text);
                    const used = message.includes(text);
                    return (
                        <button
                            key={s.id}
                            type="button"
                            className={`inq-starter${used ? ' is-used' : ''}`}
                            disabled={sending}
                            aria-pressed={used}
                            onClick={() => addStarter(text)}
                        >
                            {t(s.label)}
                        </button>
                    );
                })}
            </div>

            {/* One compose card: the message, then — once signed in — who to reply to. */}
            <div className="inq-compose">
                <label className="inq-sr" htmlFor={`${uid}-message`}>{t('inquiry.messageLabel')}</label>
                <textarea
                    ref={textRef}
                    id={`${uid}-message`}
                    className="inq-textarea"
                    rows={3}
                    placeholder={t('inquiry.messagePlaceholder')}
                    value={message}
                    disabled={sending}
                    aria-invalid={Boolean(show('message'))}
                    aria-describedby={`${uid}-message-msg`}
                    onChange={(e) => setMessage(e.target.value)}
                    onBlur={() => setTouched((s) => ({ ...s, message: true }))}
                    onKeyDown={(e) => {
                        // Enter writes a new line (it is a medical question, not a one-liner);
                        // Ctrl/⌘ + Enter sends, as in most messaging apps on a keyboard.
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
                    }}
                />
                <div className="inq-compose-meta">
                    <p id={`${uid}-message-msg`} className="inq-msg is-error" aria-live="polite">{show('message')}</p>
                    {(message.length >= COUNT_FROM || message.length > MAX_MESSAGE) && (
                        <span className={`inq-count${message.length > MAX_MESSAGE ? ' is-over' : ''}`}>
                            {t('inquiry.counter', { count: message.length, max: MAX_MESSAGE })}
                        </span>
                    )}
                </div>

                {user && (
                    <>
                        <div className={`inq-field${show('name') ? ' is-invalid' : ''}`}>
                            <div className="inq-field-row">
                                <UserIcon />
                                <label className="inq-sr" htmlFor={`${uid}-name`}>{t('inquiry.nameLabel')}</label>
                                <input
                                    id={`${uid}-name`}
                                    className="inq-input"
                                    type="text"
                                    autoComplete="name"
                                    maxLength={120}
                                    placeholder={t('inquiry.namePlaceholder')}
                                    value={name}
                                    disabled={sending}
                                    aria-invalid={Boolean(show('name'))}
                                    aria-describedby={`${uid}-name-msg`}
                                    onChange={(e) => setNameInput(e.target.value)}
                                    onBlur={() => setTouched((s) => ({ ...s, name: true }))}
                                />
                            </div>
                            <p id={`${uid}-name-msg`} className="inq-msg is-error" aria-live="polite">{show('name')}</p>
                        </div>

                        <div className={`inq-field${show('contact') ? ' is-invalid' : ''}`}>
                            <div className="inq-field-row">
                                {kind === 'email' ? <MailIcon /> : <IconPhone size={18} weight={1.9} />}
                                <label className="inq-sr" htmlFor={`${uid}-contact`}>{t('inquiry.contactLabel')}</label>
                                <input
                                    id={`${uid}-contact`}
                                    className="inq-input"
                                    type="text"
                                    inputMode={kind === 'phone' ? 'tel' : 'text'}
                                    autoComplete="email tel"
                                    autoCapitalize="none"
                                    maxLength={200}
                                    placeholder={t('inquiry.contactPlaceholder')}
                                    value={contact}
                                    disabled={sending}
                                    aria-invalid={Boolean(show('contact'))}
                                    aria-describedby={`${uid}-contact-msg`}
                                    onChange={(e) => setContactInput(e.target.value)}
                                    onBlur={() => setTouched((s) => ({ ...s, contact: true }))}
                                />
                            </div>
                            <p id={`${uid}-contact-msg`} className={`inq-msg${show('contact') ? ' is-error' : ''}`} aria-live="polite">
                                {show('contact') || hint}
                            </p>
                        </div>
                    </>
                )}
            </div>

            {status === 'error' && (
                <div className="inq-error" role="alert">
                    <div>
                        <strong>{t('inquiry.errorTitle')}</strong>
                        <span>{errorText}</span>
                    </div>
                    {errorKind === 'auth' ? (
                        <button type="button" className="inq-link" onClick={() => goAuth('in')}>{t('inquiry.gateSignIn')}</button>
                    ) : (
                        <button type="submit" className="inq-link">{t('inquiry.retry')}</button>
                    )}
                </div>
            )}

            {user || checkingSession ? (
                // While the session is still being restored this is the same button,
                // inert, so a signed-in patient never sees the sign-up prompt flash by.
                <button type="submit" className="inq-submit" disabled={sending || checkingSession}>
                    {sending ? <span className="inq-spinner" aria-hidden="true" /> : <SendIcon />}
                    {sending ? t('inquiry.sending') : t('inquiry.submit')}
                </button>
            ) : (
                <div className="inq-gate">
                    <button type="button" className="inq-submit" onClick={() => goAuth('up')}>
                        <UserPlusIcon />
                        {t('inquiry.gateCta')}
                    </button>
                    <p className="inq-gate-alt">
                        {t('inquiry.gateHave')}{' '}
                        <button type="button" className="inq-link inq-link-inline" onClick={() => goAuth('in')}>
                            {t('inquiry.gateSignIn')}
                        </button>
                    </p>
                    <p className="inq-privacy">{t('inquiry.gateNote')}</p>
                </div>
            )}

            <p className="inq-privacy">{t('inquiry.privacy')}</p>
        </form>
    );
}
