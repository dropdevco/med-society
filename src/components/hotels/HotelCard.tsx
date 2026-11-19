import { useTranslation } from 'react-i18next';
import type { Hotel } from '../../types/hotel';
import { bookingHref, formatDistance, isAffiliateLink } from '../../utils/hotelLinks';
import { track } from '../../lib/posthog';
import { hueOf } from '../../utils/images';
import { IconStar, IconMapPin, IconArrowRight } from '../icons/Icons';

export type HotelSurface = 'provider_page' | 'hotels_page';

interface Props {
    hotel: Hotel;
    surface: HotelSurface;
    /** Shown as "1.2 km from {fromName}" when both are given. */
    distanceKm?: number;
    fromName?: string;
    /** The provider page this card sits on, for analytics. */
    providerId?: string;
    compact?: boolean;
}

/** One hotel: photo, name, price, amenities and the outbound "Check rates" link. */
export function HotelCard({ hotel, surface, distanceKm, fromName, providerId, compact }: Props) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language;
    const href = bookingHref(hotel, { lang });
    const description = (lang.startsWith('es') ? hotel.description.es : hotel.description.en)
        ?? hotel.description.en ?? hotel.description.es;

    const onOut = () => track('hotel_outbound_click', {
        hotel_id: hotel.id,
        hotel_name: hotel.name,
        region: hotel.region,
        surface,
        affiliate: isAffiliateLink(href),
        ...(providerId ? { provider_id: providerId } : {}),
        ...(distanceKm !== undefined ? { distance_km: Math.round(distanceKm * 10) / 10 } : {}),
    });

    return (
        <article className={`ms-hotel${compact ? ' ms-hotel--compact' : ''}`} data-hotel-id={hotel.id}>
            <div className="ms-hotel-photo ms-mono" style={{ ['--mono-h' as string]: `${hueOf(hotel.id)}deg` } as React.CSSProperties}>
                {hotel.photo_url ? <img src={hotel.photo_url} alt="" loading="lazy" /> : hotel.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="ms-hotel-body">
                <h3 className="ms-hotel-name">{hotel.name}</h3>
                <p className="ms-hotel-meta">
                    {hotel.rating != null && (
                        <span><IconStar size={12} filled style={{ color: 'var(--star)' }} /> {hotel.rating.toFixed(1)}</span>
                    )}
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
                        <span><IconMapPin size={12} /> {hotel.address}</span>
                    ) : null}
                </p>
                {!compact && description && <p className="ms-hotel-desc">{description}</p>}
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
