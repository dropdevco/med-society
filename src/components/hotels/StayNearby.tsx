import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import type { NearbyHotel } from '../../types/hotel';
import { hotelsNear } from '../../lib/hotelRead';
import { track } from '../../lib/posthog';
import { regionOf, REGIONS } from '../../utils/region';
import { formatCrossingDistance, nearestCrossing } from '../../utils/borderCrossings';
import { HotelCard } from './HotelCard';

/** How far from a clinic a hotel still counts as "nearby". */
const NEARBY_KM = 8;
/** The US option only appears when a crossing is within this many km of the clinic. */
const CROSSING_MAX_KM = 30;
const US_SHOWN = 2;
const US_RADIUS_KM = 10;
const SHOWN = 3;
const NONE: NearbyHotel[] = [];

/**
 * On a provider's page in Mexico: the closest curated hotels, for patients who
 * travel for treatment, then a smaller group on the US side for those who
 * would rather cross for the day. Renders nothing on the US side, while loading, on an
 * error, or when no published hotel is close enough.
 */
export function StayNearby({ provider }: { provider: Provider }) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language.startsWith('es') ? 'es' : 'en';
    // Keyed by provider, so moving to another profile never shows the last one's hotels.
    const [found, setFound] = useState<{ for: string; hotels: NearbyHotel[] }>({ for: '', hotels: [] });
    const hotels = found.for === provider.id ? found.hotels : NONE;
    const region = regionOf(provider.lng);
    const eligible = provider.country === 'MX' && region !== null && Number.isFinite(provider.lat);
    const nearest = eligible && region ? nearestCrossing(provider, region) : null;
    const usUseful = nearest !== null && nearest.km <= CROSSING_MAX_KM;
    const [foundUs, setFoundUs] = useState<{ for: string; hotels: NearbyHotel[] }>({ for: '', hotels: [] });
    const usHotels = foundUs.for === provider.id ? foundUs.hotels : NONE;
    const crossingId = nearest?.crossing.id;

    useEffect(() => {
        if (!eligible) return;
        let live = true;
        hotelsNear(provider.lat, provider.lng, SHOWN, NEARBY_KM, 'MX')
            .then((rows) => { if (live) setFound({ for: provider.id, hotels: rows }); })
            .catch(() => { /* hotels are extra; the profile stands without them */ });
        return () => { live = false; };
    }, [eligible, provider.id, provider.lat, provider.lng]);

    // The US-side hotels closest to the crossing this clinic is nearest to.
    useEffect(() => {
        if (!eligible || !usUseful || !region) return;
        const c = nearestCrossing({ lat: provider.lat, lng: provider.lng }, region).crossing;
        let live = true;
        hotelsNear(c.lat, c.lng, US_SHOWN, US_RADIUS_KM, 'US')
            .then((rows) => { if (live) setFoundUs({ for: provider.id, hotels: rows }); })
            .catch(() => { /* extra, like the rest */ });
        return () => { live = false; };
    }, [eligible, usUseful, region, crossingId, provider.id, provider.lat, provider.lng]);

    // One impression per provider page that showed hotels.
    const shown = useRef('');
    useEffect(() => {
        if (hotels.length === 0 || shown.current === provider.id) return;
        shown.current = provider.id;
        track('hotel_impression', {
            surface: 'provider_page',
            provider_id: provider.id,
            region,
            side: 'mx',
            ids: hotels.map((h) => h.id).join(','),
            count: hotels.length,
        });
    }, [hotels, provider.id, region]);

    const shownUs = useRef('');
    useEffect(() => {
        if (usHotels.length === 0 || shownUs.current === provider.id) return;
        shownUs.current = provider.id;
        track('hotel_impression', {
            surface: 'provider_page', provider_id: provider.id, region, side: 'us',
            ids: usHotels.map((h) => h.id).join(','), count: usHotels.length,
        });
    }, [usHotels, provider.id, region]);

    if (!eligible || !region || (hotels.length === 0 && usHotels.length === 0)) return null;
    const city = REGIONS[region].mx.city;
    const usCity = REGIONS[region].us.city;

    return (
        <section className="ms-stay" aria-labelledby="stay-title">
            {hotels.length > 0 && (
                <>
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
                </>
            )}
            {usHotels.length > 0 && nearest && (
                <>
                    <div className="ms-stay-head">
                        <h2 id={hotels.length === 0 ? 'stay-title' : undefined}>{t('hotels.stayUs', { city: usCity })}</h2>
                        <Link to={`/hotels?region=${region}&side=us&near=${provider.id}`} className="ms-stay-all">
                            {t('hotels.seeAllUs', { city: usCity })}
                        </Link>
                    </div>
                    <p className="ms-stay-note">
                        {t('hotels.crossingFromClinic', {
                            crossing: nearest.crossing.label[lang],
                            distance: formatCrossingDistance(nearest.km, lang),
                        })}
                    </p>
                    <div className="ms-stay-list">
                        {usHotels.map((h) => (
                            <HotelCard key={h.id} hotel={h} surface="provider_page" providerId={provider.id} compact />
                        ))}
                    </div>
                </>
            )}
            <p className="ms-hotel-disclosure">{t('hotels.disclosure')}</p>
        </section>
    );
}
