import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { track } from '../lib/posthog';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { readSavedMarket, saveChosenMarket, marketForLanguage, type Market } from '../lib/billing';
import { InquiryModal } from '../components/sales/InquiryModal';
import { CurrencyPicker } from '../components/account/CurrencyPicker';
import { LogoMark } from '../components/brand/Logo';
import {
    IconArrowRight, IconViews, IconStar,
    IconClipboard, IconMapPlane, IconChart, IconCheck, IconPromoted,
    IconUS, IconMX, IconShield, IconLanguage,
} from '../components/icons/Icons';

/**
 * The services sold alongside a listing.
 *
 * Copy lives in the locale files under `pricing.addon.<key>`; only the key and
 * the icon live here, so adding a service is a translation change plus one row
 * rather than a new block of JSX. Order is deliberate: the two that convert a
 * listing into bookings come first, because they are what a clinic is actually
 * trying to buy when it asks what a listing costs.
 */
const ADDONS = [
    { key: 'whatsapp', icon: <IconClipboard size={19} weight={1.8} /> },
    { key: 'payments', icon: <IconChart size={19} weight={1.8} /> },
    { key: 'reminders', icon: <IconViews size={19} weight={1.8} /> },
    { key: 'seo', icon: <IconStar size={19} weight={1.8} /> },
] as const;

/**
 * The four border cities the directory covers, west to east: two crossings,
 * each with a US and a Mexican side. Copy lives under `sales.city<Key>*`.
 */
const CITIES = [
    { key: 'Tijuana', country: 'mx' },
    { key: 'Juarez', country: 'mx' },
] as const;

