import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { authButton } from '../account/authStyles';
import { CONTACT, FOLLOW, FOLLOW_OPTS, FORMS } from './forms';
import type { ContactField, Opt, Question, Screen } from './forms';
import { T } from './strings';
import { RESEARCH } from './research';
import type { BhStrings } from './strings';
import { clearDraft, loadDraft, saveDraft } from './storage';
import type { Answers } from './storage';
import {
    buildAnswers, filled, humanLabel, str, topOpts, validateScreen, visible, wantsFollow,
} from './logic';
import type { ErrKind, Errors } from './logic';
import { getRef, getSession, insertResponse, newSubmissionKey, pushLead } from './submit';
import { track } from './track';
import type { BhLang, BhSegment, BhSubmission } from './types';

const SEGS: BhSegment[] = ['employer', 'employee', 'provider'];

function isSeg(s: string): s is BhSegment {
    return (SEGS as string[]).indexOf(s) >= 0;
}

export interface SurveyResult {
    segment: BhSegment;
    /** Said yes (either kind) to the follow-up. */
    followed: boolean;
    submission: BhSubmission;
}

interface State {
    seg: BhSegment | null;
    step: number;
    a: Answers;
    startedAt: number | null;
}

/**
 * Boot state: a live draft wins unless the link asks for a different (valid)
 * audience. An unknown `?seg=` is ignored, so it can never cost a draft.
 * `defaultSeg` is the audience a bare link opens on (the /research study page
 * opens on providers); without it a bare link shows the audience picker.
 */
function initialState(search: string, useUrlSeg: boolean, defaultSeg: BhSegment | null = null): { s: State; restored: boolean } {
    const rawSeg = useUrlSeg ? (new URLSearchParams(search).get('seg') || '').toLowerCase() : '';
    const segParam = isSeg(rawSeg) ? rawSeg : '';
    const draft = loadDraft();
    if (draft && (!segParam || segParam === draft.seg)) {
        const a = draft.a || {};
        const step = draft.step || 0;
        return {
            s: { seg: draft.seg, step, a, startedAt: draft.startedAt || Date.now() },
            restored: step > 0 || Object.keys(a).length > 0,
        };
    }
    if (isSeg(segParam)) return { s: { seg: segParam, step: 0, a: {}, startedAt: Date.now() }, restored: false };
    if (defaultSeg) return { s: { seg: defaultSeg, step: 0, a: {}, startedAt: Date.now() }, restored: false };
    return { s: { seg: null, step: 0, a: {}, startedAt: null }, restored: false };
}

/** Seconds from the first screen to now (called only from the send handler). */
function elapsedSeconds(startedAt: number | null): number | null {
    return startedAt ? (Date.now() - startedAt) / 1000 : null;
}

function msSince(t: number): number {
    return t ? Date.now() - t : 0;
}

function scrollTop() {
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch { window.scrollTo(0, 0); }
}

function errText(tt: BhStrings, e: ErrKind): string {
    if (e === 'pick') return tt.errPick;
    if (e === 'text') return tt.errText;
    if (e === 'contact') return tt.errContact;
    return tt.errMax(e.max);
}

/**
 * The survey itself: chooser, per-audience screens, validation, autosave and
 * submission. Language is owned by the page (it also drives the header
 * switch); everything else lives here.
 */
