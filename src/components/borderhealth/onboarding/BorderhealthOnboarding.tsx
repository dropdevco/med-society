import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabase';
import { signIn, signOut, signUp } from '../../../lib/auth';
import { useSession } from '../../../hooks/useSession';
import type { Specialty } from '../../../types/provider';
import type { BhLang, BhMatch, BhSubmission } from '../types';
import { Field } from '../../account/AuthShell';
import { authButton } from '../../account/authStyles';
import { IconArrowRight, IconCheck, IconClinic, IconMapPin, IconSearch, IconVerified } from '../../icons/Icons';
import { portraitUrl } from '../../../utils/images';
import { stringsFor } from './strings';
import type { ErrorCode } from './strings';
import {
    SPECIALTY_KEYS, authErrorCode, claimEvidence, clearPending, countryFor, isFinal,
    listingCityFor, mapSpecialties, matchProviders, readPending, resumeUrl, runAction, runOnce, sameEmail, savePending,
} from './logic';
import type { ListingDraft, OnboardingAction, Outcome, PendingOnboarding } from './logic';
import './onboarding.css';

type S = ReturnType<typeof stringsFor>;

/**
 * What a provider sees after the border-health survey saves their answers:
 * find their listing and claim it, or publish a new one — with the account
 * step inline, so nobody is bounced to /login halfway through.
 *
 *   checking → matches → account → (confirm email) → claim result
 *            ↘ publish ↗                              ↘ listing sent
 *   "Not now" from anywhere → thanks (answers were already saved)
 */

interface ListingForm {
    name: string;
    specialty: Specialty;
    address: string;
    city: string;
    phone: string;
    email: string;
    website: string;
    description: string;
}

type Step =
    | { k: 'checking' }
    | { k: 'matches' }
    | { k: 'publish' }
    | { k: 'continueAs'; action: OnboardingAction; email: string }
    | { k: 'account'; action: OnboardingAction }
    | { k: 'confirm'; action: OnboardingAction; email: string; pendingId: string }
    | { k: 'working'; action: OnboardingAction }
    | { k: 'result'; outcome: Outcome }
    | { k: 'thanks' };

const MIN_CHECKING_MS = 1500;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function initialForm(sub: BhSubmission): ListingForm {
    return {
        name: sub.contact.org || sub.contact.name || '',
        specialty: mapSpecialties(sub.practiceType, sub.specialty)[0],
        address: '',
        city: listingCityFor(sub.cityKey, sub.city || ''),
        phone: sub.contact.phone || sub.contact.whatsapp || '',
        email: sub.contact.email || '',
        website: sub.website || '',
        description: '',
    };
}

function draftFrom(form: ListingForm, sub: BhSubmission): ListingDraft {
    const mapped = mapSpecialties(sub.practiceType, sub.specialty);
    // Keep the extra guesses only while the person agreed with the first one.
    const specialty = form.specialty === mapped[0] ? mapped : [form.specialty];
    return {
        name: form.name,
        specialty,
        address: form.address,
        city: form.city,
        country: countryFor(sub.cityKey, form.city),
        phone: form.phone,
        email: form.email,
        website: form.website,
        description: form.description,
    };
}

