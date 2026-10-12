import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { hueOf } from '../../utils/images';
import { usePortraitPhoto } from '../../hooks/usePortraitPhoto';
import { ratingOf, ratingSource } from '../../utils/rating';
import { formatPrice } from '../../utils/currency';
import { profileViews } from '../../utils/profileViews';
import {
    IconStar, IconMapPin, IconChevronRight, IconPromoted,
    IconVerified, IconViews, SpecialtyIcon, CountryIcon,
} from '../icons/Icons';
import { placeLabel } from '../../utils/place';

interface ProviderCardProps {
    provider: Provider;
    selected: boolean;
    onClick: (p: Provider) => void;
    /** Kilometres from the searched postal centre. Undefined outside a location search. */
    distance?: number;
    /**
     * Fires with this card's id on pointer or keyboard focus, and with null on
     * leave. The page forwards it to the map, which lights the matching pin.
     */
    onHover?: (id: string | null) => void;
    /**
     * The cursor is over this provider's *map pin*. The mirror image of
     * `onHover`: that sends the list's attention to the map, this brings the
     * map's attention back. Without the return leg, pointing at a pin tells
     * you nothing about which of 807 rows it belongs to.
     */
    focused?: boolean;
    /**
     * Set on the first few above-the-fold rows of a results list so their
     * thumbnail loads eagerly at high priority instead of waiting on the
     * lazy-load scheduler every other card uses.
     */
    priority?: boolean;
}

/** Insurers are long names; two is what fits before the row starts lying about the rest. */
const INSURANCE_CHIPS = 2;

