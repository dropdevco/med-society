import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { ratingOf } from '../../utils/rating';
import { hueOf } from '../../utils/images';
import { usePortraitPhoto } from '../../hooks/usePortraitPhoto';
import { formatPrice } from '../../utils/currency';
import { profileViews } from '../../utils/profileViews';
import { IconStar, IconViews, SpecialtyIcon } from '../icons/Icons';
import { placeLabel } from '../../utils/place';

interface ProviderTileProps {
    provider: Provider;
    onClick: (p: Provider) => void;
    /**
     * Set on the first handful of above-the-fold tiles (the first couple of
     * Discover rows) so their image is eagerly fetched at high priority
     * instead of waiting on the lazy-load/idle scheduler every other tile
     * uses. Everything below the fold stays lazy — eagerly loading all of
     * them would just move the contention from "images fight the providers
     * fetch" to "images fight each other".
     */
    priority?: boolean;
}

/**
 * The browse-row card: image first, words second.
 *
 * Airbnb's home page works because the photo does the persuading and the text
 * only confirms it. Two thirds of this directory has no usable portrait, so the
 * fallback has to carry the same weight — a specialty-tinted panel with the
 * clinic's monogram, coloured deterministically from its id. It reads as a
 * designed cover rather than as a missing image.
 */
