import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { downscale, validateImageFile, ACCEPTED_IMAGE_TYPES } from '../../utils/imageResize';
import { clinicPublicUrl, uploadClinicFile } from './uploadWithProgress';
import { useToast } from './toastContext';

type Loc = Partial<Record<'es' | 'en', string>>;
interface StoryItem { src: string; title?: Loc; caption?: Loc }
interface SiteImages { hero?: string; story?: StoryItem[]; more?: unknown[] }
interface Brand { bg?: string; soft?: string; accent?: string; ink?: string; warm?: string; logo?: string }
export interface SiteRow {
    subdomain: string;
    status: 'preview' | 'active' | 'suspended';
    content: {
        headline?: Loc; lead?: Loc; about?: Loc; brand?: Brand; images?: SiteImages;
    } | null;
}

const SITE_ROOT = 'medsociety.one';
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_STORY = 8;

/** Mix a #rrggbb colour with white: how a brand colour becomes a quiet page background. */
function tint(hex: string, amount: number): string {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c: number) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
    return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

/**
 * The owner's say over their own website: colours, logo, photos in the order a
 * visitor walks through, and the three lines of copy that matter most.
 *
 * Saving goes through the `update_my_site` function (migration 0036), which
 * accepts only these fields. The site stays a preview until the team publishes
 * it, so nothing here can put a page in front of patients by accident.
 */
