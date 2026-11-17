import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { ARCHETYPES, archetypeFor, EXTRAS_FOR, EXTRA_KEYS, orderFor, type Archetype, type ExtraKey } from '../../utils/siteBrief';
import { useToast } from './toastContext';

type Lang = 'es' | 'en';
type Item = { title: string; body: string };
type Loc = Partial<Record<Lang, string>>;
export interface BriefContent {
    brief?: {
        archetype?: Archetype; priorities?: string[]; hidden?: string[]; cta?: 'whatsapp' | 'call';
        answers?: { patient?: string; worry?: string; different?: string; proud?: string };
    };
    blocks?: { key: ExtraKey; title?: Loc; items?: Partial<Record<Lang, Item[]>> }[];
}

interface Draft {
    headline: Record<Lang, string>;
    lead: Record<Lang, string>;
    about: Record<Lang, string>;
    highlights: Record<Lang, Item[]>;
    faq: Record<Lang, { q: string; a: string }[]>;
}

/** A textarea that grows with what is typed (no drag handle, no inner scroll) and counts characters. */
function AutoArea({ value, max, onValue, ...rest }: { value: string; max: number; onValue: (v: string) => void } & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'maxLength'>) {
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
        <div className="sb-area-wrap">
            <textarea ref={ref} className="sb-area" rows={2} maxLength={max} value={value} onChange={(e) => onValue(e.target.value)} {...rest} />
            {value.length > max * 0.7 && <span className="sb-count">{value.length}/{max}</span>}
        </div>
    );
}

const MAX_ITEMS = 6;
const FEATURED = 3;

/**
 * The questionnaire: what kind of practice this is, what the visitor should do
 * first, what matters most (a ranking, not scores: people rate everything a 10),
 * the proof the listing cannot supply, and a few lines about the practice that
 * the copy is written from. Saved through `update_my_site` (migration 0037).
 */
