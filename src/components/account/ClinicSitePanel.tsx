import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { supabase } from '../../lib/supabase';
import { downscale, validateImageFile, ACCEPTED_IMAGE_TYPES } from '../../utils/imageResize';
import { clinicPublicUrl, uploadClinicFile } from './uploadWithProgress';
import { useToast } from './toastContext';
import { SiteBriefForm, type BriefContent } from './SiteBriefForm';
import { SiteKnown } from './SiteKnown';

type Loc = Partial<Record<'es' | 'en', string>>;
interface StoryItem { src: string; title?: Loc; caption?: Loc }
interface SiteImages { hero?: string; story?: StoryItem[]; more?: unknown[] }
interface Found { accent?: string; ink?: string; warm?: string; logo?: string; images: string[] }
interface Brand { bg?: string; soft?: string; accent?: string; ink?: string; warm?: string; logo?: string }
export interface SiteRow {
    subdomain: string;
    status: 'preview' | 'active' | 'suspended';
    content: ({
        headline?: Loc; lead?: Loc; about?: Loc; brand?: Brand; images?: SiteImages;
    } & BriefContent) | null;
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
export function ClinicSitePanel({ clinic, site, onSaved, onEditProfile }: { clinic: Provider; site: SiteRow; onSaved: () => void; onEditProfile: (field: string) => void }) {
    const { t, i18n } = useTranslation();
    const toast = useToast();
    const lang: 'es' | 'en' = i18n.language?.startsWith('es') ? 'es' : 'en';
    const c = site.content ?? {};
    // Show what the site shows: the owner's language, else whichever one was written.
    const seen = (v: Loc | undefined) => v?.[lang] ?? v?.es ?? v?.en ?? '';

    const [accent, setAccent] = useState(c.brand?.accent ?? '#1f5a8a');
    const [ink, setInk] = useState(c.brand?.ink ?? '#14181d');
    const [warm, setWarm] = useState(c.brand?.warm ?? '');
    const [logo, setLogo] = useState(c.brand?.logo ?? '');
    const [headline, setHeadline] = useState(seen(c.headline));
    const [lead, setLead] = useState(seen(c.lead));
    const [about, setAbout] = useState(seen(c.about));
    const [story, setStory] = useState<StoryItem[]>(c.images?.story ?? []);
    const [hero, setHero] = useState(c.images?.hero ?? '');
    const [busy, setBusy] = useState<'save' | 'photo' | 'logo' | null>(null);
    // First visit with a website on the listing and nothing chosen yet: look at the website straight away.
    const autoRead = !!clinic.website && !c.brand?.accent && !c.images?.story?.length;
    const [reading, setReading] = useState(autoRead);
    const [found, setFound] = useState<Found | null>(null);
    const [grabNote, setGrabNote] = useState<string | null>(null);
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

    /** Asks the server to read the website on the listing. Suggestions only: nothing is applied or saved. */
    const fetchFound = async (): Promise<{ found?: Found; note?: string; error?: string }> => {
        if (!supabase) return {};
        try {
            const { data: sess } = await supabase.auth.getSession();
            const token = sess.session?.access_token;
            if (!token) return { error: t('account.site.grab.signIn') };
            const r = await fetch('/api/agent?route=site-grab', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ provider_id: clinic.id }),
            });
            const j = (await r.json().catch(() => null)) as { found?: Found | null; reason?: string; error?: { message?: string } } | null;
            if (!r.ok) return { error: j?.error?.message ?? t('account.site.grab.failed') };
            if (!j?.found) return { note: t(j?.reason === 'no_website' ? 'account.site.grab.noSite' : 'account.site.grab.unreachable') };
            const f = j.found;
            if (!f.accent && !f.logo && !f.images.length) return { note: t('account.site.grab.none') };
            return { found: f };
        } catch {
            return { error: t('account.site.grab.failed') };
        }
    };
    const readWebsite = async () => {
        setError(null); setGrabNote(null); setFound(null); setReading(true);
        const res = await fetchFound();
        if (res.error) setError(res.error); else if (res.note) setGrabNote(res.note); else if (res.found) setFound(res.found);
        setReading(false);
    };
    useEffect(() => {
        if (!autoRead) return;
        let live = true;
        void fetchFound().then((res) => {
            if (!live) return;
            if (res.found) setFound(res.found);
            setReading(false);
        });
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const useColours = () => {
        if (!found) return;
        if (found.accent && HEX.test(found.accent)) setAccent(found.accent);
        if (found.ink && HEX.test(found.ink)) setInk(found.ink);
        if (found.warm && HEX.test(found.warm)) setWarm(found.warm);
    };
    const addFound = (src: string) => {
        if (story.length >= MAX_STORY || story.some((x) => x.src === src)) return;
        setStory((s) => [...s, { src }]);
        if (!hero) setHero(src);
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

            <SiteKnown clinic={clinic} onEdit={onEditProfile} suggesting={reading} found={!!found} />

            <SiteBriefForm clinic={clinic} content={c} onSaved={onSaved} onEditProfile={onEditProfile} />

            <section className="acct-card">
                <h2 className="acct-card-title">{t('account.site.brand')}</h2>
                <p className="acct-muted">{t('account.site.brandHint')}</p>
                <div className="acct-row">
                    <button type="button" className="acct-btn acct-btn--ghost" disabled={reading || busy !== null} onClick={() => void readWebsite()}>
                        {reading ? t('account.site.grab.reading') : t('account.site.grab.read')}
                    </button>
                    <span className="acct-fine">{t('account.site.grab.hint')}</span>
                </div>
                {grabNote && <p className="acct-muted" role="status">{grabNote}</p>}
                {found && (
                    <div className="acct-field" aria-live="polite">
                        <strong>{t('account.site.grab.title')}</strong>
                        {(found.accent || found.ink) && (
                            <div className="acct-row">
                                {[found.accent, found.ink, found.warm].filter((x): x is string => !!x).map((x) => (
                                    <span key={x} title={x} style={{ width: 28, height: 28, borderRadius: 6, background: x, border: '1px solid rgba(0,0,0,.2)', display: 'inline-block' }} />
                                ))}
                                <button type="button" className="acct-btn acct-btn--sm" onClick={useColours}>{t('account.site.grab.colours')}</button>
                            </div>
                        )}
                        {found.logo && (
                            <div className="acct-row">
                                <img src={found.logo} alt="" referrerPolicy="no-referrer" style={{ maxHeight: 40, maxWidth: 200, objectFit: 'contain', background: '#fff', borderRadius: 8, padding: 6 }} />
                                <button type="button" className="acct-btn acct-btn--sm" onClick={() => setLogo(found.logo!)}>{t('account.site.grab.logo')}</button>
                            </div>
                        )}
                        {found.images.length > 0 && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}>
                                {found.images.map((src) => {
                                    const taken = story.some((x) => x.src === src);
                                    return (
                                        <div key={src} style={{ display: 'grid', gap: 4 }}>
                                            <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 8 }} />
                                            <button type="button" className="acct-btn acct-btn--sm acct-btn--ghost" disabled={taken || story.length >= MAX_STORY} onClick={() => addFound(src)}>
                                                {taken ? t('account.site.grab.added') : t('account.site.grab.addPhoto')}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        <p className="acct-fine">{t('account.site.grab.note')}</p>
                    </div>
                )}
                <div className="acct-grid2">
                    <div className="acct-field"><label htmlFor="site-accent">{t('account.site.accent')}</label>
                        <input id="site-accent" className="acct-color" type="color" value={HEX.test(accent) ? accent : '#000000'} onChange={(e) => setAccent(e.target.value)} /></div>
                    <div className="acct-field"><label htmlFor="site-ink">{t('account.site.ink')}</label>
                        <input id="site-ink" className="acct-color" type="color" value={HEX.test(ink) ? ink : '#000000'} onChange={(e) => setInk(e.target.value)} /></div>
                    <div className="acct-field"><label htmlFor="site-warm">{t('account.site.warm')}</label>
                        <input id="site-warm" className="acct-color" type="color" value={HEX.test(warm) ? warm : '#dd7d30'} onChange={(e) => setWarm(e.target.value)} />
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
                                    value={seen(s.title)} onChange={(e) => setCaption(i, 'title', e.target.value)} />
                                <input aria-label={t('account.site.photoCaption')} placeholder={t('account.site.photoCaption')} maxLength={200}
                                    value={seen(s.caption)} onChange={(e) => setCaption(i, 'caption', e.target.value)} />
                                <div className="acct-row">
                                    <button type="button" className="acct-link" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                                    <button type="button" className="acct-link" disabled={i === story.length - 1} onClick={() => move(i, 1)}>↓</button>
                                    <label className="acct-fine" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="radio" style={{ width: 'auto', margin: 0 }} name="site-hero" checked={hero === s.src} onChange={() => setHero(s.src)} /> {t('account.site.cover')}</label>
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
