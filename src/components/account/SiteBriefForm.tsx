import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { ARCHETYPES, ARCHETYPE_OF, EXTRAS_FOR, EXTRA_KEYS, orderFor, type Archetype, type ExtraKey } from '../../utils/siteBrief';
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

const MAX_ITEMS = 6;
const FEATURED = 3;

/**
 * The questionnaire: what kind of practice this is, what the visitor should do
 * first, what matters most (a ranking, not scores: people rate everything a 10),
 * the proof the listing cannot supply, and a few lines about the practice that
 * the copy is written from. Saved through `update_my_site` (migration 0037).
 */
export function SiteBriefForm({ clinic, content, onSaved }: { clinic: Provider; content: BriefContent; onSaved: () => void }) {
    const { t, i18n } = useTranslation();
    const toast = useToast();
    const lang: Lang = i18n.language?.startsWith('es') ? 'es' : 'en';
    const saved = content.brief ?? {};

    const [archetype, setArchetype] = useState<Archetype>(saved.archetype ?? ARCHETYPE_OF[clinic.specialty?.[0] ?? ''] ?? 'routine');
    const [order, setOrder] = useState<string[]>(() => orderFor(saved.archetype ?? ARCHETYPE_OF[clinic.specialty?.[0] ?? ''] ?? 'routine', saved.priorities));
    const [hidden, setHidden] = useState<string[]>(saved.hidden ?? []);
    const [cta, setCta] = useState<'whatsapp' | 'call'>(saved.cta ?? 'whatsapp');
    const [answers, setAnswers] = useState(saved.answers ?? {});
    const [extras, setExtras] = useState<Record<string, Item[]>>(() => {
        const out: Record<string, Item[]> = {};
        for (const b of content.blocks ?? []) out[b.key] = b.items?.[lang] ?? b.items?.es ?? b.items?.en ?? [];
        return out;
    });
    const [attested, setAttested] = useState(false);
    const [dragKey, setDragKey] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const changeArchetype = (a: Archetype) => {
        setArchetype(a);
        // Re-seed the ranking from the new kind of practice; the owner then adjusts it.
        setOrder(orderFor(a, undefined));
        setHidden([]);
    };
    const shown = order.filter((k) => !hidden.includes(k));
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

    const save = async () => {
        if (!supabase) return;
        if (hasResults && !attested) { setError(t('account.site.brief.attestNeeded')); return; }
        setError(null); setBusy(true);
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
        setBusy(false);
        if (err) { setError(err.message); return; }
        toast(t('account.site.saved'));
        onSaved();
    };

    const field = (k: keyof NonNullable<typeof answers>, max = 400) => (
        <div className="acct-field" key={k}>
            <label htmlFor={`brief-${k}`}>{t(`account.site.brief.q.${k}`)}</label>
            <textarea id={`brief-${k}`} rows={3} maxLength={max} value={answers[k] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [k]: e.target.value }))} />
            <p className="acct-hint">{t(`account.site.brief.q.${k}Hint`)}</p>
        </div>
    );

    return (
        <>
            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.brief.kind')}</h2>
                <p className="acct-muted">{t('account.site.brief.kindHint')}</p>
                <div className="acct-field">
                    <label htmlFor="brief-arch">{t('account.site.brief.kindLabel')}</label>
                    <select id="brief-arch" value={archetype} onChange={(e) => changeArchetype(e.target.value as Archetype)}>
                        {ARCHETYPES.map((a) => <option key={a} value={a}>{t(`account.site.brief.arch.${a}`)}</option>)}
                    </select>
                    <p className="acct-hint">{t(`account.site.brief.archHint.${archetype}`)}</p>
                </div>
                <fieldset className="acct-field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="acct-fine" style={{ fontWeight: 700, marginBottom: 6 }}>{t('account.site.brief.cta')}</legend>
                    <label className="acct-row" style={{ gap: 8 }}><input type="radio" name="brief-cta" style={{ width: 'auto' }} checked={cta === 'whatsapp'} onChange={() => setCta('whatsapp')} />{t('account.site.brief.ctaWhatsapp')}</label>
                    <label className="acct-row" style={{ gap: 8 }}><input type="radio" name="brief-cta" style={{ width: 'auto' }} checked={cta === 'call'} onChange={() => setCta('call')} />{t('account.site.brief.ctaCall')}</label>
                </fieldset>
            </section>

            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.brief.rank')}</h2>
                <p className="acct-muted">{t('account.site.brief.rankHint', { count: FEATURED })}</p>
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
                    {order.map((k, i) => (
                        <li
                            key={k}
                            draggable
                            onDragStart={() => setDragKey(k)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragKey && dragKey !== k) move(dragKey, i); setDragKey(null); }}
                            className="acct-row"
                            style={{ padding: '0.55rem 0.8rem', border: '1px solid var(--border)', borderRadius: 12, opacity: hidden.includes(k) ? 0.5 : 1, cursor: 'grab', flexWrap: 'nowrap' }}
                        >
                            <span aria-hidden style={{ color: 'var(--gray-500)' }}>⋮⋮</span>
                            <strong style={{ flex: 1 }}>{t(`account.site.brief.block.${k}`)}</strong>
                            {featured.has(k) && <span className="acct-pill">{t('account.site.brief.featured')}</span>}
                            <button type="button" className="acct-link" aria-label={t('account.site.brief.up')} disabled={i === 0} onClick={() => move(k, i - 1)}>↑</button>
                            <button type="button" className="acct-link" aria-label={t('account.site.brief.down')} disabled={i === order.length - 1} onClick={() => move(k, i + 1)}>↓</button>
                            <label className="acct-fine" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={hidden.includes(k)} onChange={() => toggleHidden(k)} />{t('account.site.brief.hide')}
                            </label>
                        </li>
                    ))}
                </ol>
            </section>

            {relevant.map((key) => (
                <section className="acct-card" key={key}>
                    <h2 className="acct-card-title">{t(`account.site.brief.block.${key}`)}</h2>
                    <p className="acct-muted">{t(`account.site.brief.extraHint.${key}`)}</p>
                    {(extras[key] ?? []).map((it, i) => (
                        <div key={i} className="acct-field" style={{ padding: '0.7rem', border: '1px solid var(--border)', borderRadius: 12 }}>
                            <input aria-label={t('account.site.brief.itemTitle')} placeholder={t(`account.site.brief.itemTitlePh.${key}`)} maxLength={70} value={it.title} onChange={(e) => setItem(key, i, 'title', e.target.value)} />
                            <textarea aria-label={t('account.site.brief.itemBody')} placeholder={t('account.site.brief.itemBody')} rows={2} maxLength={220} value={it.body} onChange={(e) => setItem(key, i, 'body', e.target.value)} />
                            <button type="button" className="acct-link acct-link--danger" style={{ alignSelf: 'flex-start' }} onClick={() => removeItem(key, i)}>{t('account.site.remove')}</button>
                        </div>
                    ))}
                    {(extras[key]?.length ?? 0) < MAX_ITEMS && (
                        <button type="button" className="acct-btn acct-btn--ghost acct-btn--sm" style={{ alignSelf: 'flex-start' }} onClick={() => addItem(key)}>{t('account.site.brief.add')}</button>
                    )}
                </section>
            ))}

            {hasResults && (
                <section className="acct-card">
                    <label className="acct-row" style={{ gap: 10, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                        <input type="checkbox" style={{ width: 'auto', marginTop: 4 }} checked={attested} onChange={(e) => setAttested(e.target.checked)} />
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
            <div className="acct-row">
                <button type="button" className="acct-btn" disabled={busy} onClick={() => void save()}>
                    {busy ? t('account.site.saving') : t('account.site.brief.save')}
                </button>
            </div>
        </>
    );
}
