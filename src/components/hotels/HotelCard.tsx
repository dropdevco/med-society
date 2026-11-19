import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Hotel } from '../../types/hotel';
import { bookingHref, formatDistance, isAffiliateLink } from '../../utils/hotelLinks';
import { placePhotoProxyState, placePhotoUrl, subscribePlacePhotoProxy } from '../../utils/placePhoto';
import { track } from '../../lib/posthog';
import { hueOf } from '../../utils/images';
import { IconStar, IconMapPin, IconArrowRight } from '../icons/Icons';

export type HotelSurface = 'provider_page' | 'hotels_page' | 'home';

interface Props {
    hotel: Hotel;
    surface: HotelSurface;
    /** Shown as "1.2 km from {fromName}" when both are given. */
    distanceKm?: number;
    fromName?: string;
    /** The provider page this card sits on, for analytics. */
    providerId?: string;
    /** Stay dates (YYYY-MM-DD), passed on to Booking.com. */
    checkin?: string;
    checkout?: string;
    compact?: boolean;
}

/** Card photo width in CSS px; the 2x source doubles it. */
const PHOTO_W = 400;

/**
 * The hotel's own photo when an admin set one, else its Google cover photo
 * through /api/place-photo (nothing stored; see api/place-photo.ts), else a
 * monogram. A broken image falls back to the monogram too.
 */
function useHotelPhoto(hotel: Hotel): { src: string; srcSet?: string } | null {
    const proxyReady = useSyncExternalStore(subscribePlacePhotoProxy, placePhotoProxyState, placePhotoProxyState);
    if (hotel.photo_url) return { src: hotel.photo_url };
    if (proxyReady && hotel.google_place_id) {
        return {
            src: placePhotoUrl(hotel.google_place_id, PHOTO_W),
            srcSet: `${placePhotoUrl(hotel.google_place_id, PHOTO_W * 2)} 2x`,
        };
    }
    return null;
}

/** One hotel: photo, name, rating, what is nearby and the outbound "Check rates" link. */
export function HotelCard({ hotel, surface, distanceKm, fromName, providerId, checkin, checkout, compact }: Props) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;
    const href = bookingHref(hotel, { lang, checkin, checkout });
    const photo = useHotelPhoto(hotel);
    const [photoFailed, setPhotoFailed] = useState(false);
    const description = (lang.startsWith('es') ? hotel.description.es : hotel.description.en)
        ?? hotel.description.en ?? hotel.description.es;

    const onOut = () => track('hotel_outbound_click', {
        hotel_id: hotel.id,
        hotel_name: hotel.name,
        region: hotel.region,
        surface,
        affiliate: isAffiliateLink(href),
        dated: Boolean(checkin && checkout),
        ...(providerId ? { provider_id: providerId } : {}),
        ...(distanceKm !== undefined ? { distance_km: Math.round(distanceKm * 10) / 10 } : {}),
    });

    return (
        <article className={`ms-hotel${compact ? ' ms-hotel--compact' : ''}`} data-hotel-id={hotel.id}>
            <div className="ms-hotel-photo ms-mono" style={{ ['--mono-h' as string]: `${hueOf(hotel.id)}deg` } as React.CSSProperties}>
                {photo && !photoFailed
                    ? <img src={photo.src} srcSet={photo.srcSet} alt="" loading="lazy" decoding="async" onError={() => setPhotoFailed(true)} />
                    : <span aria-hidden="true">{hotel.name.slice(0, 1).toUpperCase()}</span>}
            </div>
            <div className="ms-hotel-body">
                <h3 className="ms-hotel-name">{hotel.name}</h3>
                {hotel.rating != null && (
                    <p className="ms-hotel-rating">
                        <IconStar size={13} filled style={{ color: 'var(--star)' }} />
                        <strong>{hotel.rating.toFixed(1)}</strong>
                        {hotel.review_count != null && hotel.review_count > 0 && (
                            <span>{t('hotels.googleReviews', { count: hotel.review_count, formatted: hotel.review_count.toLocaleString(lang) })}</span>
                        )}
                    </p>
                )}
                <p className="ms-hotel-meta">
                    {hotel.price_band != null && (
                        <span title={t(`hotels.price.${hotel.price_band}`)} aria-label={t(`hotels.price.${hotel.price_band}`)}>
                            {'$'.repeat(hotel.price_band)}
                        </span>
                    )}
                    {distanceKm !== undefined ? (
                        <span>
                            <IconMapPin size={12} />{' '}
                            {fromName
                                ? t('hotels.distanceFrom', { distance: formatDistance(distanceKm, lang), name: fromName })
                                : formatDistance(distanceKm, lang)}
                        </span>
                    ) : hotel.address ? (
                        <span className="ms-hotel-address"><IconMapPin size={12} /> {hotel.address}</span>
                    ) : null}
                </p>
                {description && <p className="ms-hotel-desc">{description}</p>}
                {hotel.amenities.length > 0 && (
                    <ul className="ms-hotel-amenities" aria-label={t('hotels.amenitiesLabel')}>
                        {hotel.amenities.slice(0, compact ? 3 : undefined).map((a) => (
                            <li key={a}>{t(`hotels.amenity.${a}`)}</li>
                        ))}
                    </ul>
                )}
                {href && (
                    <a
                        className="ms-hotel-cta press"
                        href={href}
                        target="_blank"
                        rel={isAffiliateLink(href) ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
                        onClick={onOut}
                    >
                        {t('hotels.checkRates')} <IconArrowRight size={13} />
                    </a>
                )}
            </div>
        </article>
    );
}