export function SiteBriefForm({ clinic, content, onSaved, onEditProfile }: { clinic: Provider; content: BriefContent; onSaved: () => void; onEditProfile?: (field: string) => void }) {
    const { t, i18n } = useTranslation();
    const toast = useToast();
    const lang: Lang = i18n.language?.startsWith('es') ? 'es' : 'en';
    const saved = content.brief ?? {};

    const [archetype, setArchetype] = useState<Archetype>(saved.archetype ?? archetypeFor(clinic.specialty, clinic.kind));
    const [order, setOrder] = useState<string[]>(() => orderFor(saved.archetype ?? archetypeFor(clinic.specialty, clinic.kind), saved.priorities));
    const [hidden, setHidden] = useState<string[]>(saved.hidden ?? []);
    const hasWhatsapp = !!clinic.socials?.whatsapp;
    const hasPhone = !!clinic.phone?.trim();
    // Start from what the visitor can actually do: a number we have, not one we do not.
    const [cta, setCta] = useState<'whatsapp' | 'call'>(saved.cta ?? (hasWhatsapp || !hasPhone ? 'whatsapp' : 'call'));
    const [answers, setAnswers] = useState(saved.answers ?? {});
    const [extras, setExtras] = useState<Record<string, Item[]>>(() => {
        const out: Record<string, Item[]> = {};
        for (const b of content.blocks ?? []) out[b.key] = b.items?.[lang] ?? b.items?.es ?? b.items?.en ?? [];
        return out;
    });
    const [attested, setAttested] = useState(false);
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [justSaved, setJustSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [drafting, setDrafting] = useState(false);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [warnings, setWarnings] = useState<string[]>([]);
    const [draftLang, setDraftLang] = useState<Lang>(lang);

    const changeArchetype = (a: Archetype) => {
        setArchetype(a);
        // Re-seed the ranking from the new kind of practice; the owner then adjusts it.
        setOrder(orderFor(a, undefined));
        setHidden([]);
    };
    // A proof block nobody has filled in has nothing to rank: it would not appear on the site anyway.
    const listed = order.filter((k) => !(EXTRA_KEYS as string[]).includes(k) || (extras[k]?.length ?? 0) > 0);
    const shown = listed.filter((k) => !hidden.includes(k));
    const featured = new Set(shown.slice(0, FEATURED));
    const move = (key: string, to: number) => setOrder((o) => {
        const from = o.indexOf(key);
        if (from < 0 || to < 0 || to >= o.length) return o;
        const n = [...o]; n.splice(from, 1); n.splice(to, 0, key); return n;
    });
    const toggleHidden = (k: string) => setHidden((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]));

    const relevant = EXTRA_KEYS.filter((k) => EXTRAS_FOR[archetype].includes(k) || (extras[k]?.length ?? 0) > 0);
    const hasResults = (extras.results?.length ?? 0) > 0;
    const setItem = (key: string, i: number, field: keyof Item, v: string) =>
        setExtras((e) => ({ ...e, [key]: (e[key] ?? []).map((it, k) => (k === i ? { ...it, [field]: v } : it)) }));
    const addItem = (key: string) => setExtras((e) => ({ ...e, [key]: [...(e[key] ?? []), { title: '', body: '' }] }));
    const removeItem = (key: string, i: number) => setExtras((e) => ({ ...e, [key]: (e[key] ?? []).filter((_, k) => k !== i) }));

    /** Writes the brief to the database. Returns false (and says why) if it could not. */
    const persist = async (): Promise<boolean> => {
        if (!supabase) return false;
        if (hasResults && !attested) { setError(t('account.site.brief.attestNeeded')); return false; }
        const blocks = EXTRA_KEYS.flatMap((key) => {
            const items = (extras[key] ?? []).map((i) => ({ title: i.title.trim(), body: i.body.trim() })).filter((i) => i.title && i.body);
            if (!items.length) return [];
            const old = content.blocks?.find((b) => b.key === key);
            return [{ key, ...(old?.title ? { title: old.title } : {}), items: { ...old?.items, [lang]: items } }];
        });
        const patch = {
            brief: { ...saved, archetype, priorities: order, hidden, cta, answers },
            blocks,
        };
        const { error: err } = await supabase.rpc('update_my_site', { target: clinic.id, patch });
        if (err) { setError(err.message); return false; }
        return true;
    };

    const save = async () => {
        setError(null); setBusy(true);
        const ok = await persist();
        setBusy(false);
        if (!ok) return;
        toast(t('account.site.saved'));
        setJustSaved(true);
        window.setTimeout(() => setJustSaved(false), 3000);
        onSaved();
    };

    /** Saves the answers, then asks for a draft written from them. Nothing goes live from here. */
    const writeText = async () => {
        if (!supabase) return;
        setError(null); setDrafting(true); setDraft(null); setWarnings([]);
        try {
            if (!(await persist())) return;
            const { data: sess } = await supabase.auth.getSession();
            const token = sess.session?.access_token;
            if (!token) { setError(t('account.site.brief.copy.errSignIn')); return; }
            const r = await fetch('/api/agent?route=site-copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ provider_id: clinic.id }),
            });
            const j = (await r.json().catch(() => null)) as { draft?: Draft; warnings?: string[]; error?: { message?: string } } | null;
            if (!r.ok || !j?.draft) { setError(j?.error?.message ?? t('account.site.brief.copy.errFailed')); return; }
            setDraft(j.draft); setWarnings(j.warnings ?? []); setDraftLang(lang);
        } catch {
            setError(t('account.site.brief.copy.errFailed'));
        } finally {
            setDrafting(false);
        }
    };

    /** The owner read it and said yes: only now does it reach the site. */
    const approve = async () => {
        if (!supabase || !draft) return;
        setError(null); setBusy(true);
        const { error: err } = await supabase.rpc('update_my_site', {
            target: clinic.id,
            patch: { headline: draft.headline, lead: draft.lead, about: draft.about, highlights: draft.highlights, faq: draft.faq },
        });
        setBusy(false);
        if (err) { setError(err.message); return; }
        setDraft(null);
        toast(t('account.site.brief.copy.applied'));
        onSaved();
    };

    const field = (k: keyof NonNullable<typeof answers>, max = 400) => (
        <div className="acct-field" key={k}>
            <label htmlFor={`brief-${k}`}>{t(`account.site.brief.q.${k}`)}</label>
            <AutoArea id={`brief-${k}`} value={answers[k] ?? ''} max={max} onValue={(v) => setAnswers((a) => ({ ...a, [k]: v }))} />
            <p className="acct-hint">{t(`account.site.brief.q.${k}Hint`)}</p>
        </div>
    );

    return (
        <div className="acct-form">
            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.brief.kind')}</h2>
                <p className="acct-muted">{t('account.site.brief.kindHint')}</p>
                <div className="sb-cards" role="radiogroup" aria-label={t('account.site.brief.kindLabel')}>
                    {ARCHETYPES.map((a) => (
                        <label key={a} className="sb-card">
                            <input type="radio" name="brief-arch" checked={archetype === a} onChange={() => changeArchetype(a)} />
                            <b>{t(`account.site.brief.arch.${a}`)}</b>
                            <span>{t(`account.site.brief.archHint.${a}`)}</span>
                        </label>
                    ))}
                </div>
                <fieldset className="sb-fieldset">
                    <legend>{t('account.site.brief.cta')}</legend>
                    <div className="sb-cards sb-cards--two">
                        <label className={`sb-card${hasWhatsapp ? '' : ' is-unavailable'}`}><input type="radio" name="brief-cta" disabled={!hasWhatsapp} checked={cta === 'whatsapp'} onChange={() => setCta('whatsapp')} /><b>{t('account.site.brief.ctaWhatsapp')}</b>{!hasWhatsapp && <span>{t('account.site.brief.ctaNeedWhatsapp')}</span>}</label>
                        <label className={`sb-card${hasPhone ? '' : ' is-unavailable'}`}><input type="radio" name="brief-cta" disabled={!hasPhone} checked={cta === 'call'} onChange={() => setCta('call')} /><b>{t('account.site.brief.ctaCall')}</b>{!hasPhone && <span>{t('account.site.brief.ctaNeedPhone')}</span>}</label>
                    </div>
                    {!hasWhatsapp && !hasPhone && onEditProfile && (
                        <p className="acct-fine">{t('account.site.brief.ctaNone')} <button type="button" className="acct-link" onClick={() => onEditProfile('acct-phone')}>{t('account.site.known.add')}</button></p>
                    )}
                </fieldset>
            </section>

            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.brief.rank')}</h2>
                <p className="acct-muted">{t('account.site.brief.rankHint', { count: FEATURED })}</p>
                <ol className="sb-rank">
                    {listed.map((k, i) => {
                        const off = hidden.includes(k);
                        const place = shown.indexOf(k) + 1;
                        return (
                            <li
                                key={k}
                                draggable
                                onDragStart={() => setDragKey(k)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => { if (dragKey && dragKey !== k) move(dragKey, order.indexOf(k)); setDragKey(null); }}
                                className={`sb-rank-row${featured.has(k) ? ' is-featured' : ''}${off ? ' is-off' : ''}`}
                            >
                                <span className="sb-grip" aria-hidden>⋮⋮</span>
                                <span className="sb-place" aria-hidden>{off ? '–' : place}</span>
                                <strong className="sb-rank-name">{t(`account.site.brief.block.${k}`)}</strong>
                                {featured.has(k) && <span className="sb-badge">{t('account.site.brief.featured')}</span>}
                                <button type="button" className="sb-icon" aria-label={t('account.site.brief.up')} disabled={i === 0} onClick={() => move(k, order.indexOf(listed[i - 1]))}>↑</button>
                                <button type="button" className="sb-icon" aria-label={t('account.site.brief.down')} disabled={i === listed.length - 1} onClick={() => move(k, order.indexOf(listed[i + 1]))}>↓</button>
                                <label className="sb-switch">
                                    <input type="checkbox" role="switch" checked={!off} onChange={() => toggleHidden(k)} />
                                    <span className="sb-track" aria-hidden />
                                    <span>{t('account.site.brief.show')}</span>
                                </label>
                            </li>
                        );
                    })}
                </ol>
            </section>

            {relevant.map((key) => (
                <section className="acct-card" key={key}>
                    <h2 className="acct-card-title">{t(`account.site.brief.block.${key}`)}</h2>
                    <p className="acct-muted">{t(`account.site.brief.extraHint.${key}`)}</p>
                    {(extras[key] ?? []).map((it, i) => (
                        <div key={i} className="sb-item">
                            <span className="sb-item-no" aria-hidden>{i + 1}</span>
                            <div className="sb-item-fields">
                                <input aria-label={t('account.site.brief.itemTitle')} placeholder={t(`account.site.brief.itemTitlePh.${key}`)} maxLength={70} value={it.title} onChange={(e) => setItem(key, i, 'title', e.target.value)} />
                                <AutoArea aria-label={t('account.site.brief.itemBody')} placeholder={t('account.site.brief.itemBody')} max={220} value={it.body} onValue={(v) => setItem(key, i, 'body', v)} />
                            </div>
                            <button type="button" className="sb-icon sb-icon--danger" aria-label={t('account.site.remove')} onClick={() => removeItem(key, i)}>×</button>
                        </div>
                    ))}
                    {(extras[key]?.length ?? 0) < MAX_ITEMS && (
                        <button type="button" className="acct-btn acct-btn--ghost acct-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => addItem(key)}>{t('account.site.brief.add')}</button>
                    )}
                </section>
            ))}

            {hasResults && (
                <section className="acct-card">
                    <label className="sb-check">
                        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                        <span className="sb-box" aria-hidden />
                        <span className="acct-muted">{t('account.site.brief.attest')}</span>
                    </label>
                </section>
            )}

            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.brief.about')}</h2>
                <p className="acct-muted">{t('account.site.brief.aboutHint')}</p>
                {field('patient')}
                {field('worry')}
                {field('different')}
                {field('proud')}
            </section>

            {error && <p className="acct-msg acct-msg--error acct-msg--block" role="alert">{error}</p>}
            <div className="sb-actions">
                <button type="button" className="acct-btn acct-btn--ghost" disabled={busy || drafting} onClick={() => void save()}>
                    {busy ? t('account.site.saving') : justSaved ? `✓ ${t('account.site.saved')}` : t('account.site.brief.save')}
                </button>
                <button type="button" className="acct-btn" disabled={busy || drafting} onClick={() => void writeText()}>
                    {drafting ? t('account.site.brief.copy.writing') : t('account.site.brief.copy.write')}
                </button>
            </div>
            <p className="acct-fine">{t('account.site.brief.copy.note')}</p>

            {draft && (
                <section className="acct-card" aria-live="polite">
                    <div className="acct-card-head">
                        <h2 className="acct-card-title">{t('account.site.brief.copy.title')}</h2>
                        <div className="acct-row">
                            {(['es', 'en'] as Lang[]).map((l) => (
                                <button key={l} type="button" className={`acct-btn acct-btn--sm${draftLang === l ? '' : ' acct-btn--ghost'}`} onClick={() => setDraftLang(l)}>{l.toUpperCase()}</button>
                            ))}
                        </div>
                    </div>
                    {warnings.length > 0 && (
                        <p className="acct-msg acct-msg--error acct-msg--block" role="alert">{t('account.site.brief.copy.warn', { items: warnings.join(', ') })}</p>
                    )}
                    <p className="acct-fine">{t('account.site.brief.copy.headline')}</p>
                    <p style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>{draft.headline[draftLang]}</p>
                    <p className="acct-fine">{t('account.site.brief.copy.lead')}</p>
                    <p style={{ margin: 0 }}>{draft.lead[draftLang]}</p>
                    <p className="acct-fine">{t('account.site.brief.copy.aboutLabel')}</p>
                    <p style={{ margin: 0 }}>{draft.about[draftLang]}</p>
                    <p className="acct-fine">{t('account.site.brief.copy.highlights')}</p>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{draft.highlights[draftLang].map((h) => <li key={h.title}><strong>{h.title}.</strong> {h.body}</li>)}</ul>
                    <p className="acct-fine">{t('account.site.brief.copy.faq')}</p>
                    <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{draft.faq[draftLang].map((f) => <li key={f.q}><strong>{f.q}</strong> {f.a}</li>)}</ul>
                    <p className="acct-muted">{t('account.site.brief.copy.ask')}</p>
                    <div className="acct-row">
                        <button type="button" className="acct-btn" disabled={busy} onClick={() => void approve()}>{t('account.site.brief.copy.approve')}</button>
                        <button type="button" className="acct-btn acct-btn--ghost" disabled={busy || drafting} onClick={() => void writeText()}>{t('account.site.brief.copy.again')}</button>
                        <button type="button" className="acct-link" onClick={() => setDraft(null)}>{t('account.site.brief.copy.discard')}</button>
                    </div>
                </section>
            )}
        </div>
    );
}
