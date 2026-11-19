import { ProfileBadges } from './OrgBadges';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { useGoogleReviews } from '../../hooks/useGoogleReviews';
import { useStoredReviews } from '../../hooks/useStoredReviews';
import { usePortraitPhoto } from '../../hooks/usePortraitPhoto';
import { useProviderTeam } from '../../hooks/useProviderTeam';
import { ratingOf, ratingSource } from '../../utils/rating';
import { profileViews } from '../../utils/profileViews';
import { ReviewCarousel } from './ReviewCarousel';
import { ClinicPhotos } from './ClinicPhotos';
import { InsuranceList } from './InsuranceList';
import { InquiryForm } from './InquiryForm';
import { ContactCard, DetailRow } from './ContactCard';
import { ClinicMain } from './ClinicView';
import { clinicFocus } from '../../utils/clinicFocus';
import { PractisesAt } from './PractisesAt';
import { StayNearby } from '../hotels/StayNearby';
import { DoctorAnswers } from '../forum/ForumPromos';
import { FORUMS_LISTED } from '../../lib/forumRoutes';
import { useOwnerPhotos } from '../../hooks/useOwnerPhotos';
import {
    IconStar, IconLanguage,
    IconPromoted, IconVerified, IconReviews, IconViews,
    SpecialtyIcon, CountryIcon,
} from '../icons/Icons';
import { placeLabel } from '../../utils/place';
import { contactMethodOf, providerProps, trackProviderView } from '../../utils/analytics';
import { track } from '../../lib/posthog';
import { useSectionViews } from '../../hooks/useSectionViews';
import { languageName } from '../../utils/languages';

/**
 * The body of a provider profile, shared by the full page (`ProviderPage`) and
 * the modal (`ProviderModal`) so the two can never drift apart. It renders no
 * page chrome — no nav offset, no back button, no close button; each host adds
 * its own.
 *
 * Two layouts on one URL (`/providers/:id`, which never changes):
 *   - a clinic (`kind === 'clinic'`, migration 0049) leads with what it treats
 *     and the doctors who practise there, and lets a patient pick one when
 *     writing (ClinicMain);
 *   - a doctor (everything else) is one person: photos, insurance, the message
 *     form, reviews, and in the sidebar the clinics they practise at.
 * The header, stats and contact card are the same for both.
 */
export function ProviderView({ provider, titleId }: { provider: Provider; titleId?: string }) {
    const { t, i18n } = useTranslation();
    const ownerPhotos = useOwnerPhotos(provider.id);
    const { reviews, loading: reviewsLoading } = useGoogleReviews(provider.googlePlaceId);
    // The reviews we hold ourselves (Doctoralia's). Only listings that came from
    // Doctoralia have any, so a Google-only clinic fetches nothing.
    const { reviews: storedReviews, loading: storedLoading } = useStoredReviews(
        provider.doctoraliaId ? provider.id : undefined,
    );
    const { url: portrait } = usePortraitPhoto(provider);
    // Doctors at this clinic, or clinics this doctor practises at.
    const { team, loading: teamLoading } = useProviderTeam(provider.id);
    const isClinic = provider.kind === 'clinic';

    // One `provider_viewed` per profile opened. This body is shared by the page
    // and the modal, so counting here covers both. The ref keeps StrictMode's
    // double effect, and re-renders of the same provider, from counting twice.
    const location = useLocation();
    const viewed = useRef('');
    useEffect(() => {
        if (viewed.current === provider.id) return;
        viewed.current = provider.id;
        const modal = Boolean((location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation);
        trackProviderView(provider, modal ? 'modal' : 'page');
        // Only a different provider is a new view; `location` and the rest of
        // `provider` changing underneath the same profile is not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [provider.id]);

    // Which parts of the profile were reached; see the data-section marks below.
    useSectionViews(provider);

    const rating = ratingOf(provider);
    const specialtyLabel = (s: string) => t(`specialties.${s}`, { defaultValue: s });
    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const accentSoft = provider.country === 'MX' ? 'var(--mx-soft)' : 'var(--us-soft)';
    const views = profileViews(provider);

    // A clinic's line under its name: how many doctors, across how many specialties.
    const focus = isClinic ? clinicFocus(provider, team.practitioners) : [];
    const subtitle = isClinic && team.practitioners.length > 0
        ? t('clinicPage.summary', { count: team.practitioners.length, doctors: team.practitioners.length, specialties: focus.length })
        : provider.specialty.map(specialtyLabel).join(' · ');

    // One listener for every phone, email, website, directions and social link
    // on the profile, classified by href, so a new link is counted for free.
    const trackContact = (e: React.MouseEvent) => {
        const a = (e.target as Element).closest('a[href]');
        const method = a ? contactMethodOf(a.getAttribute('href') ?? '') : null;
        if (method) track('provider_contact_click', providerProps(provider, { method }));
    };

    const photos = (
        <div data-section="photos">
            <ClinicPhotos placeId={provider.googlePlaceId} portrait={portrait} galleryUrls={[...ownerPhotos, ...(provider.galleryUrls ?? [])]} />
        </div>
    );
    const insurance = (
        <div data-section="insurance">
            <InsuranceList insurances={provider.insurances ?? []} />
        </div>
    );
    // Messaging is the page's main action, so it sits in the wide column.
    const inquiry = (
        <div data-section="inquiry">
            <InquiryForm provider={provider} doctors={isClinic ? team.practitioners : undefined} />
        </div>
    );
    // Latest first, whatever the rating: a sample picked by stars would flatter the clinic.
    const reviewBlock = (
        <div data-section="reviews" style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem' }}>
            <ReviewCarousel
                reviews={storedReviews}
                loading={storedLoading}
                note={
                    provider.reviewCount > storedReviews.length
                        ? t('reviews.sourceDoctoraliaOf', {
                            shown: storedReviews.length,
                            // Same formatting as the stats box above it.
                            total: provider.reviewCount.toLocaleString(),
                        })
                        : t('reviews.sourceDoctoralia')
                }
            />
            <ReviewCarousel reviews={reviews} loading={reviewsLoading} note={t('reviews.sourceGoogle')} />
        </div>
    );

    return (
        <div className="ms-provider-layout" data-provider-id={provider.id} data-kind={isClinic ? 'clinic' : 'doctor'} onClickCapture={trackContact}>
            {/* ── Main column ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.6rem', minWidth: 0 }}>
                {/* Header */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.2rem' }}>
                    {isClinic && (
                        <Badge label={t('clinicPage.badge')} bg="var(--surface)" fg="var(--gray-300)" />
                    )}
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
                            {subtitle}
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

                <ProfileBadges badges={provider.badges} />

                {isClinic ? (
                    <ClinicMain provider={provider} doctors={team.practitioners} focus={focus} loading={teamLoading}>
                        {{ photos, insurance, inquiry, reviews: reviewBlock }}
                    </ClinicMain>
                ) : (
                    <>
                        {photos}
                        {insurance}
                        {inquiry}
                        {reviewBlock}
                    </>
                )}

                <StayNearby provider={provider} />

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
                {!isClinic && team.clinics.length > 0 && <PractisesAt clinics={team.clinics} />}
                <ContactCard provider={provider} />
            </aside>
        </div>
    );
}

function Badge({ icon, label, bg, fg }: { icon?: React.ReactNode; label: string; bg: string; fg: string }) {
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