export function BorderhealthOnboarding({ submission, onRestart, lang: langOverride }: {
    submission: BhSubmission;
    onRestart?: () => void;
    /** The page's current language; follows a switch made after submitting. */
    lang?: BhLang;
}) {
    const lang = langOverride ?? submission.lang;
    const s = stringsFor(lang);
    const { user } = useSession();
    // Test sessions run the whole flow, lookups included, but never write.
    const isTest = submission.session !== 'live';

    const [step, setStep] = useState<Step>({ k: 'checking' });
    const [matches, setMatches] = useState<BhMatch[]>([]);
    const [form, setForm] = useState<ListingForm>(() => initialForm(submission));
    const [error, setError] = useState<ErrorCode | null>(null);
    // Synchronous guard on top of the `working` step: a double-click or a
    // double Enter can land before React has re-rendered the button away.
    const busy = useRef(false);

    // Look the practice up once. The minimum duration is deliberate: an
    // instant flash of "checking" reads as a glitch, not as a search.
    useEffect(() => {
        let live = true;
        Promise.all([matchProviders(submission), delay(MIN_CHECKING_MS)]).then(([found]) => {
            if (!live) return;
            setMatches(found);
            setStep(found.length ? { k: 'matches' } : { k: 'publish' });
        });
        return () => { live = false; };
    }, [submission]);

    const apply = (action: OnboardingAction, outcome: Outcome) => {
        if (outcome.kind !== 'error') {
            setError(null);
            setStep({ k: 'result', outcome });
            return;
        }
        setError(outcome.code);
        if (outcome.code === 'not_signed_in') setStep({ k: 'account', action });
        else if (outcome.code === 'listing_not_found') setStep({ k: 'publish' });
        else setStep(action.kind === 'claim' ? { k: 'matches' } : { k: 'publish' });
    };

    const execute = async (action: OnboardingAction, onceKey?: string) => {
        if (busy.current) return;
        busy.current = true;
        setError(null);
        setStep({ k: 'working', action });
        try {
            if (isTest) {
                apply(action, { kind: 'test' });
                return;
            }
            const run = () => runAction(action, submission.submissionKey);
            const outcome = await (onceKey ? runOnce(onceKey, run) : run());
            if (onceKey && isFinal(outcome)) clearPending();
            apply(action, outcome);
        } finally {
            busy.current = false;
        }
    };

    /**
     * Signed in already → confirm the account first (the survey may run on a
     * phone shared by several people); otherwise the account step. The step
     * flips to `working` before anything is awaited, so the button is gone.
     */
    const proceed = async (action: OnboardingAction) => {
        if (busy.current) return;
        busy.current = true;
        setError(null);
        setStep({ k: 'working', action });
        try {
            if (!supabase) { apply(action, { kind: 'error', code: 'not_configured' }); return; }
            const { data } = await supabase.auth.getSession();
            if (data.session) setStep({ k: 'continueAs', action, email: data.session.user.email ?? '' });
            else setStep({ k: 'account', action });
        } finally {
            busy.current = false;
        }
    };

    const switchAccount = async (action: OnboardingAction) => {
        if (busy.current) return;
        busy.current = true;
        setStep({ k: 'working', action });
        try {
            await signOut();
        } finally {
            busy.current = false;
        }
        setStep({ k: 'account', action });
    };

    // The confirmation link opened in another tab signs this one in too
    // (supabase-js syncs sessions across tabs). Finish without a click — but
    // only as the account the confirmation was sent to.
    const confirmPendingId = step.k === 'confirm' ? step.pendingId : null;
    const confirmAction = step.k === 'confirm' ? step.action : null;
    const confirmEmail = step.k === 'confirm' ? step.email : null;
    const confirmMatches = !!user && sameEmail(user.email, confirmEmail);
    useEffect(() => {
        if (!confirmPendingId || !confirmAction || !confirmMatches) return;
        let live = true;
        runOnce(confirmPendingId, () => runAction(confirmAction, submission.submissionKey)).then((outcome) => {
            if (!live) return;
            if (isFinal(outcome)) clearPending();
            apply(confirmAction, outcome);
        });
        return () => { live = false; };
    }, [confirmPendingId, confirmAction, confirmMatches, submission.submissionKey]);

    const notNow = () => { setError(null); setStep({ k: 'thanks' }); };
    // The next respondent on this device must not inherit this one's request.
    const restart = onRestart ? () => { clearPending(); onRestart(); } : undefined;

    let body: ReactNode;
    switch (step.k) {
        case 'checking':
            body = <Checking s={s} />;
            break;

        case 'matches':
            body = (
                <MatchList
                    s={s}
                    matches={matches}
                    error={error}
                    onClaim={(m) => proceed({
                        kind: 'claim', providerId: m.id, providerName: m.name,
                        evidence: claimEvidence(submission),
                    })}
                    onNone={() => { setError(null); setStep({ k: 'publish' }); }}
                    onNotNow={notNow}
                />
            );
            break;

        case 'publish':
            body = (
                <PublishForm
                    s={s}
                    form={form}
                    setForm={setForm}
                    error={error}
                    onBack={matches.length ? () => { setError(null); setStep({ k: 'matches' }); } : undefined}
                    onSubmit={() => {
                        if (form.name.trim().length < 3 || form.name.trim().length > 160) { setError('bad_name'); return; }
                        if (!form.address.trim()) { setError('missing_address'); return; }
                        proceed({ kind: 'listing', draft: draftFrom(form, submission) });
                    }}
                    onNotNow={notNow}
                />
            );
            break;

        case 'continueAs': {
            const { action, email } = step;
            body = (
                <ContinueAs
                    s={s}
                    action={action}
                    email={email}
                    onContinue={() => execute(action)}
                    onSwitch={() => switchAccount(action)}
                    onBack={() => { setError(null); setStep(action.kind === 'claim' ? { k: 'matches' } : { k: 'publish' }); }}
                    onNotNow={notNow}
                />
            );
            break;
        }

        case 'account': {
            const action = step.action;
            body = (
                <AccountStep
                    s={s}
                    action={action}
                    defaultEmail={submission.contact.email}
                    initialError={error}
                    onAuthed={() => execute(action)}
                    onNeedsConfirm={(email) => {
                        setError(null);
                        // A test run never leaves a request behind to finish for real.
                        if (isTest) { setStep({ k: 'result', outcome: { kind: 'test' } }); return; }
                        const p = savePending({
                            lang,
                            submissionKey: submission.submissionKey,
                            email,
                            action,
                        });
                        setStep({ k: 'confirm', action, email, pendingId: p.id });
                    }}
                    onBack={() => { setError(null); setStep(action.kind === 'claim' ? { k: 'matches' } : { k: 'publish' }); }}
                    onNotNow={notNow}
                />
            );
            break;
        }

        case 'confirm': {
            const { action, email, pendingId } = step;
            if (user && confirmMatches) body = <Working s={s} label={s.confirmSignedIn} />;
            else if (user) body = <WrongAccount s={s} current={user.email ?? ''} expected={email} />;
            else body = (
                <ConfirmEmail
                    s={s}
                    email={email}
                    onAuthed={() => execute(action, pendingId)}
                    onNotNow={notNow}
                />
            );
            break;
        }

        case 'working':
            body = <Working s={s} label={s.working} />;
            break;

        case 'result':
            body = <ResultView s={s} outcome={step.outcome} onRestart={restart} />;
            break;

        case 'thanks':
            body = <Thanks s={s} onRestart={restart} />;
            break;
    }

    return (
        <div className="bho ms-auth-card" lang={lang}>
            {isTest && <span className="bho-test">{s.testBadge}</span>}
            <div className="bho-step" key={step.k}>{body}</div>
        </div>
    );
}