export function PricingPage() {
    const { t, i18n } = useTranslation();
    useDocumentTitle(t('pricing.pageTitle'), { description: t('pricing.pageDescription') });
    const [modalPlan, setModalPlan] = useState<string | null>(null);

    // Clinics choose USD or MXN (the four Stripe prices, see api/billing.ts),
    // defaulting to the site language. The price shown has to be the price
    // charged, so the page quotes the selected currency and shows the USD
    // figure as a note when MXN is selected.
    const isEnglish = i18n.language.startsWith('en');
    const [chosenMarket, setChosenMarket] = useState<Market | null>(() => readSavedMarket());
    const market = chosenMarket ?? marketForLanguage(i18n.language);

    const handleMarketChange = (newMarket: Market) => {
        setChosenMarket(newMarket);
        saveChosenMarket(newMarket);
    };

    const navigate = useNavigate();

    // "Get listed free" is onboarding, not a contact form: it goes to the same
    // survey-then-claim/publish flow a doctor gets at /borderhealth, so what
    // they answer builds their listing. Paid plans and add-ons are sales
    // inquiries and keep the modal. The two monthly plans are self-serve: a plan
    // belongs to a listing, so the buyer goes to that listing's Plan tab (signing
    // in, or claiming a listing, on the way) where the payment page opens.
    const FREE_ENTRIES = ['hero', 'free', 'closing'];
    const openForm = (plan: string) => {
        track('pricing_cta_click', { plan });
        if (FREE_ENTRIES.includes(plan)) navigate('/borderhealth?seg=provider&by=listing');
        else if (plan === 'promoted' || plan === 'featured') navigate(`/dashboard?tab=plan&buy=${plan}`);
        else setModalPlan(plan);
    };
    const closeForm = () => setModalPlan(null);

    return (
        <main id="main-content" style={{ paddingTop: 68 }}>
            {/* ══ Hero ══════════════════════════════════════════════
                Full-bleed photo carousel of Tijuana and Ciudad Juárez, the
                two cities clinics on this page practise in, with the pitch
                set over a dark gradient. Text colours are fixed rather than
                themed because they always sit on a photo.
                ═══════════════════════════════════════════════════════ */}
            <section
                className="sales-hero"
                style={{
                    position: 'relative',
                    overflow: 'hidden',
                    background: '#0d1117',
                    color: '#fff',
                    minHeight: 'min(760px, calc(100svh - 68px))',
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <HeroCarousel />

                <div
                    style={{
                        position: 'relative', zIndex: 2,
                        width: '100%', maxWidth: 1180, margin: '0 auto',
                        padding: '5.5rem 1.5rem 6.5rem',
                    }}
                    className="sales-hero-inner"
                >
                    <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
                        <h1
                            className="display"
                            style={{
                                fontSize: 'clamp(2.6rem, 5.4vw, 4.4rem)', margin: '0 0 1.35rem', lineHeight: 1.04,
                                color: '#fff', textShadow: '0 2px 24px rgba(0,0,0,0.35)',
                            }}
                        >
                            {t('sales.heroTitle')}{' '}
                            <em style={{ color: HERO_ACCENT, fontStyle: 'italic', display: 'block' }}>
                                {t('sales.heroTitleHighlight')}
                            </em>
                        </h1>

                        <p
                            style={{
                                fontSize: '1.15rem',
                                color: 'rgba(255,255,255,0.86)',
                                lineHeight: 1.65,
                                maxWidth: 600,
                                margin: '0 auto 2.25rem',
                            }}
                        >
                            {t('sales.heroSubtitle')}
                        </p>

                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <PrimaryCta onClick={() => openForm('hero')}>
                                {t('sales.heroCtaPrimary')}
                            </PrimaryCta>
                            {/* Secondary CTA jumps to the plans on this page: a clinic
                                that is not ready to sign up wants the price next, not
                                the patient directory. */}
                            <a
                                href="#pricing"
                                className="press"
                                onClick={() => track('pricing_cta_click', { plan: 'hero-see-plans' })}
                                style={{
                                    display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                    padding: '0.95rem 1.75rem', borderRadius: 'var(--radius-pill)',
                                    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.35)',
                                    backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
                                    color: '#fff', fontWeight: 700, fontSize: '0.98rem',
                                }}
                            >
                                {t('sales.heroCtaSecondary')}
                            </a>
                        </div>

                        <div
                            style={{
                                display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.5rem', justifyContent: 'center',
                                maxWidth: 600, margin: '2.5rem auto 0', paddingTop: '1.6rem',
                                borderTop: '1px solid rgba(255,255,255,0.22)',
                            }}
                        >
                            <TrustPoint light icon={<IconShield size={17} />} label={t('sales.trustVerified')} />
                            <TrustPoint light icon={<IconLanguage size={17} />} label={t('sales.trustBilingual')} />
                            <TrustPoint light icon={<IconUS size={17} />} label={t('sales.trustBorder')} />
                        </div>
                    </div>
                </div>
            </section>

            {/* ══ Pricing ════════════════════════════════════════════
                Second section on the page, right after the hero — pricing is
                the thing a clinic clicks through for, so it should not be
                buried below stats/how-it-works/coverage. No top border of its
                own: the hero's borderBottom already delineates it.
                ═══════════════════════════════════════════════════════ */}
            <section id="pricing" style={{ padding: '6.5rem 1.5rem', scrollMarginTop: '90px' }}>
                <Reveal>
                    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
                        <SectionHead centered eyebrow={t('sales.pricingEyebrow')} title={t('sales.pricingTitle')} body={t('sales.pricingSubtitle')} />

                        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
                            <CurrencyPicker value={market} onChange={handleMarketChange} />
                        </div>

                        <div
                            className="plan-grid"
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                alignItems: 'stretch',
                                gap: '1.5rem',
                                paddingTop: '0.9rem',
                            }}
                        >
                            <PricingCard
                                tagline={t('pricing.basicTagline')}
                                tier={t('pricing.basicTier')}
                                price="$0"
                                period={t('pricing.basicPeriod')}
                                features={[t('pricing.basicF1'), t('pricing.basicF2'), t('pricing.basicF3'), t('pricing.basicF4'), t('pricing.basicF5')]}
                                ctaLabel={t('pricing.basicCta')}
                                onCta={() => openForm('free')}
                            />
                            <PricingCard
                                featured
                                tagline={t('pricing.promotedTagline')}
                                tier={t('pricing.promotedTier')}
                                price={market === 'us' ? '$49' : '$899'}
                                period={market === 'us' ? t('pricing.perMonthUsd') : t('pricing.perMonthMxn')}
                                note={market === 'us' ? undefined : t('pricing.promotedAlt')}
                                badge={t('pricing.promotedBadge')}
                                features={[t('pricing.promotedF1'), t('pricing.promotedF2'), t('pricing.promotedF3'), t('pricing.promotedF4')]}
                                ctaLabel={t('pricing.promotedCta')}
                                onCta={() => openForm('promoted')}
                            />
                            <PricingCard
                                premium
                                tagline={t('pricing.featuredTagline')}
                                tier={t('pricing.featuredTier')}
                                price={market === 'us' ? '$99' : '$1,799'}
                                period={market === 'us' ? t('pricing.perMonthUsd') : t('pricing.perMonthMxn')}
                                note={market === 'us' ? undefined : t('pricing.featuredAlt')}
                                features={[t('pricing.featuredF1'), t('pricing.featuredWebsite'), t('pricing.featuredF2'), t('pricing.featuredF3'), t('pricing.featuredF4')]}
                                ctaLabel={t('pricing.featuredCta')}
                                onCta={() => openForm('featured')}
                            />
                        </div>

                        <p
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                marginTop: '2.25rem', fontSize: '0.92rem', color: 'var(--gray-400)',
                            }}
                        >
                            <span style={{ color: 'var(--gold)', display: 'flex' }}><IconShield size={16} /></span>
                            {t('pricing.terms')}
                        </p>
                    </div>
                </Reveal>
            </section>

            {/* == Add-ons ============================================
                Everything above is placement. This is the work, and it is
                where most of the revenue actually is, so it gets a section
                rather than a footnote. Priced "from": every one of these is
                scoped per clinic.
                ======================================================= */}
            <section style={{ padding: '0 1.5rem 6.5rem' }}>
                <Reveal>
                    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
                        <SectionHead
                            centered
                            eyebrow={t('pricing.addonsEyebrow')}
                            title={t('pricing.addonsTitle')}
                            body={t('pricing.addonsSubtitle')}
                        />

                        {/* Four add-ons (the website moved into the Featured plan):
                            a 2×2 grid, one column on phones. */}
                        <style>{`
                                .addon-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1.25rem; }
                                @media (max-width: 640px) {
                                    .addon-grid { grid-template-columns: minmax(0, 1fr); }
                                }
                            `}</style>
                        <div className="addon-grid">
                            {ADDONS.map((addon) => (
                                <AddonCard
                                    key={addon.key}
                                    icon={addon.icon}
                                    title={t('pricing.addon.' + addon.key + '.title')}
                                    price={t('pricing.addon.' + addon.key + '.price')}
                                    priceMxn={isEnglish ? undefined : t('pricing.addon.' + addon.key + '.priceMxn')}
                                    body={t('pricing.addon.' + addon.key + '.body')}
                                    ctaLabel={t('pricing.addonCta')}
                                    onCta={() => openForm('addon-' + addon.key)}
                                />
                            ))}
                        </div>
                    </div>
                </Reveal>
            </section>

            {/* ══ How it works ═══════════════════════════════════════ */}
            <section style={{ padding: '6.5rem 1.5rem' }}>
                <Reveal>
                    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
                        <SectionHead eyebrow={t('sales.howEyebrow')} title={t('sales.howTitle')} body={t('sales.howSubtitle')} />
                        <div
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fit, minmax(270px, 1fr))',
                                gap: '1.35rem',
                            }}
                        >
                            <StepCard step="01" icon={<IconClipboard size={26} />} title={t('sales.step1Title')} body={t('sales.step1Body')} />
                            <StepCard step="02" icon={<IconMapPlane size={26} />} title={t('sales.step2Title')} body={t('sales.step2Body')} />
                            <StepCard step="03" icon={<IconChart size={26} />} title={t('sales.step3Title')} body={t('sales.step3Body')} />
                        </div>
                    </div>
                </Reveal>
            </section>

            {/* ══ Coverage ═══════════════════════════════════════════
                Two crossings, four cities. A fixed two-column grid so each
                row is one crossing (US city beside its Mexican neighbour);
                collapses to one column on phones.
                ═══════════════════════════════════════════════════════ */}
            <section style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
                <Reveal>
                    <div
                        style={{
                            maxWidth: 1080, margin: '0 auto', padding: '5rem 1.5rem',
                            display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1.35rem',
                        }}
                        className="sales-city-grid"
                    >
                        {CITIES.map((c) => (
                            <CityCard
                                key={c.key}
                                icon={<IconMX size={22} />}
                                accent="var(--mx)"
                                city={t(`sales.city${c.key}`)}
                                region={t(`sales.city${c.key}Region`)}
                                body={t(`sales.city${c.key}Body`)}
                            />
                        ))}
                    </div>
                </Reveal>
            </section>

            {/* ══ Closing CTA ════════════════════════════════════════ */}
            <section
                style={{
                    padding: '5.5rem 1.5rem',
                    background: 'var(--brand)',
                    color: 'var(--on-brand)',
                }}
            >
                <Reveal>
                    <div style={{ maxWidth: 660, margin: '0 auto', textAlign: 'center' }}>
                        <LogoMark size={46} idle />
                        <h2
                            className="display"
                            style={{ fontSize: 'clamp(2rem, 4.4vw, 2.9rem)', margin: '1.35rem 0 0.9rem', color: 'inherit' }}
                        >
                            {t('sales.ctaBannerTitle')}
                        </h2>
                        <p style={{ opacity: 0.82, marginBottom: '2.25rem', fontSize: '1.05rem', lineHeight: 1.65 }}>
                            {t('sales.ctaBannerSubtitle')}
                        </p>
                        <button
                            onClick={() => openForm('closing')}
                            className="press"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                                padding: '1rem 2.1rem', borderRadius: 'var(--radius-pill)',
                                background: 'var(--navy-800)', color: 'var(--white)',
                                fontWeight: 700, fontSize: '1rem',
                                border: '1px solid var(--border)',
                            }}
                        >
                            {t('sales.ctaBannerBtn')}
                            <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={18} weight={2} /></span>
                        </button>
                    </div>
                </Reveal>
            </section>

            {modalPlan !== null && (
                <InquiryModal key={modalPlan} onClose={closeForm} plan={modalPlan} />
            )}

            <style>{`
                @media (max-width: 980px) {
                    .plan-grid {
                        grid-template-columns: minmax(0, 460px) !important;
                        justify-content: center;
                        gap: 2rem !important;
                    }
                }
                @media (max-width: 640px) {
                    .sales-city-grid {
                        grid-template-columns: 1fr !important;
                        padding: 3.5rem 1rem !important;
                    }
                }
            `}</style>
        </main>
    );
}