export function SurveyRunner({ lang, useUrlSeg, onSubmitted, research = false }: {
    lang: BhLang;
    research?: boolean;
    /** False after a completed submission, so "fill out another" lands on the chooser. */
    useUrlSeg: boolean;
    onSubmitted: (r: SurveyResult) => void;
}) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [boot] = useState(() => initialState(window.location.search, useUrlSeg, research ? 'provider' : null));
    const [S, setS] = useState<State>(boot.s);
    const [showRestored, setShowRestored] = useState(boot.restored);
    const [errors, setErrors] = useState<Errors>({});
    const [sending, setSending] = useState(false);
    const [sendErr, setSendErr] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    /**
     * One submission_key per attempt series: reused when a failed send is
     * retried (so a commit whose response was lost is not inserted twice),
     * dropped after success or as soon as any answer changes.
     */
    const submissionKeyRef = useRef<string | null>(null);
    const tt = research ? { ...T[lang], about: RESEARCH[lang].about } : T[lang];

    // Autosave on every change the person makes. The boot state itself is
    // never written (a `?seg=` link must not overwrite someone's draft before
    // they answer anything), and the chooser never touches storage: drafts
    // are cleared only by an explicit "Change"/Back-to-chooser or a successful send.
    useEffect(() => {
        if (S === boot.s || !S.seg) return;
        saveDraft({ seg: S.seg, step: S.step, a: S.a, startedAt: S.startedAt || Date.now() });
    }, [S, boot]);

    const startedRef = useRef(false);
    const doneRef = useRef(false);
    const stepEnteredRef = useRef(0);
    const liveRef = useRef({ seg: S.seg, step: S.step, lang });
    useEffect(() => {
        liveRef.current = { seg: S.seg, step: S.step, lang };
    }, [S.seg, S.step, lang]);

    useEffect(() => {
        if (!S.seg) return;
        stepEnteredRef.current = Date.now();
        track('step_view', {
            form_segment: S.seg, lang: liveRef.current.lang, step: S.step,
            step_id: `${S.seg}-${S.step + 1}`, props: { restored: boot.restored },
        });
    }, [S.seg, S.step, boot.restored]);

    useEffect(() => {
        const onHide = () => {
            const { seg: sg, step: st, lang: lg } = liveRef.current;
            if (!startedRef.current || doneRef.current || !sg) return;
            track('abandon', { form_segment: sg, lang: lg, step: st, step_id: `${sg}-${st + 1}` });
            startedRef.current = false;
        };
        window.addEventListener('pagehide', onHide);
        return () => window.removeEventListener('pagehide', onHide);
    }, []);

    const go = (next: Partial<State>) => {
        setS((prev) => ({ ...prev, ...next }));
        setErrors({});
        setSendErr(false);
        setShowRestored(false);
        scrollTop();
    };

    const toChooser = (dropSegParam: boolean) => {
        if (S.seg) track('segment_changed', { form_segment: S.seg, lang, step: S.step });
        clearDraft();
        submissionKeyRef.current = null;
        go({ seg: null, step: 0, a: {}, startedAt: null });
        if (dropSegParam && searchParams.has('seg')) {
            const p = new URLSearchParams(searchParams);
            p.delete('seg');
            setSearchParams(p, { replace: true });
        }
    };

    if (!S.seg) {
        return (
            <div className="bh-screen">
                <h1 className="display bh-h1">{tt.title}</h1>
                <p className="bh-lede">{tt.lede}</p>
                <p className="bh-about">{tt.about}</p>
                <div className="bh-who">{tt.who}</div>
                <div className="bh-segs">
                    {SEGS.map((k) => (
                        <button
                            key={k}
                            type="button"
                            className="bh-seg"
                            onClick={() => {
                                submissionKeyRef.current = null;
                                startedRef.current = false;
                                track('segment_selected', { form_segment: k, lang });
                                go({ seg: k, step: 0, a: {}, startedAt: Date.now() });
                            }}
                        >
                            <span className="bh-seg-t">
                                <b className="display">{tt.segs[k][0]}</b>
                                <small>{tt.segs[k][1]}</small>
                            </span>
                            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M5 12h14M13 6l6 6-6 6" />
                            </svg>
                        </button>
                    ))}
                </div>
                <p className="bh-time">{tt.time}</p>
            </div>
        );
    }

    const seg = S.seg;
    const a = S.a;
    const screens = FORMS[seg];
    const step = Math.min(S.step, screens.length - 1);
    const scr = screens[step];
    const n = screens.length;
    const last = step === n - 1;

    const setA = (patch: Answers, drop: string[] = []) => {
        submissionKeyRef.current = null; // answers changed: a new send is a new submission
        if (!startedRef.current) {
            startedRef.current = true;
            track('first_answer', { form_segment: seg, lang, step, step_id: `${seg}-${step + 1}` });
        }
        setS((prev) => {
            const na: Answers = { ...prev.a, ...patch };
            drop.forEach((k) => { delete na[k]; });
            return { ...prev, a: na };
        });
    };
    const clearErr = (id: string) => {
        if (errors[id] !== undefined) setErrors((e) => { const x = { ...e }; delete x[id]; return x; });
    };
    const markErr = (id: string, k: ErrKind) => setErrors((e) => ({ ...e, [id]: k }));

    const pickSingle = (qd: { id: string }, v: string) => {
        setA({ [qd.id]: v });
        clearErr(qd.id);
        if (v === 'other') {
            requestAnimationFrame(() => {
                const inp = rootRef.current?.querySelector<HTMLInputElement>(`input[data-other="${qd.id}"]`);
                inp?.focus();
            });
        }
    };

    const pickMulti = (qd: Question, v: string) => {
        let cur = Array.isArray(a[qd.id]) ? (a[qd.id] as string[]).slice() : [];
        const ex = qd.exclusive || [];
        const k = cur.indexOf(v);
        if (k >= 0) cur.splice(k, 1);
        else if (ex.indexOf(v) >= 0) cur = [v];
        else {
            cur = cur.filter((x) => ex.indexOf(x) < 0);
            if (qd.max && cur.length >= qd.max) { markErr(qd.id, { max: qd.max }); return; }
            cur = cur.concat([v]);
        }
        // a "which matters most" answer that is no longer picked goes away
        const topId = qd.id + '_top';
        const topV = a[topId];
        const drop = topV != null && typeof topV === 'string' && cur.indexOf(topV) < 0 ? [topId] : [];
        setA({ [qd.id]: cur }, drop);
        clearErr(qd.id);
    };

    const onNext = async () => {
        const { errors: errs, order } = validateScreen(seg, a, scr);
        setErrors(errs);
        if (order.length) {
            track('validation_error', {
                form_segment: seg, lang, step, step_id: `${seg}-${step + 1}`,
                props: { fields: order.slice(0, 10) },
            });
            requestAnimationFrame(() => {
                const box = rootRef.current?.querySelector<HTMLElement>(`[data-q="${order[0]}"]`);
                if (!box) return;
                box.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const f = box.querySelector<HTMLElement>('input,textarea,.bh-opt');
                try { f?.focus({ preventScroll: true }); } catch { /* old browsers */ }
            });
            return;
        }
        track('step_next', {
            form_segment: seg, lang, step, step_id: `${seg}-${step + 1}`,
            props: { ms_on_step: msSince(stepEnteredRef.current) },
        });
        if (!last) { go({ step: step + 1 }); return; }
        await send();
    };

    const send = async () => {
        setSending(true);
        setSendErr(false);
        const search = window.location.search;
        const session = getSession(search);
        const ref = getRef(search);
        const answers = buildAnswers(seg, a);
        const qs = new URLSearchParams(window.location.search);
        const utm: Record<string, string> = {};
        for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
            const v = qs.get(k);
            if (v) utm[k] = v.slice(0, 120);
        }
        answers.form_version = 'v2';
        answers.variant = research ? 'research' : 'medsociety';
        if (Object.keys(utm).length) answers.utm = utm;
        const industry = (answers.industry || answers.practice_type || null) as string | null;
        const city = (answers.where || answers.work_where || answers.city || null) as string | null;
        const followed = wantsFollow(a);
        if (!submissionKeyRef.current) submissionKeyRef.current = newSubmissionKey();
        const submissionKey = submissionKeyRef.current;
        const phoneOrWa = str(a, 'c_phone') || str(a, 'c_whatsapp');
        const tf = { form_segment: seg, lang, step, step_id: `${seg}-${step + 1}`, submission_key: submissionKey };
        track('submit_attempt', tf);

        try {
            await insertResponse({
                submissionKey, session, ref, segment: seg, lang, industry, city, answers,
                contact_name: str(a, 'c_name'),
                contact_org: str(a, 'c_org'),
                contact_email: str(a, 'c_email'),
                contact_phone: phoneOrWa,
                follow_up: followed ? true : (a.follow_up === 'no' ? false : null),
                duration_s: elapsedSeconds(S.startedAt),
            });
        } catch (e) {
            track('submit_error', { ...tf, props: { message: String((e as Error)?.message ?? e).slice(0, 200) } });
            setSending(false);
            setSendErr(true);
            return;
        }
        doneRef.current = true;
        track('submit_success', {
            ...tf,
            props: { duration_s: elapsedSeconds(S.startedAt), follow_up: followed, has_email: filled(a.c_email), has_phone: filled(a.c_phone), has_whatsapp: filled(a.c_whatsapp) },
        });

        if (filled(a.c_email) || filled(a.c_phone) || filled(a.c_whatsapp)) {
            pushLead({
                segment: seg, lang, session, ref,
                name: str(a, 'c_name'), org: str(a, 'c_org'), email: str(a, 'c_email'),
                phone: phoneOrWa, whatsapp: str(a, 'c_whatsapp'),
                follow_up_key: str(a, 'follow_up') || undefined,
                industry, city: [city, answers.state].filter(Boolean).join(', ') || null, follow_up: followed,
            });
        }

        const practiceType = str(a, 'practice_type');
        const specialtyQ = FORMS[seg].flatMap((x) => x.qs).find((x) => x.id === 'specialty');
        const submission: BhSubmission = {
            submissionKey,
            segment: seg,
            lang,
            session,
            contact: {
                name: str(a, 'c_name').trim(),
                org: str(a, 'c_org').trim(),
                email: str(a, 'c_email').trim(),
                phone: str(a, 'c_phone').trim(),
                whatsapp: str(a, 'c_whatsapp').trim(),
            },
            city: humanLabel(seg, a, 'city', lang),
            cityKey: str(a, 'city'),
            practiceType,
            // specialist: the specialty answer. other: the typed practice type, so
            // onboarding's keyword mapper still has something to work with.
            specialty: practiceType === 'other'
                ? str(a, 'practice_type_other').trim()
                : specialtyQ && visible(seg, a, specialtyQ) ? str(a, 'specialty').trim() : '',
            website: str(a, 'website').trim(),
            answers,
        };

        clearDraft();
        submissionKeyRef.current = null;
        startedRef.current = false;
        setSending(false);
        setS({ seg: null, step: 0, a: {}, startedAt: null });
        scrollTop();
        onSubmitted({ segment: seg, followed, submission });
    };

    const showToast = showRestored && step > 0;

    return (
        <div className="bh-screen" key={`${seg}-${step}`} ref={rootRef}>
            <div className="bh-prog">
                <div className="bh-bar"><i style={{ transform: `scaleX(${(step + 1) / n})` }} /></div>
                <div className="bh-prog-lbl">
                    <b>{tt.step(step + 1, n)}</b>
                    <button type="button" className="bh-sw" title={tt.switchTitle} onClick={() => toChooser(true)}>
                        {tt.segs[seg][0]} · <u>{tt.switchSeg}</u>
                    </button>
                </div>
            </div>

            {showToast && <div className="bh-toast">{tt.restored}</div>}

            <h2 className="display bh-h2">{scr[lang]}</h2>

            {scr.contact && (
                <ContactScreen scr={scr} a={a} lang={lang} tt={tt} errors={errors}
                    onPickFollow={(v) => pickSingle({ id: 'follow_up' }, v)}
                    onField={(k, v) => { setA({ ['c_' + k]: v }); clearErr('contact'); }}
                />
            )}

            {scr.qs.map((qd) => visible(seg, a, qd) && (
                <QuestionView
                    key={qd.id}
                    qd={qd}
                    seg={seg}
                    a={a}
                    lang={lang}
                    tt={tt}
                    err={errors[qd.id]}
                    onSingle={(v) => pickSingle(qd, v)}
                    onMulti={(v) => pickMulti(qd, v)}
                    onOther={(v) => setA({ [qd.id + '_other']: v })}
                    onText={(v) => { setA({ [qd.id]: v }); clearErr(qd.id); }}
                />
            ))}

            <div className="bh-nav">
                <button
                    type="button"
                    className="bh-btn-ghost press"
                    onClick={() => (step === 0 ? toChooser(false) : go({ step: step - 1 }))}
                >
                    {tt.back}
                </button>
                <button
                    type="button"
                    className="press bh-btn-pri"
                    style={authButton}
                    disabled={sending}
                    onClick={() => { void onNext(); }}
                >
                    {sending ? tt.sending : last ? tt.send : tt.next}
                </button>
            </div>
            {last && <p className="bh-sendnote">{tt.sendnote}</p>}
            {sendErr && <div className="bh-err bh-err-top" role="alert">{tt.errSend}</div>}
        </div>
    );
}

