import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AC, AC_CENTERS, AC_EMAIL, AC_PHONE, AC_WHATSAPP } from '../components/acerbac/content';
import { useGooglePhotos } from '../hooks/useGooglePhotos';
import { googlePhotoAttribution } from '../lib/googlePhotoAttribution';
import { directoryUrl, hostSite } from '../utils/hostSite';
import type { AcCenter, AcLang } from '../components/acerbac/content';
import '../components/acerbac/acerbac.css';

const LANG_KEY = 'ms_ac_lang';

function initialLang(): AcLang {
    try {
        const q = new URLSearchParams(window.location.search).get('lang');
        if (q === 'en' || q === 'es') return q;
        const s = localStorage.getItem(LANG_KEY);
        if (s === 'en' || s === 'es') return s;
    } catch { /* storage can be blocked */ }
    return 'es';
}

/** "Bella Recovery House" → "BR": stands in for a photo we may not publish yet. */
const monogram = (name: string) =>
    name.replace(/&/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

/**
 * TODO(acerbac) notes show only in development (`npm run dev`), so whoever
 * edits the copy sees what is still missing; the deployed page never does.
 */
const SHOW_TODOS = import.meta.env.DEV;
const isTodo = (s: string) => s.includes('TODO(acerbac)');
const todo = (s: string) => (SHOW_TODOS && isTodo(s) ? <p className="ac-todo">{s}</p> : null);

/** Fold accents and case so "bella" finds "Bella" and "alicé" finds "Alice". */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * One certified-center card. The photo comes from Google Places and is only
 * requested once the card is near the viewport; with no photo (or no place_id)
 * the card keeps its monogram. Google's attribution is shown with every photo.
 */
function CenterCard({ ce, c }: { ce: AcCenter; c: (typeof AC)[AcLang] }) {
    const ref = useRef<HTMLLIElement>(null);
    const [seen, setSeen] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || seen) return;
        if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
        const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '300px' });
        io.observe(el);
        return () => io.disconnect();
    }, [seen]);
    const { photos } = useGooglePhotos(seen && ce.placeId ? ce.placeId : undefined);
    const photo = photos[0];
    const href = ce.providerId ? directoryUrl(`/providers/${ce.providerId}`) : null;
    const body = (
        <>
            <div className="ac-photo">
                {photo
                    ? <img src={photo.url} alt={ce.name} loading="lazy" referrerPolicy="no-referrer" />
                    : <span aria-hidden="true">{monogram(ce.name)}</span>}
            </div>
            <div className="ac-center-meta">
                <strong>{ce.name}</strong>
                <span>Tijuana, B.C.</span>
                <em>{href ? `${c.centers.listing} →` : c.centers.noListing}</em>
            </div>
        </>
    );
    return (
        <li className="ac-bezel" ref={ref}>
            {href
                ? <a className="ac-core ac-center" href={href}>{body}</a>
                : <div className="ac-core ac-center">{body}</div>}
            {photo?.attributionHtml && (
                <p className="ac-credit">{c.centers.photoBy} · {googlePhotoAttribution(photo.attributionHtml)}</p>
            )}
        </li>
    );
}

/**
 * /acerbac — site for the Asociación de Centros de Recuperación de Baja
 * California (Tijuana). Own chrome (no MedSociety nav/footer, see App.tsx),
 * Spanish first, noindex until ACERBAC confirms the copy in content.ts.
 */