/* ── Hero carousel ────────────────────────────────────────────────────
   Photos of the two cities, crossfading every three seconds. Files live in
   public/images/hero (WebP, 1600px, Pexels/Unsplash licences, no credit
   required) because the CSP only allows same-origin images. Only the
   current and next slide get a src, so a visitor who leaves after the
   first slide downloads one photo, not six. With reduced motion the first
   photo stays put, and the timer pauses while the tab is hidden.
   ─────────────────────────────────────────────────────────────────── */
const HERO_ACCENT = '#8fe3bf';
const HERO_INTERVAL_MS = 3000;
const HERO_SLIDES = [
    { src: '/images/hero/tijuana-arch-dusk.webp', city: 'Tijuana, BC', pos: 'center 55%' },
    { src: '/images/hero/juarez-cathedral.webp', city: 'Ciudad Juárez, CHIH', pos: 'center 35%' },
    { src: '/images/hero/tijuana-night.webp', city: 'Tijuana, BC', pos: 'center 50%' },
    { src: '/images/hero/juarez-museum.webp', city: 'Ciudad Juárez, CHIH', pos: 'center 50%' },
    { src: '/images/hero/tijuana-arch-day.webp', city: 'Tijuana, BC', pos: 'center 45%' },
    { src: '/images/hero/tijuana-downtown.webp', city: 'Tijuana, BC', pos: 'center 50%' },
] as const;