export function ClinicSitePanel({ clinic, site, onSaved }: { clinic: Provider; site: SiteRow; onSaved: () => void }) {
    const { t, i18n } = useTranslation();
    const toast = useToast();
    const lang: 'es' | 'en' = i18n.language?.startsWith('es') ? 'es' : 'en';
    const c = site.content ?? {};

    const [accent, setAccent] = useState(c.brand?.accent ?? '#1f5a8a');
    const [ink, setInk] = useState(c.brand?.ink ?? '#14181d');
    const [warm, setWarm] = useState(c.brand?.warm ?? '');
    const [logo, setLogo] = useState(c.brand?.logo ?? '');
    const [headline, setHeadline] = useState(c.headline?.[lang] ?? '');
    const [lead, setLead] = useState(c.lead?.[lang] ?? '');
    const [about, setAbout] = useState(c.about?.[lang] ?? '');
    const [story, setStory] = useState<StoryItem[]>(c.images?.story ?? []);
    const [hero, setHero] = useState(c.images?.hero ?? '');
    const [busy, setBusy] = useState<'save' | 'photo' | 'logo' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);
    const logoRef = useRef<HTMLInputElement>(null);

    const upload = async (file: File, maxEdge: number): Promise<string | null> => {
        const v = validateImageFile(file);
        if (v !== 'ok') { setError(t(v === 'type' ? 'account.site.errType' : 'account.site.errSize')); return null; }
        const img = await downscale(file, maxEdge);
        const path = `${clinic.id}/site/${crypto.randomUUID()}.${img.ext}`;
        const up = await uploadClinicFile(path, img.blob, img.contentType);
        if (up.error) { setError(up.error); return null; }
        return clinicPublicUrl(path);
    };

    const addPhotos = async (files: FileList | null) => {
        if (!files?.length) return;
        setError(null); setBusy('photo');
        const added: StoryItem[] = [];
        for (const f of Array.from(files).slice(0, MAX_STORY - story.length)) {
            const src = await upload(f, 1800);
            if (src) added.push({ src });
        }
        setStory((s) => [...s, ...added]);
        if (!hero && added[0]) setHero(added[0].src);
        setBusy(null);
        if (fileRef.current) fileRef.current.value = '';
    };

    const addLogo = async (files: FileList | null) => {
        const f = files?.[0];
        if (!f) return;
        setError(null); setBusy('logo');
        const src = await upload(f, 800);
        if (src) setLogo(src);
        setBusy(null);
        if (logoRef.current) logoRef.current.value = '';
    };

    const move = (i: number, d: -1 | 1) => setStory((s) => {
        const j = i + d;
        if (j < 0 || j >= s.length) return s;
        const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n;
    });
    const setCaption = (i: number, key: 'title' | 'caption', v: string) =>
        setStory((s) => s.map((it, k) => (k === i ? { ...it, [key]: { ...it[key], [lang]: v } } : it)));
    const remove = (i: number) => {
        const gone = story[i];
        setStory((s) => s.filter((_, k) => k !== i));
        if (gone && hero === gone.src) setHero('');
    };

    const save = async () => {
        if (!supabase) return;
        setError(null); setBusy('save');
        const withLang = (old: Loc | undefined, v: string): Loc => ({ ...old, [lang]: v.trim() });
        const brand: Brand = { ...c.brand };
        if (HEX.test(accent)) { brand.accent = accent; brand.bg = tint(accent, 0.96); brand.soft = tint(accent, 0.88); }
        if (HEX.test(ink)) brand.ink = ink;
        if (HEX.test(warm)) brand.warm = warm; else delete brand.warm;
        if (logo) brand.logo = logo; else delete brand.logo;
        const patch: Record<string, unknown> = {
            brand,
            images: { ...c.images, hero: hero || undefined, story },
        };
        if (headline.trim()) patch.headline = withLang(c.headline, headline);
        if (lead.trim()) patch.lead = withLang(c.lead, lead);
        if (about.trim()) patch.about = withLang(c.about, about);
        const { error: err } = await supabase.rpc('update_my_site', { target: clinic.id, patch });
        setBusy(null);
        if (err) { setError(err.message); return; }
        toast(t('account.site.saved'));
        onSaved();
    };

    const url = `https://${site.subdomain}.${SITE_ROOT}`;

    return (
        <div className="acct-form">
            <section className="acct-card">
                <div className="acct-card-head">
                    <h2 className="acct-card-title">{t('account.site.title')}</h2>
                    <span className="acct-pill">{t(`account.site.status.${site.status}`)}</span>
                </div>
                <p className="acct-muted">{t('account.site.intro')}</p>
                <p className="acct-row"><a href={url} target="_blank" rel="noreferrer" className="acct-link">{url}</a></p>
            </section>

            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.brand')}</h2>
                <p className="acct-muted">{t('account.site.brandHint')}</p>
                <div className="acct-grid2">
                    <div className="acct-field"><label htmlFor="site-accent">{t('account.site.accent')}</label>
                        <input id="site-accent" type="color" value={HEX.test(accent) ? accent : '#000000'} onChange={(e) => setAccent(e.target.value)} /></div>
                    <div className="acct-field"><label htmlFor="site-ink">{t('account.site.ink')}</label>
                        <input id="site-ink" type="color" value={HEX.test(ink) ? ink : '#000000'} onChange={(e) => setInk(e.target.value)} /></div>
                    <div className="acct-field"><label htmlFor="site-warm">{t('account.site.warm')}</label>
                        <input id="site-warm" type="color" value={HEX.test(warm) ? warm : '#dd7d30'} onChange={(e) => setWarm(e.target.value)} />
                        {warm && <button type="button" className="acct-link" onClick={() => setWarm('')}>{t('account.site.clear')}</button>}</div>
                </div>
                <div className="acct-field">
                    <label htmlFor="site-logo">{t('account.site.logo')}</label>
                    {logo && <img src={logo} alt="" style={{ maxHeight: 48, maxWidth: 240, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 6 }} />}
                    <input id="site-logo" ref={logoRef} type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={busy !== null} onChange={(e) => void addLogo(e.target.files)} />
                    {logo && <button type="button" className="acct-link acct-link--danger" onClick={() => setLogo('')}>{t('account.site.remove')}</button>}
                </div>
            </section>

            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.photos')}</h2>
                <p className="acct-muted">{t('account.site.photosHint')}</p>
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.9rem' }}>
                    {story.map((s, i) => (
                        <li key={s.src} className="acct-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                            <img src={s.src} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10, flex: 'none' }} />
                            <div className="acct-field" style={{ flex: 1, minWidth: 0 }}>
                                <input aria-label={t('account.site.photoTitle')} placeholder={t('account.site.photoTitle')} maxLength={70}
                                    value={s.title?.[lang] ?? ''} onChange={(e) => setCaption(i, 'title', e.target.value)} />
                                <input aria-label={t('account.site.photoCaption')} placeholder={t('account.site.photoCaption')} maxLength={200}
                                    value={s.caption?.[lang] ?? ''} onChange={(e) => setCaption(i, 'caption', e.target.value)} />
                                <div className="acct-row">
                                    <button type="button" className="acct-link" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                                    <button type="button" className="acct-link" disabled={i === story.length - 1} onClick={() => move(i, 1)}>↓</button>
                                    <label className="acct-fine"><input type="radio" name="site-hero" checked={hero === s.src} onChange={() => setHero(s.src)} /> {t('account.site.cover')}</label>
                                    <button type="button" className="acct-link acct-link--danger" onClick={() => remove(i)}>{t('account.site.remove')}</button>
                                </div>
                            </div>
                        </li>
                    ))}
                </ol>
                {story.length < MAX_STORY && (
                    <div className="acct-field">
                        <input ref={fileRef} type="file" multiple accept={ACCEPTED_IMAGE_TYPES.join(',')} disabled={busy !== null} onChange={(e) => void addPhotos(e.target.files)} />
                        <p className="acct-hint">{busy === 'photo' ? t('account.site.uploading') : t('account.site.photosLimit', { count: MAX_STORY })}</p>
                    </div>
                )}
            </section>

            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.words')}</h2>
                <p className="acct-muted">{t('account.site.wordsHint')}</p>
                <div className="acct-field"><label htmlFor="site-headline">{t('account.site.headline')}</label>
                    <input id="site-headline" maxLength={140} value={headline} onChange={(e) => setHeadline(e.target.value)} /></div>
                <div className="acct-field"><label htmlFor="site-lead">{t('account.site.lead')}</label>
                    <input id="site-lead" maxLength={220} value={lead} onChange={(e) => setLead(e.target.value)} /></div>
                <div className="acct-field"><label htmlFor="site-about">{t('account.site.about')}</label>
                    <textarea id="site-about" rows={5} maxLength={1500} value={about} onChange={(e) => setAbout(e.target.value)} /></div>
            </section>

            {error && <p className="acct-msg acct-msg--error acct-msg--block" role="alert">{error}</p>}
            <div className="acct-row">
                <button type="button" className="acct-btn" disabled={busy !== null} onClick={() => void save()}>
                    {busy === 'save' ? t('account.site.saving') : t('account.site.save')}
                </button>
                <a href={url} target="_blank" rel="noreferrer" className="acct-btn acct-btn--ghost">{t('account.site.preview')}</a>
            </div>
            <p className="acct-fine">{t('account.site.reviewNote')}</p>
        </div>
    );
}