/**
 * What /borderhealth?resume=1 renders: the landing spot for the email
 * confirmation link. Reads `ms_bh_pending`, asks for a sign-in if the
 * confirmation did not leave a session behind, then runs the stored claim or
 * listing exactly once and clears the key — and only for the account the
 * request was started with. Anyone else signed in on this device is asked to
 * switch, never allowed to finish someone else's claim.
 *
 * Language: the stored request's language first, then whatever `lang` the
 * page passes whenever it changes after mount.
 */
export function BorderhealthResume({ lang: langProp }: { lang?: BhLang }) {
    const [pending] = useState<PendingOnboarding | null>(() => readPending());
    const [lang, setLang] = useState<BhLang>(() => pending?.lang ?? langProp ?? 'es');
    const [seenLangProp, setSeenLangProp] = useState(langProp);
    if (langProp !== seenLangProp) {
        setSeenLangProp(langProp);
        if (langProp) setLang(langProp);
    }
    const s = stringsFor(lang);
    const { user, loading } = useSession();
    const [outcome, setOutcome] = useState<Outcome | null>(null);
    const [attempt, setAttempt] = useState(0);

    const userId = user?.id ?? null;
    const isRightAccount = !!pending && !!user && sameEmail(user.email, pending.email);
    useEffect(() => {
        if (!pending || loading || !userId || !isRightAccount || outcome) return;
        let live = true;
        runOnce(`${pending.id}#${attempt}`, () => runAction(pending.action, pending.submissionKey)).then((out) => {
            if (isFinal(out)) clearPending();
            if (live) setOutcome(out);
        });
        return () => { live = false; };
    }, [pending, loading, userId, isRightAccount, outcome, attempt]);

    let body: ReactNode;
    if (!pending) {
        body = (
            <Panel title={s.resumeNothingTitle} subtitle={s.resumeNothingBody}>
                <DashboardLink s={s} />
            </Panel>
        );
    } else if (loading) {
        body = <Working s={s} label={s.resumeWorking} />;
    } else if (!userId) {
        body = (
            <Panel title={s.resumeSignInTitle} subtitle={s.resumeSignInBody}>
                <AuthForm s={s} defaultEmail={pending.email} startMode="signin" signInOnly onAuthed={() => {}} />
            </Panel>
        );
    } else if (!isRightAccount) {
        body = <WrongAccount s={s} current={user?.email ?? ''} expected={pending.email} />;
    } else if (!outcome) {
        body = <Working s={s} label={s.resumeWorking} />;
    } else if (outcome.kind === 'error' && !isFinal(outcome)) {
        body = (
            <Panel title={s.resumeFailedTitle}>
                <ErrorLine s={s} code={outcome.code} />
                <button
                    type="button" className="press" style={authButton}
                    onClick={() => { setOutcome(null); setAttempt((n) => n + 1); }}
                >
                    {s.retry}
                </button>
            </Panel>
        );
    } else {
        body = <ResultView s={s} outcome={outcome} />;
    }

    return (
        <div className="bho ms-auth-card" lang={lang}>
            <div className="bho-step">{body}</div>
        </div>
    );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function Panel({ title, subtitle, icon, children }: {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <>
            {icon && <div className="bho-icon">{icon}</div>}
            <h2 className="display bho-title">{title}</h2>
            {subtitle && <p className="bho-sub">{subtitle}</p>}
            {children}
        </>
    );
}

function ErrorLine({ s, code }: { s: S; code: ErrorCode | null }) {
    if (!code) return null;
    return <p role="alert" className="bho-error">{s.errors[code]}</p>;
}

function NotNow({ s, onClick }: { s: S; onClick: () => void }) {
    return (
        <button type="button" className="bho-link bho-notnow" onClick={onClick}>
            {s.notNow}
        </button>
    );
}

function DashboardLink({ s }: { s: S }) {
    return (
        <Link to="/dashboard" className="press" style={{ ...authButton, textDecoration: 'none' }}>
            {s.goToDashboard}
            <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
        </Link>
    );
}

function Checking({ s }: { s: S }) {
    const [i, setI] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setI((n) => (n + 1) % s.checking.length), 1100);
        return () => clearInterval(t);
    }, [s]);
    return (
        <div className="bho-checking" role="status" aria-label={s.checkingAria}>
            <div className="bho-radar" aria-hidden="true">
                <div className="bho-dir">
                    {Array.from({ length: 6 }, (_, n) => (
                        <div key={n} className={`bho-dir-card${n === 4 ? ' is-hit' : ''}`} style={{ animationDelay: `${n * 0.18}s` }}>
                            <span /><span />
                        </div>
                    ))}
                </div>
                <div className="bho-ring" />
                <div className="bho-ring bho-ring-2" />
                <div className="bho-sweep" />
                <div className="bho-lens"><IconSearch size={26} weight={1.8} /></div>
            </div>
            <p className="bho-checking-copy" key={i} aria-live="polite">{s.checking[i]}</p>
        </div>
    );
}