/* ------------------------------------------------------------ pieces */

function OptButton({ label, on, multi, onClick }: {
    label: string; on: boolean; multi: boolean; onClick: () => void;
}) {
    return (
        <button
            type="button"
            className="bh-opt"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            aria-pressed={on}
            onClick={onClick}
        >
            <span className="bh-ck" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5l5.2 5.2L20 7" />
                </svg>
            </span>
            <span>{label}</span>
        </button>
    );
}

function ErrLine({ tt, err }: { tt: BhStrings; err?: ErrKind }) {
    if (!err) return null;
    return <div className="bh-err" role="alert">{errText(tt, err)}</div>;
}

function QuestionView({ qd, seg, a, lang, tt, err, onSingle, onMulti, onOther, onText }: {
    qd: Question;
    seg: BhSegment;
    a: Answers;
    lang: BhLang;
    tt: BhStrings;
    err?: ErrKind;
    onSingle: (v: string) => void;
    onMulti: (v: string) => void;
    onOther: (v: string) => void;
    onText: (v: string) => void;
}) {
    const v = a[qd.id];
    const label = (
        <>
            {qd[lang]}
            {!qd.required && <> <span className="bh-opt-tag">{tt.optional}</span></>}
        </>
    );
    const cls = 'bh-q' + (err ? ' bad' : '');

    if (qd.type === 'single' || qd.type === 'multi' || qd.type === 'top') {
        const multi = qd.type === 'multi';
        const opts: Opt[] = qd.type === 'top' ? topOpts(seg, a, qd, tt.otherLabel) : (qd.opts || []);
        const sel: string[] = multi ? (Array.isArray(v) ? v : []) : (v == null ? [] : [String(v)]);
        let longest = 0;
        opts.forEach((op) => { longest = Math.max(longest, op[lang].length); });
        const otherOn = sel.indexOf('other') >= 0;
        return (
            <div className={cls} data-q={qd.id}>
                <fieldset>
                    <legend className="bh-lab">{label}</legend>
                    {multi && <div className="bh-hint">{qd.max ? tt.upTo(qd.max) : tt.all}</div>}
                    <div className={'bh-opts' + (longest > 30 ? ' stack' : '')}>
                        {opts.map((op) => (
                            <OptButton key={op.v} label={op[lang]} on={sel.indexOf(op.v) >= 0} multi={multi}
                                onClick={() => (multi ? onMulti(op.v) : onSingle(op.v))} />
                        ))}
                        {qd.other && (
                            <OptButton label={tt.otherLabel} on={otherOn} multi={multi}
                                onClick={() => (multi ? onMulti('other') : onSingle('other'))} />
                        )}
                    </div>
                    {qd.other && otherOn && (
                        <div className="bh-other">
                            <input
                                type="text"
                                className="bh-input"
                                maxLength={80}
                                data-other={qd.id}
                                value={str(a, qd.id + '_other')}
                                placeholder={tt.otherPh}
                                aria-label={tt.otherLabel}
                                onChange={(e) => onOther(e.target.value)}
                            />
                        </div>
                    )}
                    <ErrLine tt={tt} err={err} />
                </fieldset>
            </div>
        );
    }

    if (qd.type === 'select') {
        const groups = Object.keys(qd.groups || {});
        return (
            <div className={cls} data-q={qd.id}>
                <label className="bh-lab" htmlFor={'f_' + qd.id}>{label}</label>
                <select
                    id={'f_' + qd.id}
                    className="bh-input bh-select"
                    value={str(a, qd.id)}
                    onChange={(e) => onText(e.target.value)}
                >
                    <option value="">{tt.choose}</option>
                    {groups.map((g) => (
                        <optgroup key={g} label={qd.groups?.[g]?.[lang]}>
                            {(qd.opts || []).filter((op) => op.g === g).map((op) => (
                                <option key={op.v} value={op.v}>{op[lang]}</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                <ErrLine tt={tt} err={err} />
            </div>
        );
    }

    if (qd.type === 'text') {
        const it = qd.inputType || 'text';
        const ph = (lang === 'es' ? qd.ph_es : qd.ph_en) || '';
        return (
            <div className={cls} data-q={qd.id}>
                <label className="bh-lab" htmlFor={'f_' + qd.id}>{label}</label>
                <input
                    type={it}
                    id={'f_' + qd.id}
                    className="bh-input"
                    maxLength={160}
                    value={str(a, qd.id)}
                    placeholder={ph}
                    inputMode={it === 'url' ? 'url' : undefined}
                    autoCapitalize={it === 'url' ? 'none' : undefined}
                    onChange={(e) => onText(e.target.value)}
                />
                <ErrLine tt={tt} err={err} />
            </div>
        );
    }

    // textarea
    const max = qd.max || 600;
    const val = str(a, qd.id);
    return (
        <div className={cls} data-q={qd.id}>
            <label className="bh-lab" htmlFor={'f_' + qd.id}>{label}</label>
            <textarea
                id={'f_' + qd.id}
                className="bh-input"
                maxLength={max}
                value={val}
                onChange={(e) => onText(e.target.value)}
            />
            <div className="bh-cnt">{val.length} / {max}</div>
            <ErrLine tt={tt} err={err} />
        </div>
    );
}

const CONTACT_ORDER: ContactField[] = ['name', 'org', 'email', 'phone', 'whatsapp'];

function ContactScreen({ scr, a, lang, tt, errors, onPickFollow, onField }: {
    scr: Screen;
    a: Answers;
    lang: BhLang;
    tt: BhStrings;
    errors: Errors;
    onPickFollow: (v: string) => void;
    onField: (k: ContactField, v: string) => void;
}) {
    const light = scr.contact === 'light';

    const follow = (
        <div className={'bh-q' + (errors.follow_up ? ' bad' : '')} data-q="follow_up">
            <fieldset>
                <legend className="bh-lab">{FOLLOW[lang]}</legend>
                <div className="bh-opts stack">
                    {FOLLOW_OPTS.map((op) => (
                        <OptButton key={op.v} label={op[lang]} on={a.follow_up === op.v} multi={false}
                            onClick={() => onPickFollow(op.v)} />
                    ))}
                </div>
                <ErrLine tt={tt} err={errors.follow_up} />
            </fieldset>
        </div>
    );

    const contact = (
        <div className={'bh-q' + (errors.contact ? ' bad' : '')} data-q="contact" hidden={light && !wantsFollow(a)}>
            <div className="bh-hint">{tt.reach}</div>
            <div className="bh-grid2">
                {CONTACT_ORDER.map((k) => {
                    const f = CONTACT[k];
                    const tel = k === 'phone' || k === 'whatsapp';
                    const req = (!light && (k === 'name' || k === 'org')) || k === 'email' || tel;
                    return (
                        <div className="bh-field" key={k}>
                            <label htmlFor={'c_' + k}>
                                {f[lang]}
                                {!req && <> <span className="bh-opt-tag">{tt.optional}</span></>}
                            </label>
                            <input
                                type={f.type}
                                id={'c_' + k}
                                className="bh-input"
                                autoComplete={f.ac}
                                maxLength={tel ? 40 : 160}
                                value={str(a, 'c_' + k)}
                                inputMode={tel ? 'tel' : k === 'email' ? 'email' : undefined}
                                placeholder={tel ? '+52 656 000 0000' : undefined}
                                autoCapitalize={k === 'email' ? 'none' : undefined}
                                onChange={(e) => onField(k, e.target.value)}
                            />
                        </div>
                    );
                })}
            </div>
            <ErrLine tt={tt} err={errors.contact} />
        </div>
    );

    return light ? <>{follow}{contact}</> : <>{contact}{follow}</>;
}

