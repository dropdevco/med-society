import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import type { NearbyHotel } from '../../types/hotel';
import { hotelsNear } from '../../lib/hotelRead';
import { track } from '../../lib/posthog';
import { regionOf, REGIONS } from '../../utils/region';
import { HotelCard } from './HotelCard';

/** How far from a clinic a hotel still counts as "nearby". */
const NEARBY_KM = 8;
const SHOWN = 3;
const NONE: NearbyHotel[] = [];

/**
 * On a provider's page in Mexico: the closest curated hotels, for patients who
 * travel for treatment. Renders nothing on the US side, while loading, on an
 * error, or when no published hotel is close enough.
 */
export function StayNearby({ provider }: { provider: Provider }) {
    const { t } = useTranslation();
    // Keyed by provider, so moving to another profile never shows the last one's hotels.
    const [found, setFound] = useState<{ for: string; hotels: NearbyHotel[] }>({ for: '', hotels: [] });
    const hotels = found.for === provider.id ? found.hotels : NONE;
    const region = regionOf(provider.lng);
    const eligible = provider.country === 'MX' && region !== null && Number.isFinite(provider.lat);

    useEffect(() => {
        if (!eligible) return;
        let live = true;
        hotelsNear(provider.lat, provider.lng, SHOWN, NEARBY_KM)
            .then((rows) => { if (live) setFound({ for: provider.id, hotels: rows }); })
            .catch(() => { /* hotels are extra; the profile stands without them */ });
        return () => { live = false; };
    }, [eligible, provider.id, provider.lat, provider.lng]);

    // One impression per provider page that showed hotels.
    const shown = useRef('');
    useEffect(() => {
        if (hotels.length === 0 || shown.current === provider.id) return;
        shown.current = provider.id;
        track('hotel_impression', {
            surface: 'provider_page',
            provider_id: provider.id,
            region,
            ids: hotels.map((h) => h.id).join(','),
            count: hotels.length,
        });
    }, [hotels, provider.id, region]);

    if (!eligible || !region || hotels.length === 0) return null;
    const city = REGIONS[region].mx.city;

    return (
        <section className="ms-stay" aria-labelledby="stay-title">
            <div className="ms-stay-head">
                <h2 id="stay-title">{t('hotels.stayNearby')}</h2>
                <Link to={`/hotels?region=${region}&near=${provider.id}`} className="ms-stay-all">
                    {t('hotels.seeAll', { city })}
                </Link>
            </div>
            <div className="ms-stay-list">
                {hotels.map((h) => (
                    <HotelCard
                        key={h.id}
                        hotel={h}
                        surface="provider_page"
                        distanceKm={h.distanceKm}
                        fromName={provider.name}
                        providerId={provider.id}
                        compact
                    />
                ))}
            </div>
            <p className="ms-hotel-disclosure">{t('hotels.disclosure')}</p>
        </section>
    );
}