function HeroCarousel() {
    const [index, setIndex] = useState(0);
    // Highest slide index allowed to load: the current one plus the next.
    const [reach, setReach] = useState(1);

    useEffect(() => {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const id = window.setInterval(() => {
            if (document.hidden) return;
            setIndex((n) => {
                const next = (n + 1) % HERO_SLIDES.length;
                setReach((r) => Math.max(r, Math.min(next + 1, HERO_SLIDES.length - 1)));
                return next;
            });
        }, HERO_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, []);

    return (
        <>
            <div aria-hidden style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
                {HERO_SLIDES.map((s, i) => (
                    <img
                        key={s.src}
                        src={i <= reach ? s.src : undefined}
                        alt=""
                        decoding="async"
                        fetchPriority={i === 0 ? 'high' : 'low'}
                        className={'hero-slide' + (i === index ? ' is-active' : '')}
                        style={{ objectPosition: s.pos }}
                    />
                ))}
            </div>

            {/* Legibility: darkest behind the centered text, easing toward the
                edges so the photo still shows around it. */}
            <div
                aria-hidden
                className="hero-scrim"
                style={{
                    position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
                    background:
                        'radial-gradient(ellipse 70% 75% at 50% 52%, rgba(8,12,18,0.78) 0%, rgba(8,12,18,0.6) 55%, rgba(8,12,18,0.35) 100%),' +
                        'linear-gradient(0deg, rgba(8,12,18,0.5) 0%, rgba(8,12,18,0) 30%)',
                }}
            />

            <style>{`
                .hero-slide {
                    position: absolute; inset: 0; width: 100%; height: 100%;
                    object-fit: cover; opacity: 0; transform: scale(1.08);
                    transition: opacity 1.1s ease, transform 4.2s ease-out;
                }
                .hero-slide.is-active { opacity: 1; transform: scale(1); }
                @media (prefers-reduced-motion: reduce) {
                    .hero-slide { transition: none; transform: none; }
                }
                @media (max-width: 760px) {
                    .hero-scrim {
                        background: linear-gradient(0deg, rgba(8,12,18,0.88) 0%, rgba(8,12,18,0.7) 55%, rgba(8,12,18,0.45) 100%) !important;
                    }
                    .sales-hero-inner { padding: 4rem 1rem 5.5rem !important; }
                }
            `}</style>
        </>
    );
}

/* ── Building blocks ──────────────────────────────────────────────── */

function PrimaryCta({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            className="press"
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.95rem 1.35rem 0.95rem 1.85rem',
                borderRadius: 'var(--radius-pill)',
                background: 'var(--brand)', color: 'var(--on-brand)',
                fontWeight: 700, fontSize: '0.98rem',
            }}
        >
            {children}
            {/* Button-in-button: the arrow rides in its own disc at the pill's edge. */}
            <span
                className="cta-arrow"
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 30, height: 30, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.16)',
                }}
            >
                <IconArrowRight size={16} weight={2} />
            </span>
        </button>
    );
}

