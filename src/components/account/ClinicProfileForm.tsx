import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider, ProviderSocials } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { normalizeSocial, normalizeWebsite, SOCIAL_NETWORKS, type SocialNetwork } from '../../utils/socials';
import { IconCheck } from '../icons/Icons';
import { ClinicAvatarUploader } from './ClinicAvatarUploader';
import { LanguagePicker } from './LanguagePicker';
import { ListingKindCard } from './ListingKindCard';
import { SocialLinksEditor, type SocialDraft } from './SocialLinksEditor';
import { useToast } from './toastContext';

/**
 * The listing, as the clinic can edit it.
 *
 * Only the columns the database will actually accept. `tier`, `verified`,
 * `promoted`, `featuredRank`, `rating` and `reviewCount` are missing from the
 * UPDATE grant, so a request carrying them is rejected outright; this form
 * stays in step with that on purpose rather than offering a field that would
 * silently fail. What we sell and what we measure are not the clinic's to
 * write; what the clinic knows about itself is.
 */
interface Draft {
    name: string;
    phone: string;
    website: string;
    email: string;
    address: string;
    description: string;
    languages: string[];
    socials: SocialDraft;
}

const DESCRIPTION_MAX = 1200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function makeDraft(c: Provider): Draft {
    const socials = {} as SocialDraft;
    for (const n of SOCIAL_NETWORKS) socials[n.key] = c.socials?.[n.key] ?? '';
    return {
        name: c.name ?? '',
        phone: c.phone ?? '',
        website: c.website ?? '',
        email: c.email ?? '',
        address: c.address ?? '',
        description: (c as Provider & { description?: string }).description ?? '',
        languages: [...(c.languages ?? [])],
        socials,
    };
}