export function ProviderCard({
    provider, selected, onClick, distance, onHover, focused = false, priority = false,
}: ProviderCardProps) {
    const { t, i18n } = useTranslation();
    /**
     * A photo that 404s used to hide its own <img> and leave a blank 74px box,
     * because the monogram class was only applied on the no-photo branch. So
     * the cards most likely to be missing a picture were the ones that showed
     * nothing at all rather than the fallback built for exactly that case.
     *
     * The source itself now comes from usePortraitPhoto, which falls back to a
     * live Google Places photo when there is no usable `imageUrl` — 1,275 of
     * the 1,390 providers with a googlePlaceId are in exactly that spot, so
     * without this a card showed the specialty icon for a clinic whose own
     * drawer already had a real photo one click away. 'thumb' picks the
     * size bucket for this card's 74px avatar rather than the full-size
     * image the drawer's gallery needs.
     */
    const { url: resolvedUrl, srcSet } = usePortraitPhoto(provider, 'thumb');
    const [broken, setBroken] = useState(false);
    const photo = broken ? undefined : resolvedUrl;

    // A new provider in a recycled card must not inherit the old one's
    // failure — and Google's photo resolving after mount is a *new* source,
    // not a retry of a failed one, so it must get its own clean `broken` slate.
    const [seenSrc, setSeenSrc] = useState(resolvedUrl);
    if (resolvedUrl !== seenSrc) {
        setSeenSrc(resolvedUrl);
        setBroken(false);
    }

    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const accentSoft = provider.country === 'MX' ? 'var(--mx-soft)' : 'var(--us-soft)';
    const sideLabel = placeLabel(provider);

    const insurances = provider.insurances ?? [];
    const extraInsurers = Math.max(0, insurances.length - INSURANCE_CHIPS);
    // Placeholder, not measured traffic — see profileViews.ts.
    const providerViews = profileViews(provider);

    return (
        <button
            onClick={() => onClick(provider)}
            aria-pressed={selected}
            style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.9rem 1rem',
                borderRadius: 'var(--radius)',
                background: selected ? 'var(--accent-dim)' : 'var(--navy-800)',
                // Focus is the lighter of the two states: a pin hover is a
                // glance, a selection is a decision, so it borrows the accent
                // edge without the fill.
                border: `1px solid ${selected || focused ? 'var(--accent)' : 'var(--border)'}`,
                color: 'var(--white)',
                transition: 'background var(--transition), border-color var(--transition), box-shadow var(--transition)',
                cursor: 'pointer',
                display: 'flex',
                gap: '0.85rem',
                animation: 'fadeIn 0.25s var(--ease-out) both',
            }}
            onMouseEnter={(e) => {
                onHover?.(provider.id);
                if (selected) return;
                e.currentTarget.style.borderColor = 'var(--border-strong)';
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
            }}
            onMouseLeave={(e) => {
                onHover?.(null);
                if (selected) return;
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
            }}
            // Tabbing through results lights the map too — the sync is not a
            // mouse feature, it is how the two panels stay one view.
            onFocus={() => onHover?.(provider.id)}
            onBlur={() => onHover?.(null)}
        >
            {/*
              Portrait when there is a real one. Two thirds of the directory
              carries the source site's generic Open Graph banner instead, which
              portraitUrl() strips — a tinted specialty panel says "no photo"
              far more honestly than the same logo repeated down the page.
            */}
            <div
                className={photo ? undefined : 'ms-mono'}
                style={{
                    ['--mono-h' as string]: `${hueOf(provider.id)}deg`,
                    width: 74, height: 74, borderRadius: 15, flexShrink: 0, overflow: 'hidden',
                    position: 'relative',
                    background: photo ? 'var(--surface)' : undefined,
                    color: photo ? accent : undefined,
                    border: `1px solid ${provider.promoted ? 'var(--gold)' : 'var(--border)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                } as React.CSSProperties}
            >
                {photo ? (
                    <img
                        src={photo}
                        srcSet={srcSet}
                        alt=""
                        loading={priority ? 'eager' : 'lazy'}
                        fetchPriority={priority ? 'high' : 'auto'}
                        decoding="async"
                        width={74}
                        height={74}
                        className="ms-img-fade"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        ref={(img) => {
                            // A cached image is already `complete` and never
                            // fires a fresh `onLoad` — without this it would
                            // sit at opacity 0 forever.
                            if (img && img.complete && img.naturalWidth > 0) {
                                img.classList.add('is-loaded');
                            }
                        }}
                        onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
                        onError={() => setBroken(true)}
                    />
                ) : (
                    <SpecialtyIcon specialty={provider.specialty[0]} size={30} weight={1.6} />
                )}
            </div>

            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {/* nowrap: in Spanish this row used to wrap onto a second line
                    and push the card past its row height. */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                    flexWrap: 'nowrap', overflow: 'hidden',
                }}>
                    {provider.promoted && (
                        <Badge bg="var(--brand)" fg="var(--on-brand)">
                            <IconPromoted size={10} weight={2} /> {t('drawer.promoted')}
                        </Badge>
                    )}
                    {/*
                      Two different claims, and they used to be one badge.
                      "Verified" is what a paid listing buys; `licensed` is a
                      professional licence number we scraped off the source
                      profile. The second was driving the gold badge for 1,720
                      of 4,067 providers, which made the badge the directory's
                      default state and gave away the only visible thing a plan
                      was selling. Same fact, honest label, quieter styling.
                    */}
                    {provider.verified ? (
                        <Badge bg="var(--gold-dim)" fg="var(--gold)">
                            <IconVerified size={11} weight={2} /> {t('drawer.verified')}
                        </Badge>
                    ) : provider.licensed ? (
                        <Badge bg="var(--surface)" fg="var(--gray-400)">
                            <IconVerified size={11} weight={2} /> {t('drawer.licensed')}
                        </Badge>
                    ) : null}
                    <Badge bg={accentSoft} fg={accent}>
                        <CountryIcon country={provider.country} size={11} weight={2} /> {sideLabel}
                    </Badge>
                </div>

                <p style={{
                    fontWeight: 700, fontSize: '1.05rem', lineHeight: 1.25,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {provider.name}
                </p>

                <p style={{
                    fontSize: '0.85rem', color: 'var(--gray-400)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {provider.specialty.map((s) => t(`specialties.${s}`, { defaultValue: s })).join(' · ')}
                </p>

                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.85rem',
                    flexWrap: 'nowrap', overflow: 'hidden',
                }}>
                    <RatingBadge provider={provider} />

                    {/*
                      Placeholder until real view tracking exists — see
                      profileViews.ts. Sits next to the rating rather than as
                      its own row so a card that's already this dense doesn't
                      grow taller just to fit it.
                    */}
                    <span style={{
                        display: 'flex', alignItems: 'center', gap: '0.24rem', flexShrink: 0,
                        fontSize: '0.78rem', color: 'var(--gray-500)',
                    }}>
                        <IconViews size={13} />
                        {t('card.profileViews', {
                            count: providerViews,
                            formatted: providerViews.toLocaleString(i18n.language),
                            defaultValue: `${providerViews} profile views`,
                        })}
                    </span>

                    <span style={{
                        display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 0,
                        fontSize: '0.82rem', color: 'var(--gray-400)',
                    }}>
                        <IconMapPin size={14} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {provider.address || provider.city}
                        </span>
                    </span>

                    {distance != null && Number.isFinite(distance) && (
                        <span style={{
                            fontSize: '0.8rem', fontWeight: 700, color: 'var(--gray-300)',
                            whiteSpace: 'nowrap', flexShrink: 0,
                        }}>
                            {t('filters.radiusKm', { km: distance < 10 ? distance.toFixed(1) : Math.round(distance) })}
                        </span>
                    )}
                </div>

                {(provider.priceFromMxn != null || insurances.length > 0) && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.35rem',
                        flexWrap: 'nowrap', overflow: 'hidden',
                    }}>
                        {provider.priceFromMxn != null && (
                            <Badge bg="var(--gold-dim)" fg="var(--gold)">
                                {t('card.priceFrom', {
                                    price: formatPrice(provider.priceFromMxn, i18n.language),
                                    defaultValue: `From ${formatPrice(provider.priceFromMxn, i18n.language)}`,
                                })}
                            </Badge>
                        )}
                        {insurances.slice(0, INSURANCE_CHIPS).map((name) => (
                            <Badge key={name} bg="transparent" fg="var(--gray-500)" outlined>
                                {name}
                            </Badge>
                        ))}
                        {extraInsurers > 0 && (
                            <Badge bg="transparent" fg="var(--gray-500)" outlined>
                                +{extraInsurers}
                            </Badge>
                        )}
                    </div>
                )}
            </div>

            <span style={{ color: 'var(--gray-500)', flexShrink: 0, alignSelf: 'center', display: 'flex' }}>
                <IconChevronRight size={18} />
            </span>
        </button>
    );
}

function Badge({ bg, fg, outlined, children }: {
    bg: string; fg: string; outlined?: boolean; children: React.ReactNode;
}) {
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                padding: '0.12rem 0.5rem', borderRadius: 'var(--radius-pill)',
                background: bg, color: fg,
                border: outlined ? '1px solid var(--border)' : 'none',
                fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap',
                maxWidth: '11rem', overflow: 'hidden', textOverflow: 'ellipsis',
                flexShrink: 0,
            }}
        >
            {children}
        </span>
    );
}

/**
 * The one place a star rating is drawn, so every surface tells the same story.
 *
 * Two things it refuses to do. It will not print "0.0 (0)" for the 1,849
 * providers ingest stored as `rating: 0` because the source published no
 * rating — an absent rating is not a one-star rating, and rendering it as one
 * libelled nearly half the directory. And it will not print a bare number for
 * a source that measures differently from the other: Doctoralia averages
 * patient opinions on a whole-star scale, Google averages Google reviews, and
 * "5.0" alone invites a comparison between two things that are not the same
 * measurement. `size="full"` spells the provenance out; the compact form just
 * counts, because a result card has no room for a sentence.
 */
export function RatingBadge({ provider, size = 'compact' }: {
    provider: Provider;
    size?: 'compact' | 'full';
}) {
    const { t } = useTranslation();
    const rating = ratingOf(provider);

    if (rating === null) {
        return (
            <span style={{
                display: 'flex', alignItems: 'center', gap: '0.28rem',
                fontSize: '0.82rem', flexShrink: 0, color: 'var(--gray-400)',
                fontWeight: 600,
            }}>
                {t('card.unrated')}
            </span>
        );
    }

    const count = provider.reviewCount.toLocaleString();
    const source = ratingSource(provider);

    return (
        <span style={{
            display: 'flex', alignItems: 'center', gap: '0.28rem',
            fontSize: '0.82rem', flexShrink: 0,
        }}>
            <IconStar size={14} filled style={{ color: 'var(--star)' }} />
            <strong style={{ color: 'var(--white)', fontWeight: 800 }}>{rating.toFixed(1)}</strong>
            <span style={{ color: 'var(--gray-400)' }}>
                {size === 'full'
                    ? t(`card.reviewsFrom.${source}`, { count: provider.reviewCount, formatted: count })
                    : `(${count})`}
            </span>
        </span>
    );
}