function Working({ s, label }: { s: S; label: string }) {
    return (
        <div className="bho-checking" role="status">
            <div className="bho-spinner" aria-hidden="true" />
            <p className="bho-checking-copy">{label || s.working}</p>
        </div>
    );
}

function MatchList({ s, matches, error, onClaim, onNone, onNotNow }: {
    s: S;
    matches: BhMatch[];
    error: ErrorCode | null;
    onClaim: (m: BhMatch) => void;
    onNone: () => void;
    onNotNow: () => void;
}) {
    return (
        <Panel title={s.matchTitle} subtitle={s.matchSubtitle(matches.length)}>
            <ErrorLine s={s} code={error} />
            <ul className="bho-matches">
                {matches.map((m) => <MatchCard key={m.id} s={s} m={m} onClaim={() => onClaim(m)} />)}
            </ul>
            <button type="button" className="press bho-secondary" onClick={onNone}>
                {s.noneOfThese}
            </button>
            <NotNow s={s} onClick={onNotNow} />
        </Panel>
    );
}

function MatchCard({ s, m, onClaim }: { s: S; m: BhMatch; onClaim: () => void }) {
    const [imgOk, setImgOk] = useState(true);
    // Drops Doctoralia's shared "no photo" logo, like every other card does.
    const photo = portraitUrl(m.imageUrl ?? undefined);
    const why = m.reasons.filter((r) => r !== 'city' && s.reasons[r]).map((r) => s.reasons[r]);
    return (
        <li className="bho-match">
            <div className="bho-match-head">
                {photo && imgOk ? (
                    <img className="bho-thumb" src={photo} alt="" loading="lazy" onError={() => setImgOk(false)} />
                ) : (
                    <div className="bho-thumb bho-thumb-empty" aria-hidden="true"><IconClinic size={24} /></div>
                )}
                <div style={{ minWidth: 0 }}>
                    <p className="bho-match-name">{m.name}</p>
                    <p className="bho-match-addr">
                        <IconMapPin size={14} weight={2} />
                        <span>{[m.address, m.city].filter((x, idx, arr) => x && arr.indexOf(x) === idx).join(' · ')}</span>
                    </p>
                </div>
            </div>
            {m.specialty.length > 0 && (
                <div className="bho-chips">
                    {m.specialty.slice(0, 4).map((k) => (
                        <span key={k} className="bho-chip">{s.specialties[k as Specialty] ?? k}</span>
                    ))}
                </div>
            )}
            {why.length > 0 && <p className="bho-why">{s.matchedBy}: {why.join(' · ')}</p>}
            {m.owned && <p className="bho-owned">{s.alreadyManaged}</p>}
            <button type="button" className="press" style={{ ...authButton, width: '100%' }} onClick={onClaim}>
                {s.claimThis}
                <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
            </button>
        </li>
    );
}