function TrustPoint({ icon, label, light = false }: { icon: React.ReactNode; label: string; light?: boolean }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', color: light ? 'rgba(255,255,255,0.82)' : 'var(--gray-400)', fontWeight: 600 }}>
            <span style={{ color: light ? HERO_ACCENT : 'var(--gold)', display: 'flex' }}>{icon}</span>
            {label}
        </span>
    );
}

function SectionHead({ eyebrow, title, body, centered = false }: { eyebrow: string; title: string; body: string; centered?: boolean }) {
    return (
        <div style={{ marginBottom: '3.25rem', maxWidth: 620, ...(centered ? { marginLeft: 'auto', marginRight: 'auto', textAlign: 'center' as const } : {}) }}>
            <span className="eyebrow">{eyebrow}</span>
            <h2 className="display" style={{ fontSize: 'clamp(2rem, 4.4vw, 3rem)', margin: '0.85rem 0 0.9rem' }}>
                {title}
            </h2>
            <p style={{ color: 'var(--gray-400)', fontSize: '1.05rem', lineHeight: 1.65 }}>{body}</p>
        </div>
    );
}

function StepCard({ step, icon, title, body }: {
    step: string; icon: React.ReactNode; title: string; body: string;
}) {
    return (
        <div className="bezel hover-lift">
            <div className="bezel-core" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--gold)', display: 'flex' }}>{icon}</span>
                    <span
                        className="display"
                        style={{ fontSize: '2rem', color: 'var(--gray-600)', lineHeight: 1 }}
                    >
                        {step}
                    </span>
                </div>
                <h3 style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: '-0.01em' }}>{title}</h3>
                <p style={{ color: 'var(--gray-400)', fontSize: '0.92rem', lineHeight: 1.65 }}>{body}</p>
            </div>
        </div>
    );
}