/** Order-insensitive for languages, so re-ticking the same set is not "dirty". */
const snapshot = (d: Draft) => JSON.stringify({ ...d, languages: [...d.languages].sort() });
const sameLanguages = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export function ClinicProfileForm({ clinic, onSaved, onDirtyChange }: {
    clinic: Provider;
    onSaved: () => void;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const [draft, setDraft] = useState<Draft>(() => makeDraft(clinic));
    const [saved, setSaved] = useState<Draft>(draft);
    const [touched, setTouched] = useState<Set<string>>(new Set());
    const [attempted, setAttempted] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [justSaved, setJustSaved] = useState(false);

    const dirty = useMemo(() => snapshot(draft) !== snapshot(saved), [draft, saved]);

    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    // Closing the tab with unsaved work is the one loss the in-app guard cannot catch.
    useEffect(() => {
        if (!dirty) return;
        const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', h);
        return () => window.removeEventListener('beforeunload', h);
    }, [dirty]);

    useEffect(() => {
        if (!justSaved) return;
        const id = window.setTimeout(() => setJustSaved(false), 2600);
        return () => window.clearTimeout(id);
    }, [justSaved]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setDraft((d) => ({ ...d, [key]: value }));
        setJustSaved(false);
    };
    const touch = (key: string) => setTouched((s) => new Set(s).add(key));

    // Inline validation, derived rather than stored.
    const websiteRes = normalizeWebsite(draft.website);
    const errors: Record<string, string | undefined> = {
        name: draft.name.trim() ? undefined : t('account.errNameRequired'),
        email: draft.email.trim() && !EMAIL_RE.test(draft.email.trim()) ? t('account.errEmail') : undefined,
        website: websiteRes.error ? t('account.errWebsite') : undefined,
    };
    const show = (key: string) => (touched.has(key) || attempted) && errors[key];
    const socialResults = SOCIAL_NETWORKS.map((n) => ({ n, res: normalizeSocial(n.key, draft.socials[n.key]) }));
    const socialsInvalid = socialResults.some((r) => r.res.error);
    const hasErrors = !!(errors.name || errors.email || errors.website) || socialsInvalid;

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!supabase || busy) return;
        setAttempted(true);
        setError(null);

        if (hasErrors) {
            setError(t('account.fixErrors'));
            const firstBad =
                (errors.name && 'acct-name') || (errors.email && 'acct-email') || (errors.website && 'acct-website') ||
                (socialsInvalid && 'acct-socials') || undefined;
            document.getElementById(firstBad ?? 'acct-name')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
        }

        setBusy(true);

        // Empty strings go back as null rather than as "", so a cleared field
        // reads as absent everywhere else in the app: `provider.phone && ...`
        // is the idiom throughout, and "" would render an empty contact row.
        const patch: Record<string, string | null | string[]> = {
            name: draft.name.trim(),
            phone: draft.phone.trim() || null,
            website: websiteRes.url ?? null,
            email: draft.email.trim() || null,
            address: draft.address.trim() || null,
            description: draft.description.trim() || null,
            updated_at: new Date().toISOString(),
        };
        // Only when it changed: the database confirms languages by watching
        // this column (migration 0004), so sending it is what turns "not
        // specified" into a stated fact, and re-sending it unchanged is noise.
        const languagesChanged = !sameLanguages(draft.languages, saved.languages);
        if (languagesChanged) patch.languages = draft.languages;

        const { error: err } = await supabase.from('providers').update(patch).eq('id', clinic.id);
        if (err) {
            setBusy(false);
            setError(err.message);
            toast(t('account.saveFailed'), 'error');
            return;
        }

        // Canonicalise what the owner typed, so the boxes now show what was stored.
        const nextDraft: Draft = {
            ...draft,
            name: draft.name.trim(),
            website: websiteRes.url ?? '',
            socials: { ...draft.socials },
        };
        let nextSaved: Draft = { ...nextDraft, socials: { ...saved.socials } };

        // Socials go in their own request: it is a separate column with its own
        // grant, and a permission problem there must not lose the rest of the save.
        const socialsChanged = SOCIAL_NETWORKS.some((n) => draft.socials[n.key] !== saved.socials[n.key]);
        let socialsFailed: string | null = null;
        if (socialsChanged) {
            const merged: ProviderSocials = { ...(clinic.socials ?? {}) };
            for (const { n, res } of socialResults) {
                if (res.url) merged[n.key] = res.url;
                else delete merged[n.key];
                nextDraft.socials[n.key] = res.url ?? '';
            }
            const { error: sErr } = await supabase
                .from('providers')
                .update({ socials: merged, updated_at: new Date().toISOString() })
                .eq('id', clinic.id);
            if (sErr) socialsFailed = sErr.message;
            else nextSaved = { ...nextDraft };
        } else {
            nextSaved = { ...nextDraft, socials: { ...saved.socials } };
        }

        setBusy(false);
        setDraft(nextDraft);
        setSaved(nextSaved);
        setAttempted(false);
        onSaved();

        if (socialsFailed) {
            setError(t('account.socialsSaveFailed', { detail: socialsFailed }));
            toast(t('account.savedPartial'), 'error');
        } else {
            setJustSaved(true);
            toast(t('account.savedToast'));
        }
    };

    const discard = () => {
        setDraft(saved);
        setTouched(new Set());
        setAttempted(false);
        setError(null);
    };

    const socialCount = SOCIAL_NETWORKS.filter((n) => draft.socials[n.key].trim()).length;

    return (
        <form onSubmit={submit} className="acct-form" noValidate>
            <ClinicAvatarUploader clinic={clinic} onChanged={onSaved} />
            <ListingKindCard clinic={clinic} onSaved={onSaved} />

            <section className="acct-card" aria-labelledby="acct-basics-title">
                <h2 id="acct-basics-title" className="acct-card-title">{t('account.sectionBasics')}</h2>

                <div className="acct-field">
                    <label htmlFor="acct-name">{t('account.fieldName')}</label>
                    <input
                        id="acct-name" value={draft.name}
                        aria-invalid={!!show('name') || undefined}
                        onChange={(e) => set('name', e.target.value)}
                        onBlur={() => touch('name')}
                    />
                    {show('name') && <p className="acct-msg acct-msg--error" role="alert">{errors.name}</p>}
                </div>

                <div className="acct-grid2">
                    <div className="acct-field">
                        <label htmlFor="acct-phone">{t('account.fieldPhone')}</label>
                        <input
                            id="acct-phone" type="tel" inputMode="tel" value={draft.phone}
                            onChange={(e) => set('phone', e.target.value)}
                        />
                    </div>
                    <div className="acct-field">
                        <label htmlFor="acct-email">{t('account.fieldEmail')}</label>
                        <input
                            id="acct-email" type="email" value={draft.email}
                            aria-invalid={!!show('email') || undefined}
                            onChange={(e) => set('email', e.target.value)}
                            onBlur={() => touch('email')}
                        />
                        {show('email') && <p className="acct-msg acct-msg--error" role="alert">{errors.email}</p>}
                    </div>
                </div>

                <div className="acct-field">
                    <label htmlFor="acct-website">{t('account.fieldWebsite')}</label>
                    <input
                        id="acct-website" inputMode="url" placeholder="https://yourclinic.com"
                        autoCapitalize="none" spellCheck={false} value={draft.website}
                        aria-invalid={!!show('website') || undefined}
                        onChange={(e) => set('website', e.target.value)}
                        onBlur={() => touch('website')}
                    />
                    {show('website')
                        ? <p className="acct-msg acct-msg--error" role="alert">{errors.website}</p>
                        : websiteRes.url && websiteRes.url !== draft.website.trim() && (
                            <p className="acct-hint">{t('account.willSaveAs', { url: websiteRes.url })}</p>
                        )}
                </div>

                <div className="acct-field">
                    <label htmlFor="acct-address">{t('account.fieldAddress')}</label>
                    <input id="acct-address" value={draft.address} onChange={(e) => set('address', e.target.value)} />
                    <p className="acct-hint">{t('account.fieldAddressHint')}</p>
                </div>

                <div className="acct-field">
                    <label htmlFor="acct-description">{t('account.fieldDescription')}</label>
                    <textarea
                        id="acct-description" maxLength={DESCRIPTION_MAX} value={draft.description}
                        onChange={(e) => set('description', e.target.value)}
                    />
                    <p className="acct-hint acct-hint--split">
                        <span>{t('account.fieldDescriptionHint')}</span>
                        <span className="acct-counter">{draft.description.length}/{DESCRIPTION_MAX}</span>
                    </p>
                </div>
            </section>

            {/*
              The only real source of language data in the directory: every
              listing that has not claimed itself shows "not specified" rather
              than a guess, because nothing upstream ever asked a clinic what
              it speaks. Choosing here is what turns that into a fact.
            */}
            <section id="acct-languages" className="acct-card" aria-labelledby="acct-lang-title" tabIndex={-1}>
                <h2 id="acct-lang-title" className="acct-card-title">{t('account.fieldLanguages')}</h2>
                <p className="acct-muted">{t('account.languagesIntro')}</p>
                <LanguagePicker
                    value={draft.languages}
                    onChange={(v) => set('languages', v)}
                    confirmed={clinic.languagesConfirmed}
                />
            </section>

            <section id="acct-socials" className="acct-card" aria-labelledby="acct-social-title" tabIndex={-1}>
                <div className="acct-card-head">
                    <h2 id="acct-social-title" className="acct-card-title">{t('account.socialTitle')}</h2>
                    <span className="acct-pill">{t('account.socialCount', { count: socialCount })}</span>
                </div>
                <p className="acct-muted">{t('account.socialIntro')}</p>
                <SocialLinksEditor
                    value={draft.socials}
                    onChange={(k: SocialNetwork, v) => {
                        setDraft((d) => ({ ...d, socials: { ...d.socials, [k]: v } }));
                        setJustSaved(false);
                    }}
                    showAllErrors={attempted}
                />
            </section>

            {error && <p role="alert" className="acct-msg acct-msg--error acct-msg--block">{error}</p>}

            <div className={`acct-savebar${dirty ? ' is-dirty' : ''}`}>
                <span className="acct-savebar-state" aria-live="polite">
                    {justSaved
                        ? <><IconCheck size={15} weight={2.4} /> {t('account.saved')}</>
                        : dirty ? <><span className="acct-dot" /> {t('account.unsaved')}</> : t('account.allSaved')}
                </span>
                <span className="acct-savebar-actions">
                    {dirty && !busy && (
                        <button type="button" className="acct-btn acct-btn--ghost" onClick={discard}>
                            {t('account.discard')}
                        </button>
                    )}
                    <button type="submit" disabled={busy || !dirty} className="acct-btn">
                        {busy ? t('account.working') : t('account.save')}
                    </button>
                </span>
            </div>

            {/* Moving a pin is a geocoding job, not a text field, and the two
                columns that place a listing on the map are not in the update
                grant. Say who to ask rather than showing a dead input. */}
            <p className="acct-fine">{t('account.locationNote')}</p>
        </form>
    );
}
