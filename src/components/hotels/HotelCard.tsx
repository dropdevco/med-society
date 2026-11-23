import { useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { Hotel } from '../../types/hotel';
import { bookingHref, isAffiliateLink } from '../../utils/hotelLinks';
import { placePhotoProxyState, placePhotoUrl, subscribePlacePhotoProxy } from '../../utils/placePhoto';
import { track } from '../../lib/posthog';
import { hueOf } from '../../utils/images';

export type HotelSurface = 'provider_page' | 'hotels_page' | 'home';

interface Props {
    hotel: Hotel;
    surface: HotelSurface;
    /** Kept for analytics only: the tile itself shows just the photo and the name. */
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

/**
 * One hotel as a photo tile: the picture, the name over it, nothing else. The
 * whole tile is the link out ("Check rates" on Booking.com), so the rating,
 * price and distance live on the Hotels page, not on the tile.
 */
export function HotelCard({ hotel, surface, distanceKm, providerId, checkin, checkout, compact }: Props) {
    const { t, i18n } = useTranslation();
    const href = bookingHref(hotel, { lang: i18n.language, checkin, checkout });
    const photo = useHotelPhoto(hotel);
    const [photoFailed, setPhotoFailed] = useState(false);

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

    const inner = (
        <>
            {photo && !photoFailed
                ? <img src={photo.src} srcSet={photo.srcSet} alt="" loading="lazy" decoding="async" onError={() => setPhotoFailed(true)} />
                : <span className="ms-hotel-mono" aria-hidden="true">{hotel.name.slice(0, 1).toUpperCase()}</span>}
            <span className="ms-hotel-shade" aria-hidden="true" />
            <h3 className="ms-hotel-name">{hotel.name}</h3>
        </>
    );
    const cls = `ms-hotel${compact ? ' ms-hotel--compact' : ''}`;
    const style = { ['--mono-h' as string]: `${hueOf(hotel.id)}deg` } as React.CSSProperties;

    return href ? (
        <a
            className={cls}
            style={style}
            data-hotel-id={hotel.id}
            href={href}
            target="_blank"
            rel={isAffiliateLink(href) ? 'sponsored noopener noreferrer' : 'noopener noreferrer'}
            onClick={onOut}
            aria-label={`${hotel.name} – ${t('hotels.checkRates')}`}
        >
            {inner}
        </a>
    ) : (
        <div className={cls} style={style} data-hotel-id={hotel.id}>{inner}</div>
    );
}