function PublishForm({ s, form, setForm, error, onBack, onSubmit, onNotNow }: {
    s: S;
    form: ListingForm;
    setForm: (f: ListingForm) => void;
    error: ErrorCode | null;
    onBack?: () => void;
    onSubmit: () => void;
    onNotNow: () => void;
}) {
    const set = <K extends keyof ListingForm>(k: K) => (v: ListingForm[K]) => setForm({ ...form, [k]: v });
    const submit = (e: FormEvent) => { e.preventDefault(); onSubmit(); };
    const opt = (label: string) => `${label} (${s.optional})`;
    return (
        <Panel title={s.publishTitle} subtitle={s.publishSubtitle}>
            <ul className="bho-perks">
                {s.publishPerks.map((p) => (
                    <li key={p}><IconCheck size={16} weight={2} /><span>{p}</span></li>
                ))}
            </ul>
            <form onSubmit={submit} className="bho-form">
                <Field label={s.fPracticeName}>
                    <input required minLength={3} maxLength={160} value={form.name} onChange={(e) => set('name')(e.target.value)} autoComplete="organization" />
                </Field>
                <Field label={s.fSpecialty}>
                    <select value={form.specialty} onChange={(e) => set('specialty')(e.target.value as Specialty)}>
                        {SPECIALTY_KEYS.map((k) => <option key={k} value={k}>{s.specialties[k]}</option>)}
                    </select>
                </Field>
                <Field label={s.fAddress} hint={s.fAddressHint}>
                    <input required maxLength={300} value={form.address} onChange={(e) => set('address')(e.target.value)} autoComplete="street-address" />
                </Field>
                <Field label={s.fCity}>
                    <input required maxLength={80} value={form.city} onChange={(e) => set('city')(e.target.value)} autoComplete="address-level2" />
                </Field>
                <div className="bho-row">
                    <Field label={s.fPhone}>
                        <input type="tel" maxLength={40} value={form.phone} onChange={(e) => set('phone')(e.target.value)} autoComplete="tel" />
                    </Field>
                    <Field label={s.fEmail}>
                        <input type="email" maxLength={160} value={form.email} onChange={(e) => set('email')(e.target.value)} autoComplete="email" />
                    </Field>
                </div>
                <Field label={opt(s.fWebsite)}>
                    <input maxLength={300} value={form.website} onChange={(e) => set('website')(e.target.value)} autoComplete="url" />
                </Field>
                <Field label={opt(s.fDescription)} hint={s.fDescriptionHint}>
                    <textarea maxLength={2000} value={form.description} onChange={(e) => set('description')(e.target.value)} />
                </Field>

                <ErrorLine s={s} code={error} />

                <button type="submit" className="press" style={authButton}>
                    {s.publishContinue}
                    <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
                </button>
            </form>
            <div className="bho-footer">
                {onBack && <button type="button" className="bho-link" onClick={onBack}>{s.back}</button>}
                <NotNow s={s} onClick={onNotNow} />
            </div>
        </Panel>
    );
}

