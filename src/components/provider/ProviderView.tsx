import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { useGoogleReviews } from '../../hooks/useGoogleReviews';
import { usePortraitPhoto } from '../../hooks/usePortraitPhoto';
import { ratingOf, ratingSource } from '../../utils/rating';
import { formatPrice } from '../../utils/currency';
import { profileViews } from '../../utils/profileViews';
import { ReviewCarousel } from './ReviewCarousel';
import { ClinicPhotos } from './ClinicPhotos';
import { InsuranceList } from './InsuranceList';
import { ServiceList } from './ServiceList';
import { InquiryForm } from './InquiryForm';
import { DoctorAnswers } from '../forum/ForumPromos';
import { FORUMS_LISTED } from '../../lib/forumRoutes';
import { useOwnerPhotos } from '../../hooks/useOwnerPhotos';
import {
    IconStar, IconMapPin, IconPhone, IconLanguage,
    IconPromoted, IconVerified, IconReviews, IconViews, IconGlobe,
    SpecialtyIcon, CountryIcon,
} from '../icons/Icons';
import { SOCIAL_ICONS, SOCIAL_ORDER } from '../icons/socialMap';
import { placeLabel } from '../../utils/place';
import { languageName } from '../../utils/languages';

/** The map is the heaviest thing on a provider profile — never pay for it before it scrolls into view. */
const ProviderMap = lazy(() =>
    import('../map/ProviderMap').then((m) => ({ default: m.ProviderMap })),
);

/**
 * The body of a provider profile, shared by the full page (`ProviderPage`) and
 * the modal (`ProviderModal`) so the two can never drift apart. It renders no
 * page chrome — no nav offset, no back button, no close button; each host adds
 * its own.
 */