function CityCard({ icon, accent, city, region, body }: {
    icon: React.ReactNode; accent: string; city: string; region: string; body: string;
}) {
    return (
        <div
            className="hover-lift"
            style={{
                background: 'var(--navy-800)',
                border: '1px solid var(--border)',
                borderLeft: `4px solid ${accent}`,
                borderRadius: 'var(--radius)',
                padding: '1.85rem',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginBottom: '1rem' }}>
                <span style={{ color: accent, display: 'flex' }}>{icon}</span>
                <span style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: accent }}>
                    {region}
                </span>
            </div>
            <h3 className="display" style={{ fontSize: '1.9rem', marginBottom: '0.65rem' }}>{city}</h3>
            <p style={{ color: 'var(--gray-400)', fontSize: '0.95rem', lineHeight: 1.65 }}>{body}</p>
        </div>
    );
}

function AddonCard({ icon, title, price, priceMxn, body, ctaLabel, onCta }: {
    icon: React.ReactNode; title: string; price: string; priceMxn?: string; body: string;
    ctaLabel: string; onCta: () => void;
}) {
    return (
        <div
            className="hover-lift"
            style={{
                padding: '1.75rem',
                borderRadius: 'calc(var(--radius) + 2px)',
                background: 'var(--navy-800)',
                border: '1px solid var(--border)',
                display: 'flex', flexDirection: 'column', gap: '0.85rem',
            }}
        >
            <span
                style={{
                    width: 38, height: 38, borderRadius: 11,
                    background: 'var(--gold-dim)', color: 'var(--gold)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
            >
                {icon}
            </span>

            <h3 style={{ fontSize: '1.02rem', fontWeight: 800, lineHeight: 1.3 }}>{title}</h3>
            <div>
                <p
                    style={{
                        display: 'inline-block', padding: '0.25rem 0.7rem', borderRadius: 'var(--radius-pill)',
                        background: 'var(--gold-dim)', fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)',
                    }}
                >
                    {price}
                </p>
                {/* Same reasoning as the plan cards above: half the audience
                    budgets in pesos, so the MXN figure rides along in Spanish
                    rather than making them convert it themselves — but the
                    caller passes `priceMxn={undefined}` in English, so USD
                    stands alone there. */}
                {priceMxn && (
                    <p style={{ fontSize: '0.76rem', color: 'var(--gray-500)', marginTop: '0.15rem' }}>{priceMxn}</p>
                )}
            </div>
            <p style={{ fontSize: '0.88rem', color: 'var(--gray-400)', lineHeight: 1.6, flex: 1 }}>{body}</p>

            <button
                onClick={onCta}
                className="press"
                style={{
                    alignSelf: 'stretch',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem',
                    background: 'none', color: 'var(--white)',
                    fontWeight: 700, fontSize: '0.88rem',
                    padding: '0.85rem 0 0',
                    borderTop: '1px solid var(--border)',
                }}
            >
                {ctaLabel}
                <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={15} weight={2} /></span>
            </button>
        </div>
    );
}

function PricingCard({ tier, tagline, price, period, note, badge, features, featured = false, premium = false, ctaLabel, onCta }: {
    tier: string; tagline?: string; price: string; period: string; note?: string; badge?: string;
    features: string[]; featured?: boolean; premium?: boolean; ctaLabel: string; onCta: () => void;
}) {
    return (
        <div
            className={featured ? undefined : 'hover-lift'}
            style={{
                position: 'relative',
                padding: '2.25rem 2rem 2rem',
                borderRadius: 'calc(var(--radius) + 6px)',
                background: featured ? 'var(--brand)' : 'var(--navy-800)',
                color: featured ? 'var(--on-brand)' : 'var(--white)',
                border: `1px solid ${featured ? 'var(--brand)' : premium ? 'var(--gold)' : 'var(--border)'}`,
                // Premium gets a gold hairline halo so the top tier reads as
                // distinct from Promoted without a second solid-fill card.
                boxShadow: featured ? 'var(--shadow)' : premium ? '0 0 0 3px var(--gold-dim)' : 'none',
                display: 'flex', flexDirection: 'column', gap: '1.5rem',
                // The recommended plan sits proud of its neighbours on desktop.
                marginTop: featured ? '-0.9rem' : 0,
                paddingTop: featured ? '3rem' : '2.25rem',
            }}
        >
            {badge && (
                <div
                    style={{
                        position: 'absolute', top: '-13px', left: '2.1rem',
                        display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                        padding: '0.28rem 0.85rem', borderRadius: 'var(--radius-pill)',
                        background: 'var(--gold-fill)', color: 'var(--brand-identity)',
                        fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.07em',
                        whiteSpace: 'nowrap',
                    }}
                >
                    <IconPromoted size={11} weight={2.2} /> {badge}
                </div>
            )}

            <div>
                <p
                    style={{
                        fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase',
                        letterSpacing: '0.14em', marginBottom: '0.7rem',
                        opacity: featured ? 0.8 : 1,
                        color: featured ? 'inherit' : 'var(--gray-400)',
                    }}
                >
                    {tier}
                </p>
                {tagline && (
                    <p style={{ fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '1.1rem', minHeight: '3em', opacity: featured ? 0.88 : 1, color: featured ? 'inherit' : 'var(--gray-300)' }}>
                        {tagline}
                    </p>
                )}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span className="display" style={{ fontSize: '3.4rem', lineHeight: 1 }}>{price}</span>
                    <span style={{ fontSize: '0.92rem', opacity: 0.75 }}>{period}</span>
                </div>
                {/* Half the audience budgets in pesos, so a Spanish-language
                    reader gets the MXN line rather than doing the conversion
                    themselves. In English the site quotes USD only — the
                    caller passes `note={undefined}` for English, keys intact. */}
                {note && (
                    <p style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '0.35rem' }}>{note}</p>
                )}
            </div>

            <ul
                style={{
                    display: 'flex', flexDirection: 'column', gap: '0.75rem', listStyle: 'none', flex: 1,
                    paddingTop: '1.5rem',
                    borderTop: `1px solid ${featured ? 'rgba(255,255,255,0.22)' : 'var(--border)'}`,
                }}
            >
                {features.map((f) => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', fontSize: '0.92rem', lineHeight: 1.5 }}>
                        <span style={{ color: featured ? 'var(--gold-fill)' : 'var(--gold)', flexShrink: 0, marginTop: 2, display: 'flex' }}>
                            <IconCheck size={16} weight={2.2} />
                        </span>
                        <span style={{ opacity: featured ? 0.92 : 1, color: featured ? 'inherit' : 'var(--gray-300)' }}>{f}</span>
                    </li>
                ))}
            </ul>

            <button
                onClick={onCta}
                className="press"
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                    padding: '0.9rem 1.5rem', borderRadius: 'var(--radius-pill)',
                    background: featured ? 'var(--navy-800)' : 'var(--brand)',
                    color: featured ? 'var(--white)' : 'var(--on-brand)',
                    border: featured ? '1px solid var(--border)' : 'none',
                    fontWeight: 700, fontSize: '0.95rem',
                }}
            >
                {ctaLabel}
                <span className="cta-arrow" style={{ display: 'flex' }}><IconArrowRight size={16} weight={2} /></span>
            </button>
        </div>
    );
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
    const ref = useRef<HTMLDivElement>(null);
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (!ref.current) return;
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry.isIntersecting) return;
                setIsVisible(true);
                observer.unobserve(entry.target);
            },
            { threshold: 0.08, rootMargin: '60px' },
        );
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div
            ref={ref}
            style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'translateY(0)' : 'translateY(28px)',
                transition: `opacity 0.7s var(--ease-out) ${delay}s, transform 0.7s var(--ease-out) ${delay}s`,
                willChange: 'opacity, transform',
            }}
        >
            {children}
        </div>
    );
}