function AccountStep({ s, action, defaultEmail, initialError, onAuthed, onNeedsConfirm, onBack, onNotNow }: {
    s: S;
    action: OnboardingAction;
    defaultEmail: string;
    initialError: ErrorCode | null;
    onAuthed: () => void;
    onNeedsConfirm: (email: string) => void;
    onBack: () => void;
    onNotNow: () => void;
}) {
    const subject = action.kind === 'claim' ? action.providerName : action.draft.name;
    return (
        <Panel title={action.kind === 'claim' ? s.accountTitleClaim : s.accountTitleListing}>
            <div className="bho-subject">
                <span className="bho-subject-label">{action.kind === 'claim' ? s.claimingLabel : s.publishingLabel}</span>
                <span className="bho-subject-name">{subject}</span>
            </div>
            <AuthForm
                s={s}
                defaultEmail={defaultEmail}
                startMode="signup"
                initialError={initialError}
                onAuthed={onAuthed}
                onNeedsConfirm={onNeedsConfirm}
            />
            <div className="bho-footer">
                <button type="button" className="bho-link" onClick={onBack}>{s.back}</button>
                <NotNow s={s} onClick={onNotNow} />
            </div>
        </Panel>
    );
}

/**
 * Email + password, sign up or sign in. Email confirmation is detected, not
 * configured: after signUp, a session either exists (confirmation off →
 * onAuthed) or it does not (confirmation on → onNeedsConfirm).
 */