export function ProviderView({ provider, titleId }: { provider: Provider; titleId?: string }) {
    const { t, i18n } = useTranslation();
    const ownerPhotos = useOwnerPhotos(provider.id);
    const { reviews, loading: reviewsLoading } = useGoogleReviews(provider.googlePlaceId);
    const { url: portrait } = usePortraitPhoto(provider);

    const rating = ratingOf(provider);
    const specialtyLabel = (s: string) => t(`specialties.${s}`, { defaultValue: s });
    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const accentSoft = provider.country === 'MX' ? 'var(--mx-soft)' : 'var(--us-soft)';
    const views = profileViews(provider);
    const hasCoords = Number.isFinite(provider.lat) && Number.isFinite(provider.lng);

    const directionsUrl = hasCoords
        ? `https://www.google.com/maps/dir/?api=1&destination=${provider.lat},${provider.lng}`
            + (provider.googlePlaceId ? `&destination_place_id=${encodeURIComponent(provider.googlePlaceId)}` : '')
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(provider.address)}`;

    return (
        <>
                <div className="ms-provider-layout">
                    {/* ── Main column ── */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem', minWidth: 0 }}>
                        {/* Header */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.2rem' }}>
                            {provider.promoted && (
                                <Badge icon={<IconPromoted size={11} weight={2} />} label={t('drawer.promoted')} bg="var(--brand)" fg="var(--on-brand)" />
                            )}
                            {provider.verified ? (
                                <Badge icon={<IconVerified size={11} weight={2} />} label={t('drawer.verified')} bg="var(--gold-dim)" fg="var(--gold)" />
                            ) : provider.licensed ? (
                                <Badge icon={<IconVerified size={11} weight={2} />} label={t('drawer.licensed')} bg="var(--surface)" fg="var(--gray-400)" />
                            ) : null}
                            <Badge
                                icon={<CountryIcon country={provider.country} size={11} weight={2} />}
                                label={placeLabel(provider)}
                                bg={accentSoft}
                                fg={accent}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                            <div
                                style={{
                                    width: 72, height: 72, borderRadius: 16, flexShrink: 0,
                                    overflow: 'hidden',
                                    background: portrait ? 'var(--surface)' : accentSoft,
                                    color: accent,
                                    border: `1px solid ${portrait ? 'var(--border)' : accent}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}
                            >
                                {portrait ? (
                                    <img src={portrait} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <SpecialtyIcon specialty={provider.specialty[0]} size={32} />
                                )}
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <h1 id={titleId} style={{ fontSize: '1.7rem', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.015em' }}>
                                    {provider.name}
                                </h1>
                                <p style={{ fontSize: '0.95rem', color: 'var(--gray-400)', marginTop: '0.35rem', lineHeight: 1.5 }}>
                                    {provider.specialty.map(specialtyLabel).join(' · ')}
                                </p>
                            </div>
                        </div>

                        {/* Stats */}
                        <div
                            style={{
                                background: 'var(--surface)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius)', padding: '1.1rem 0.75rem',
                                display: 'flex', justifyContent: 'space-around',
                            }}
                        >
                            <StatBox
                                icon={<IconStar size={19} filled style={{ color: 'var(--star)' }} />}
                                value={rating !== null ? rating.toFixed(1) : '—'}
                                label={rating !== null ? t('drawer.rating') : t('card.unrated')}
                            />
                            <Divider />
                            <StatBox
                                icon={<IconReviews size={19} style={{ color: 'var(--gray-500)' }} />}
                                value={provider.reviewCount.toLocaleString()}
                                label={t(`drawer.reviewsOn.${ratingSource(provider)}`)}
                            />
                            <Divider />
                            <StatBox
                                icon={<IconViews size={19} style={{ color: 'var(--gray-500)' }} />}
                                value={views.toLocaleString(i18n.language)}
                                label={t('drawer.profileViews')}
                            />
                        </div>

                        {provider.priceFromMxn != null && (
                            <p style={{ fontSize: '0.95rem' }}>
                                <span style={{ color: 'var(--gray-400)' }}>{t('providerPage.pricesFrom')} </span>
                                <strong style={{ color: 'var(--gold)' }}>{formatPrice(provider.priceFromMxn, i18n.language)}</strong>
                            </p>
                        )}

                        {/* Languages — only ever a stated fact, never a guess. */}
                        <DetailRow
                            icon={<IconLanguage size={17} />}
                            text={provider.languagesConfirmed && provider.languages.length > 0
                                ? provider.languages
                                    .map((l) => languageName(l, i18n.language))
                                    .join(' · ')
                                : t('drawer.languageUnknown')}
                            muted={!provider.languagesConfirmed || provider.languages.length === 0}
                        />

                        <ClinicPhotos placeId={provider.googlePlaceId} portrait={portrait} galleryUrls={[...ownerPhotos, ...(provider.galleryUrls ?? [])]} />

                        <InsuranceList insurances={provider.insurances ?? []} />

                        <ServiceList services={provider.services ?? []} collapsible={false} />

                        <ReviewCarousel reviews={reviews} loading={reviewsLoading} />

                        {FORUMS_LISTED && <DoctorAnswers providerId={provider.id} />}

                        {provider.tier === 'basic' && (
                            <Link
                                to={`/claim/${provider.id}`}
                                style={{
                                    display: 'block', textAlign: 'center',
                                    padding: '0.8rem', borderRadius: 'var(--radius)',
                                    border: '1px dashed var(--border-strong)',
                                    color: 'var(--gray-400)', fontSize: '0.86rem',
                                    fontWeight: 650, textDecoration: 'none',
                                }}
                            >
                                {t('drawer.claimThis')}
                            </Link>
                        )}
                    </div>

                    {/* ── Sidebar ── */}
                    <aside className="ms-provider-sidebar">
                        <div
                            style={{
                                background: 'var(--navy-800)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius)', padding: '1.25rem',
                                display: 'flex', flexDirection: 'column', gap: '0.9rem',
                                boxShadow: 'var(--shadow-sm)',
                            }}
                        >
                            <h2 style={{
                                fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
                                textTransform: 'uppercase', color: 'var(--gray-500)', margin: 0,
                            }}>
                                {t('providerPage.contact')}
                            </h2>

                            <DetailRow icon={<IconMapPin size={17} />} text={provider.address} />
                            {provider.postalCode && (
                                <p style={{ fontSize: '0.82rem', color: 'var(--gray-500)', marginTop: '-0.5rem', marginLeft: '1.55rem' }}>
                                    {provider.city}, {provider.country} · {provider.postalCode}
                                </p>
                            )}
                            {provider.phone && (
                                <DetailRow icon={<IconPhone size={17} />} text={provider.phone} href={`tel:${provider.phone}`} />
                            )}
                            {provider.email && (
                                <DetailRow icon={<IconGlobe size={17} />} text={provider.email} href={`mailto:${provider.email}`} />
                            )}

                            {provider.phone && (
                                <a
                                    href={`tel:${provider.phone}`}
                                    className="press"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                        padding: '0.9rem 1rem', borderRadius: 'var(--radius)',
                                        background: 'var(--brand)', color: 'var(--on-brand)',
                                        fontWeight: 700, fontSize: '0.92rem', textDecoration: 'none',
                                    }}
                                >
                                    <IconPhone size={17} weight={2} /> {t('drawer.callNow')}
                                </a>
                            )}

                            <InquiryForm provider={provider} />

                            {provider.website && (
                                <a
                                    href={provider.website}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="press"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                        padding: '0.8rem 1rem', borderRadius: 'var(--radius)',
                                        border: '1px solid var(--border)', background: 'transparent',
                                        color: 'var(--text)', fontWeight: 650, fontSize: '0.9rem', textDecoration: 'none',
                                    }}
                                >
                                    <IconGlobe size={16} weight={2} /> {t('providerPage.website')}
                                </a>
                            )}

                            <a
                                href={directionsUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="press"
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                    padding: '0.8rem 1rem', borderRadius: 'var(--radius)',
                                    border: '1px solid var(--border)', background: 'transparent',
                                    color: 'var(--text)', fontWeight: 650, fontSize: '0.9rem', textDecoration: 'none',
                                }}
                            >
                                <IconMapPin size={16} weight={2} /> {t('providerPage.getDirections')}
                            </a>

                            <SocialLinks socials={provider.socials} name={provider.name} />

                            <div style={{ height: 200, borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                                {hasCoords ? (
                                    <Suspense fallback={<MapPlaceholder />}>
                                        <ProviderMap
                                            lat={provider.lat}
                                            lng={provider.lng}
                                            name={provider.name}
                                            address={provider.address}
                                            directionsUrl={directionsUrl}
                                        />
                                    </Suspense>
                                ) : (
                                    <MapPlaceholder />
                                )}
                            </div>
                        </div>
                    </aside>
                </div>
        </>
    );
}