export function AcerbacPage() {
    const { i18n } = useTranslation();
    const [lang, setLang] = useState<AcLang>(initialLang);
    const c = AC[lang];
    const [q, setQ] = useState('');
    const showResult = fold(q).length >= 2;
    const found = showResult ? AC_CENTERS.find((ce) => fold(ce.name).includes(fold(q)) || fold(q).includes(fold(ce.name))) : undefined;

    // On acerbac.medsociety.one the static acerbac.html already carries the
    // indexable head. Reached any other way (/acerbac on the main host) this page
    // is a duplicate: keep it out of the index and point at the real one.
    useEffect(() => {
        const prev = document.title;
        const added: HTMLElement[] = [];
        if (!hostSite()) {
            const robots = document.createElement('meta');
            robots.name = 'robots'; robots.content = 'noindex';
            const canon = document.createElement('link');
            canon.rel = 'canonical'; canon.href = 'https://acerbac.medsociety.one/';
            document.head.append(robots, canon);
            added.push(robots, canon);
        }
        return () => { added.forEach((n) => n.remove()); document.title = prev; };
    }, []);

    useEffect(() => {
        document.title = c.docTitle;
        try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
        if (!(i18n.language || '').toLowerCase().startsWith(lang)) void i18n.changeLanguage(lang);
    }, [lang, c.docTitle, i18n]);

    const mail = `mailto:${AC_EMAIL}`;
    const subject = (s: string) => `${mail}?subject=${encodeURIComponent(s)}`;

    const Arrow = () => <i aria-hidden="true">→</i>;
    const eyebrowLabel: React.CSSProperties = { font: '600 .72rem/1 Geist,sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--muted)', margin: '14px 0 0' };

    return (
        <div className="ac-page" lang={lang}>
            <header className="ac-top">
                <div className="ac-top-in">
                    <a className="ac-logo" href="#top">ACERBAC</a>
                    <nav className="ac-nav" aria-label="ACERBAC">
                        <a href="#centros">{c.nav.find}</a>
                        <a href="#guia">{c.nav.guide}</a>
                        <a href="#certificacion">{c.nav.certify}</a>
                        <a href="#afiliate">{c.nav.join}</a>
                        <a href="#nosotros">{c.nav.about}</a>
                    </nav>
                    <div className="ac-top-end">
                        <div className="ac-lang" role="group" aria-label="Idioma / Language">
                            {(['es', 'en'] as AcLang[]).map((l) => (
                                <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                                    {l.toUpperCase()}
                                </button>
                            ))}
                        </div>
                        <a className="ac-top-cta" href="#contacto">{c.nav.cta}</a>
                        <details className="ac-menu">
                            <summary aria-label={c.nav.menu}><span aria-hidden="true" /></summary>
                            <div className="ac-menu-list">
                                <a href="#centros">{c.nav.find}</a>
                                <a href="#guia">{c.nav.guide}</a>
                                <a href="#certificacion">{c.nav.certify}</a>
                                <a href="#afiliate">{c.nav.join}</a>
                                <a href="#nosotros">{c.nav.about}</a>
                                <a href="#contacto">{c.nav.contact}</a>
                            </div>
                        </details>
                    </div>
                </div>
            </header>

            <main id="main-content">
                <section className="ac-hero" id="top">
                    <div className="ac-wrap">
                        <h1>{c.hero.h1}</h1>
                        <p className="ac-lead">{c.hero.lead}</p>
                        <div className="ac-cta">
                            <a className="ac-btn light" href="#centros">{c.hero.ctaFind}<Arrow /></a>
                            <a className="ac-btn ghost-dark" href="#afiliate">{c.hero.ctaJoin}</a>
                        </div>

                        <div className="ac-check">
                            <h2>{c.hero.checkH}</h2>
                            <label className="ac-check-field">
                                <span className="ac-sr">{c.hero.checkLabel}</span>
                                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={c.hero.checkPlaceholder} autoComplete="off" />
                            </label>
                            <p className={`ac-check-out ${showResult ? (found ? 'yes' : 'no') : ''}`} role="status" aria-live="polite">
                                {showResult
                                    ? (found ? <><strong>{found.name}.</strong> {c.hero.checkYes}</> : c.hero.checkNo)
                                    : <>{c.hero.checkHint} {AC_CENTERS.map((x) => x.name).join(' \u00b7 ')}</>}
                            </p>
                        </div>

                        <div className="ac-trust">
                            {c.trust.map((t) => (
                                <div key={t.n}><strong>{t.n}</strong><span>{t.label}</span></div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="ac-sec" id="centros">
                    <div className="ac-wrap">
                        <div className="ac-find ac-rv">
                            <div>
                                <span className="ac-eyebrow">{c.nav.find}</span>
                                <h2 className="ac-h2">{c.find.h}</h2>
                                <p className="ac-p">{c.find.p}</p>
                            </div>
                            <div className="ac-cta"><a className="ac-btn light" href={directoryUrl('/')}>{c.find.cta}<Arrow /></a></div>
                            {todo(c.find.note)}
                        </div>

                        <div className="ac-centers-head ac-rv">
                            <h3 className="ac-h3">{c.centers.h}</h3>
                            <p className="ac-p">{c.centers.p}</p>
                        </div>
                        <ul className="ac-centers">
                            {AC_CENTERS.map((ce) => <CenterCard key={ce.name} ce={ce} c={c} />)}
                        </ul>
                        <p className="ac-note">{c.centers.source}</p>
                        {todo(c.centers.todo)}
                    </div>
                </section>

                <section className="ac-sec" id="guia" style={{ paddingTop: 0 }}>
                    <div className="ac-wrap ac-guide">
                        <div className="ac-guide-sticky">
                            <span className="ac-eyebrow">{c.nav.guide}</span>
                            <h2 className="ac-h2">{c.guide.h}</h2>
                            <p className="ac-p">{c.guide.p}</p>
                        </div>
                        <ol className="ac-steps">
                            {c.guide.items.map((it) => (
                                <li className="ac-rv" key={it.h}><div><h3>{it.h}</h3><p>{it.p}</p></div></li>
                            ))}
                        </ol>
                    </div>
                </section>

                <section className="ac-sec" id="certificacion" style={{ paddingTop: 0 }}>
                    <div className="ac-wrap">
                        <div className="ac-cert ac-rv">
                            <span className="ac-eyebrow" style={{ background: '#fff' }}>{c.nav.certify}</span>
                            <h2 className="ac-h2">{c.certify.h}</h2>
                            <p className="ac-p">{c.certify.p}</p>
                            <div className="ac-cert-grid">
                                {c.certify.steps.map((s, i) => (
                                    <div className="ac-bezel" key={s.h}>
                                        <div className="ac-core">
                                            <span className="ac-num">{i + 1}</span>
                                            <h3>{s.h}</h3>
                                            {!isTodo(s.p) ? <p>{s.p}</p> : SHOW_TODOS ? todo(s.p) : <p>{c.certify.soon}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="ac-note">{c.certify.note}</p>
                        </div>
                    </div>
                </section>

                <section className="ac-sec" id="afiliate" style={{ paddingTop: 0 }}>
                    <div className="ac-wrap ac-join">
                        <div className="ac-rv">
                            <span className="ac-eyebrow">{c.nav.join}</span>
                            <h2 className="ac-h2">{c.join.h}</h2>
                            <p className="ac-p">{c.join.p}</p>
                            <div className="ac-cta">
                                <a className="ac-btn" href={subject(c.join.cta)}>{c.join.cta}<Arrow /></a>
                            </div>
                        </div>
                        <ul className="ac-perks ac-rv">{c.join.perks.map((p) => <li key={p}>{p}</li>)}</ul>
                    </div>
                </section>

                <section className="ac-sec" id="nosotros" style={{ paddingTop: 0 }}>
                    <div className="ac-wrap ac-about">
                        <div className="ac-rv">
                            <span className="ac-eyebrow">{c.nav.about}</span>
                            <h2 className="ac-h2">{c.about.h}</h2>
                            <p className="ac-p">{c.about.p}</p>
                            <p className="ac-who">{c.about.board}</p>
                        </div>
                        <div className="ac-rv">
                            <h3 style={eyebrowLabel}>{c.about.allies}</h3>
                            <ul className="ac-pill-list">{c.about.allyList.map((a) => <li key={a}>{a}</li>)}</ul>
                        </div>
                    </div>
                </section>

                <section className="ac-sec" style={{ paddingTop: 0 }}>
                    <div className="ac-wrap">
                        <div className="ac-bezel ac-rv">
                            <div className="ac-core ac-report">
                                <div>
                                    <h2 className="ac-h2" style={{ marginTop: 0 }}>{c.report.h}</h2>
                                    <p className="ac-p">{c.report.p}</p>
                                </div>
                                <a className="ac-btn ghost" href={subject(c.report.cta)}>{c.report.cta}</a>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="ac-sec" id="contacto" style={{ paddingTop: 0 }}>
                    <div className="ac-wrap ac-contact ac-rv">
                        <span className="ac-eyebrow">{c.nav.contact}</span>
                        <h2 className="ac-h2">{c.contact.h}</h2>
                        <p className="ac-p">{c.contact.p}</p>
                        <ul>
                            {AC_WHATSAPP && <li>{c.contact.whatsapp}: <a href={`https://wa.me/${AC_WHATSAPP}`}>+{AC_WHATSAPP}</a></li>}
                            {AC_PHONE && <li>{c.contact.phone}: <a href={`tel:${AC_PHONE.replace(/[^+\d]/g, '')}`}>{AC_PHONE}</a></li>}
                            {AC_EMAIL && <li><a href={mail}>{AC_EMAIL}</a></li>}
                        </ul>
                    </div>
                </section>
            </main>

            <footer className="ac-foot">
                <div className="ac-wrap">
                    <div>{c.foot.legal} · {c.foot.privacy}</div>
                    {SHOW_TODOS && <div className="ac-todo">{c.foot.draft}</div>}
                </div>
            </footer>

            <div className="ac-sticky"><a className="ac-btn" href="#afiliate">{c.hero.ctaJoin}<Arrow /></a></div>
        </div>
    );
}
