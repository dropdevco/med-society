import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AC, AC_CENTERS, AC_EMAIL, AC_WHATSAPP } from '../components/acerbac/content';
import { directoryUrl } from '../utils/hostSite';
import type { AcLang } from '../components/acerbac/content';
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

const todo = (s: string) => (s.includes('TODO(acerbac)') ? <p className="ac-todo">{s}</p> : null);

/**
 * /acerbac — site for the Asociación de Centros de Recuperación de Baja
 * California (Tijuana). Own chrome (no MedSociety nav/footer, see App.tsx),
 * Spanish first, noindex until ACERBAC confirms the copy in content.ts.
 */
export function AcerbacPage() {
    const { i18n } = useTranslation();
    const [lang, setLang] = useState<AcLang>(initialLang);
    const c = AC[lang];

    useEffect(() => {
        const prev = document.title;
        const meta = document.createElement('meta');
        meta.name = 'robots';
        meta.content = 'noindex';
        document.head.appendChild(meta);
        return () => { meta.remove(); document.title = prev; };
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
                        <a href="#contacto">{c.nav.contact}</a>
                    </nav>
                    <div className="ac-lang" role="group" aria-label="Idioma / Language">
                        {(['es', 'en'] as AcLang[]).map((l) => (
                            <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                                {l.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main id="main-content">
                <section className="ac-hero" id="top">
                    <div className="ac-wrap ac-hero-grid">
                        <div className="ac-hero-copy">
                            <span className="ac-eyebrow">{c.hero.eyebrow}</span>
                            <h1>{c.hero.h1}</h1>
                            <p className="ac-lead">{c.hero.lead}</p>
                            <div className="ac-cta">
                                <a className="ac-btn" href="#centros">{c.hero.ctaFind}<Arrow /></a>
                                <a className="ac-btn ghost" href="#afiliate">{c.hero.ctaJoin}</a>
                            </div>
                        </div>
                        <div className="ac-arch">
                            <div className="ac-arch-bg">
                                <svg viewBox="0 0 400 500" fill="none" stroke="#9fe0c8" strokeWidth="1" aria-hidden="true">
                                    {[60, 110, 160, 210, 260].map((r) => <circle key={r} cx="200" cy="250" r={r} />)}
                                    <path d="M200 170v160M120 250h160" strokeWidth="2" />
                                </svg>
                            </div>
                            <div className="ac-float ac-bezel">
                                <div className="ac-core">
                                    <h3>{c.hero.cardH}</h3>
                                    <ul>{c.hero.cardItems.map((i) => <li key={i}>{i}</li>)}</ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="ac-wrap">
                    <div className="ac-trust ac-rv">
                        {c.trust.map((t) => (
                            <div key={t.n}><strong>{t.n}</strong><span>{t.label}</span></div>
                        ))}
                    </div>
                </div>

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
                            {AC_CENTERS.map((ce) => {
                                const href = ce.providerId ? directoryUrl(`/providers/${ce.providerId}`) : null;
                                const body = (
                                    <>
                                        <div className="ac-photo">
                                            {ce.photo
                                                ? <img src={ce.photo} alt={ce.name} loading="lazy" />
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
                                    <li className="ac-bezel ac-rv" key={ce.name}>
                                        {href
                                            ? <a className="ac-core ac-center" href={href}>{body}</a>
                                            : <div className="ac-core ac-center">{body}</div>}
                                    </li>
                                );
                            })}
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
                                            {s.p.includes('TODO(acerbac)') ? todo(s.p) : <p>{s.p}</p>}
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
                            <li><a href={mail}>{AC_EMAIL}</a></li>
                        </ul>
                    </div>
                </section>
            </main>

            <footer className="ac-foot">
                <div className="ac-wrap">
                    <div>{c.foot.legal} · {c.foot.privacy}</div>
                    <div className="ac-todo">{c.foot.draft}</div>
                </div>
            </footer>

            <div className="ac-sticky"><a className="ac-btn" href="#afiliate">{c.hero.ctaJoin}<Arrow /></a></div>
        </div>
    );
}