function AuthForm({ s, defaultEmail, startMode, signInOnly = false, initialError = null, onAuthed, onNeedsConfirm }: {
    s: S;
    defaultEmail: string;
    startMode: 'signup' | 'signin';
    /** Resume/confirm screens: the account already exists, so no sign-up. */
    signInOnly?: boolean;
    initialError?: ErrorCode | null;
    onAuthed: () => void;
    onNeedsConfirm?: (email: string) => void;
}) {
    const [mode, setMode] = useState<'signup' | 'signin'>(signInOnly ? 'signin' : startMode);
    const [email, setEmail] = useState(defaultEmail);
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<ErrorCode | null>(initialError);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const addr = email.trim();
        if (mode === 'signin' || signInOnly) {
            const r = await signIn(addr, password);
            setBusy(false);
            if (r.error) { setError(authErrorCode(r.error)); return; }
            onAuthed();
            return;
        }
        const r = await signUp(addr, password, resumeUrl());
        if (r.error) {
            setBusy(false);
            const code = authErrorCode(r.error);
            setError(code);
            if (code === 'user_exists') setMode('signin');
            return;
        }
        const { data } = supabase ? await supabase.auth.getSession() : { data: { session: null } };
        setBusy(false);
        if (data.session) onAuthed();
        else onNeedsConfirm?.(addr);
    };

    return (
        <form onSubmit={submit} className="bho-form">
            <p className="bho-sub" style={{ marginBottom: 0 }}>
                {mode === 'signup' ? s.accountSubtitleSignUp : s.accountSubtitleSignIn}
            </p>
            <Field label={s.email}>
                <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field label={s.password} hint={mode === 'signup' ? s.passwordHint : undefined}>
                <input
                    type="password" required minLength={6} value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                />
            </Field>
            <ErrorLine s={s} code={error} />
            <button type="submit" disabled={busy} className="press" style={authButton}>
                {busy ? s.working : mode === 'signup' ? s.createAccount : s.signIn}
                {!busy && <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>}
            </button>
            {!signInOnly && (
                <p className="bho-toggle">
                    {mode === 'signup' ? s.haveAccount : s.needAccount}{' '}
                    <button
                        type="button" className="bho-link"
                        onClick={() => { setError(null); setMode(mode === 'signup' ? 'signin' : 'signup'); }}
                    >
                        {mode === 'signup' ? s.switchToSignIn : s.switchToSignUp}
                    </button>
                </p>
            )}
        </form>
    );
}