export function ProviderTile({ provider, onClick, priority = false }: ProviderTileProps) {
    const rating = ratingOf(provider);
    const { t, i18n } = useTranslation();
    // Placeholder, not measured traffic — see profileViews.ts.
    const providerViews = profileViews(provider);
    // Falls back to a live Google Places photo when there is no usable
    // `imageUrl` — see usePortraitPhoto. Without it, a tile in the Discover
    // rows showed the specialty monogram for a clinic whose own drawer
    // already had a real photo. 'tile' picks the size bucket the resized
    // Google Places proxy serves for this ~208px-wide slot.
    const { url: photo, srcSet } = usePortraitPhoto(provider, 'tile');
    const accent = provider.country === 'MX' ? 'var(--mx)' : 'var(--us)';
    const side = placeLabel(provider);

    return (
        <button
            onClick={() => onClick(provider)}
            className="ms-tile"
            style={{
                width: '100%', textAlign: 'left', background: 'none',
                color: 'var(--white)', padding: 0,
                display: 'flex', flexDirection: 'column', gap: '0.6rem',
            }}
        >
            <div
                className="ms-tile-media"
                style={{
                    position: 'relative', width: '100%', aspectRatio: '1 / 1',
                    borderRadius: 'var(--radius)', overflow: 'hidden',
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                }}
            >
                {photo ? (
                    <img
                        src={photo}
                        srcSet={srcSet}
                        alt=""
                        loading={priority ? 'eager' : 'lazy'}
                        fetchPriority={priority ? 'high' : 'auto'}
                        decoding="async"
                        width={400}
                        height={400}
                        className="ms-tile-img ms-img-fade"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        ref={(img) => {
                            // A cached image is already `complete` by the time
                            // this ref runs, and never fires a fresh `onLoad` —
                            // without this it would sit at opacity 0 forever.
                            if (img && img.complete && img.naturalWidth > 0) {
                                img.classList.add('is-loaded');
                            }
                        }}
                        onLoad={(e) => e.currentTarget.classList.add('is-loaded')}
                        onError={(e) => {
                            // A dead CDN link would otherwise leave a torn-image
                            // glyph on the cover; drop back to the monogram.
                            const img = e.currentTarget;
                            img.style.display = 'none';
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = 'flex';
                        }}
                    />
                ) : null}

                <Monogram provider={provider} hidden={Boolean(photo)} />

                {provider.promoted && (
                    <span style={{
                        position: 'absolute', top: 10, left: 10,
                        padding: '0.2rem 0.6rem', borderRadius: 'var(--radius-pill)',
                        background: 'var(--navy-800)', color: 'var(--gold)',
                        fontSize: '0.66rem', fontWeight: 800,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        border: '1px solid var(--border)',
                    }}>
                        {t('drawer.promoted')}
                    </span>
                )}

                {/*
                  No verified/licensed mark on the photo itself. Verified is a
                  paid feature — stamping it on the cover for free, in the one
                  slot everyone sees before they read a word of text, gave
                  away the thing a plan is meant to buy. The same fact still
                  shows as a text badge on the card and the drawer; it just
                  doesn't ride on the image here.
                */}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.18rem', minWidth: 0 }}>
                <div style={{
                    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem',
                }}>
                    <p style={{
                        fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.3, minWidth: 0,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                        {provider.name}
                    </p>
                    {/* A tile is narrow enough that "New" is the whole badge,
                        but printing 0.0 here was the same lie as on the card. */}
                    {rating !== null ? (
                        <span style={{
                            display: 'flex', alignItems: 'center', gap: '0.22rem',
                            fontSize: '0.82rem', flexShrink: 0,
                        }}>
                            <IconStar size={13} filled style={{ color: 'var(--star)' }} />
                            <strong style={{ fontWeight: 700 }}>{rating.toFixed(1)}</strong>
                        </span>
                    ) : (
                        <span style={{
                            fontSize: '0.74rem', flexShrink: 0, fontWeight: 700,
                            color: 'var(--gray-500)',
                        }}>
                            {t('card.new')}
                        </span>
                    )}
                </div>

                <p style={{
                    fontSize: '0.84rem', color: 'var(--gray-400)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                    {provider.specialty
                        .slice(0, 2)
                        .map((s) => t(`specialties.${s}`, { defaultValue: s }))
                        .join(' · ')}
                </p>

                <p style={{
                    fontSize: '0.84rem', color: 'var(--gray-500)',
                    display: 'flex', alignItems: 'center', gap: '0.35rem',
                }}>
                    <span style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: accent, flexShrink: 0,
                    }} />
                    {side}
                </p>

                {/* Placeholder until real view tracking exists — see profileViews.ts. */}
                <p style={{
                    fontSize: '0.78rem', color: 'var(--gray-500)',
                    display: 'flex', alignItems: 'center', gap: '0.3rem',
                }}>
                    <IconViews size={12} />
                    {t('card.profileViews', {
                        count: providerViews,
                        formatted: providerViews.toLocaleString(i18n.language),
                        defaultValue: `${providerViews} profile views`,
                    })}
                </p>

                {provider.priceFromMxn != null && (
                    <p style={{
                        marginTop: '0.15rem', fontSize: '0.84rem',
                        display: 'flex', alignItems: 'center', gap: '0.45rem',
                    }}>
                        {provider.priceFromMxn != null && (
                            <span style={{ fontWeight: 700 }}>
                                {t('card.priceFrom', {
                                    price: formatPrice(provider.priceFromMxn, i18n.language),
                                    defaultValue: `From ${formatPrice(provider.priceFromMxn, i18n.language)}`,
                                })}
                            </span>
                        )}
                    </p>
                )}
            </div>
        </button>
    );
}

/**
 * The no-photo cover. A specialty glyph bled off the corner at low contrast,
 * with the clinic's initials on top — enough shape and colour to make a row
 * of them scan as a set of distinct places.
 */
function Monogram({ provider, hidden }: { provider: Provider; hidden: boolean }) {
    const hue = hueOf(provider.id);
    const initials = provider.name
        .replace(/^(Dr|Dra|Lic|Mtro|Mtra)\.?\s+/i, '')
        .split(/\s+/)
        .filter((w) => /[\p{L}]/u.test(w))
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join('');

    return (
        <span
            className="ms-mono"
            style={{
                // The hue is the only per-provider part; the theme supplies the
                // rest, so the cover follows a light/dark flip.
                ['--mono-h' as string]: `${hue}deg`,
                position: 'absolute', inset: 0,
                display: hidden ? 'none' : 'flex',
                alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
            } as React.CSSProperties}
        >
            <span style={{
                position: 'absolute', right: '-14%', bottom: '-16%',
                opacity: 0.22, display: 'flex',
            }}>
                <SpecialtyIcon specialty={provider.specialty[0]} size={132} weight={1.1} />
            </span>
            <span style={{
                position: 'relative',
                fontSize: '1.9rem', fontWeight: 800, letterSpacing: '0.04em',
            }}>
                {initials || '·'}
            </span>
        </span>
    );
}