function MapPlaceholder() {
    return (
        <div style={{
            width: '100%', height: '100%', borderRadius: 'var(--radius)',
            border: '1px solid var(--border)', background: 'var(--surface)',
        }} />
    );
}

function Badge({ icon, label, bg, fg }: { icon: React.ReactNode; label: string; bg: string; fg: string }) {
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.28rem',
                padding: '0.22rem 0.6rem', borderRadius: 'var(--radius-pill)',
                background: bg, color: fg, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
            }}
        >
            {icon} {label}
        </span>
    );
}

function Divider() {
    return <div style={{ width: 1, background: 'var(--border)' }} />;
}

function StatBox({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem', minWidth: 0 }}>
            {icon}
            <span style={{ fontWeight: 800, fontSize: '1.2rem' }}>{value}</span>
            <span style={{ fontSize: '0.72rem', color: 'var(--gray-400)', textAlign: 'center' }}>{label}</span>
        </div>
    );
}

function DetailRow({ icon, text, href, muted = false, external = false }: {
    icon: React.ReactNode; text: string; href?: string; muted?: boolean; external?: boolean;
}) {
    const content = (
        <div
            style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.65rem',
                fontSize: '0.9rem', lineHeight: 1.5,
                color: href ? 'var(--gold)' : muted ? 'var(--gray-500)' : 'var(--gray-300)',
                fontWeight: href ? 600 : 400,
                fontStyle: muted ? 'italic' : 'normal',
            }}
        >
            <span style={{ flexShrink: 0, marginTop: 1, color: 'var(--gray-500)', display: 'flex' }}>{icon}</span>
            <span style={{ wordBreak: 'break-word' }}>{text}</span>
        </div>
    );

    if (!href) return content;
    return (
        <a href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
            {content}
        </a>
    );
}

/** Icon buttons for whichever social profiles are known; renders nothing when none are. */
function SocialLinks({ socials, name }: { socials?: Provider['socials']; name: string }) {
    const { t } = useTranslation();
    const entries = SOCIAL_ORDER.filter((k) => /^https?:\/\//i.test(socials?.[k] ?? ''));
    if (entries.length === 0) return null;
    return (
        <div className="ms-socials" role="group" aria-label={t('providerPage.socials.group', { name })}>
            {entries.map((k) => {
                const Icon = SOCIAL_ICONS[k];
                const label = t(`providerPage.socials.${k}`, { name });
                return (
                    <a
                        key={k}
                        href={socials![k]}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ms-social-btn press"
                        aria-label={label}
                        title={label}
                    >
                        <Icon size={18} />
                    </a>
                );
            })}
        </div>
    );
}