function ConfirmEmail({ s, email, onAuthed, onNotNow }: {
    s: S;
    email: string;
    onAuthed: () => void;
    onNotNow: () => void;
}) {
    return (
        <Panel
            title={s.confirmTitle}
            subtitle={s.confirmBody(email)}
            icon={<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.2" y="5.4" width="17.6" height="13.2" rx="2.2" /><path d="M3.8 6.6l8.2 6.2 8.2-6.2" /></svg>}
        >
            <p className="bho-hint">{s.confirmHint}</p>
            <AuthForm s={s} defaultEmail={email} startMode="signin" signInOnly onAuthed={onAuthed} />
            <div className="bho-footer"><NotNow s={s} onClick={onNotNow} /></div>
        </Panel>
    );
}

function ResultView({ s, outcome, onRestart }: { s: S; outcome: Outcome; onRestart?: () => void }) {
    return (
        <>
            <ResultBody s={s} outcome={outcome} />
            {onRestart && (
                <button type="button" className="bho-link bho-notnow" onClick={onRestart}>{s.restart}</button>
            )}
        </>
    );
}

function ResultBody({ s, outcome }: { s: S; outcome: Outcome }) {
    if (outcome.kind === 'test') {
        return (
            <Panel title={s.testTitle} subtitle={s.testBody} icon={<div className="bho-badge"><IconCheck size={30} weight={2} /></div>} />
        );
    }
    if (outcome.kind === 'error') {
        return (
            <Panel title={s.thanksTitle}>
                <ErrorLine s={s} code={outcome.code} />
                <DashboardLink s={s} />
            </Panel>
        );
    }
    if (outcome.kind === 'listing') {
        return (
            <Panel title={s.listingTitle} subtitle={s.listingBody} icon={<Burst />}>
                <DashboardLink s={s} />
            </Panel>
        );
    }
    const n = outcome.providerName;
    if (outcome.status === 'approved') {
        return (
            <Panel title={s.approvedTitle} subtitle={s.approvedBody(n)} icon={<Burst verified />}>
                <DashboardLink s={s} />
            </Panel>
        );
    }
    if (outcome.status === 'owner') {
        return (
            <Panel title={s.ownerTitle} subtitle={s.ownerBody(n)} icon={<div className="bho-badge"><IconVerified size={30} /></div>}>
                <DashboardLink s={s} />
            </Panel>
        );
    }
    return (
        <Panel title={s.pendingTitle} subtitle={s.pendingBody(n)} icon={<div className="bho-badge"><IconCheck size={30} weight={2} /></div>}>
            <DashboardLink s={s} />
        </Panel>
    );
}

function ContinueAs({ s, action, email, onContinue, onSwitch, onBack, onNotNow }: {
    s: S;
    action: OnboardingAction;
    email: string;
    onContinue: () => void;
    onSwitch: () => void;
    onBack: () => void;
    onNotNow: () => void;
}) {
    const subject = action.kind === 'claim' ? action.providerName : action.draft.name;
    return (
        <Panel title={s.continueAsTitle} subtitle={s.continueAsBody(email)}>
            <div className="bho-subject">
                <span className="bho-subject-label">{action.kind === 'claim' ? s.claimingLabel : s.publishingLabel}</span>
                <span className="bho-subject-name">{subject}</span>
            </div>
            <button type="button" className="press" style={authButton} onClick={onContinue}>
                {s.continueAs}
                <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
            </button>
            <button type="button" className="press bho-secondary" onClick={onSwitch}>
                {s.notYou}
            </button>
            <div className="bho-footer">
                <button type="button" className="bho-link" onClick={onBack}>{s.back}</button>
                <NotNow s={s} onClick={onNotNow} />
            </div>
        </Panel>
    );
}

/** Someone else is signed in on this device: never finish their request as them. */
function WrongAccount({ s, current, expected }: { s: S; current: string; expected: string }) {
    const [busy, setBusy] = useState(false);
    return (
        <Panel title={s.mismatchTitle} subtitle={s.mismatchBody(current, expected)}>
            <button
                type="button" className="press" style={authButton} disabled={busy}
                onClick={async () => { setBusy(true); await signOut(); setBusy(false); }}
            >
                {busy ? s.working : s.signOut}
            </button>
        </Panel>
    );
}

function Burst({ verified = false }: { verified?: boolean }) {
    return (
        <div className="bho-burst" aria-hidden="true">
            {Array.from({ length: 10 }, (_, n) => (
                <span key={n} className="bho-confetti" style={{ rotate: `${n * 36}deg`, animationDelay: `${(n % 3) * 0.06}s` }} />
            ))}
            <div className="bho-badge bho-badge-pop">
                {verified ? <IconVerified size={32} /> : <IconCheck size={32} weight={2} />}
            </div>
        </div>
    );
}

function Thanks({ s, onRestart }: { s: S; onRestart?: () => void }) {
    return (
        <Panel title={s.thanksTitle} subtitle={s.thanksBody} icon={<div className="bho-badge"><IconCheck size={30} weight={2} /></div>}>
            <Link to="/" className="press" style={{ ...authButton, textDecoration: 'none' }}>
                {s.thanksDirectory}
            </Link>
            {onRestart && (
                <button type="button" className="bho-link bho-notnow" onClick={onRestart}>{s.restart}</button>
            )}
        </Panel>
    );
}
