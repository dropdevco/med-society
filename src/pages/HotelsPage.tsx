import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listHotels } from '../lib/hotelRead';
import { track } from '../lib/posthog';
import { useProvider } from '../hooks/useProvider';
import { HotelCard } from '../components/hotels/HotelCard';
import { HotelMap } from '../components/hotels/HotelMap';
import { HotelSkeleton } from '../components/hotels/HotelSkeleton';
import { StayDates } from '../components/hotels/StayDates';
import { validStay } from '../utils/hotelLinks';
import { HOTEL_AMENITIES, type Hotel, type HotelAmenity } from '../types/hotel';
import { distanceKm } from '../utils/geo';
import { isRegionId, readLastRegion, regionOf, REGIONS, writeLastRegion, type RegionId } from '../utils/region';

/**
 * /hotels?region=…[&near=<providerId>]: curated hotels in a region's Mexican
 * city, for patients travelling for treatment. Opened from a provider page it
 * sorts by distance from that provider.
 */
export function HotelsPage() {
    const { t, i18n } = useTranslation();
    const [params, setParams] = useSearchParams();
    const fromUrl = params.get('region');
    const region: RegionId = isRegionId(fromUrl) ? fromUrl : readLastRegion();
    const nearId = params.get('near') ?? undefined;
    const { provider: near } = useProvider(nearId);
    const city = REGIONS[region].mx.city;
    // Stay dates live in the URL (?checkin=&checkout=), so the homepage search and a shared link keep them.
    const stay = validStay(params.get('checkin'), params.get('checkout'));
    const [draftDates, setDraftDates] = useState({ checkin: stay?.checkin ?? '', checkout: stay?.checkout ?? '' });
    const setDates = (next: { checkin: string; checkout: string }) => {
        setDraftDates(next);
        const ok = validStay(next.checkin, next.checkout);
        const p = new URLSearchParams(params);
        if (ok) { p.set('checkin', ok.checkin); p.set('checkout', ok.checkout); } else { p.delete('checkin'); p.delete('checkout'); }
        setParams(p, { replace: true });
    };

    // Keyed by region: until this region's list arrives, the page is loading (null).
    const [loaded, setLoaded] = useState<{ region: RegionId; hotels: Hotel[]; failed: boolean } | null>(null);
    const hotels = loaded?.region === region ? loaded.hotels : null;
    const failed = loaded?.region === region && loaded.failed;
    const [price, setPrice] = useState<number | null>(null);
    const [amenity, setAmenity] = useState<HotelAmenity | null>(null);

    useEffect(() => { writeLastRegion(region); }, [region]);

    useEffect(() => {
        let live = true;
        listHotels(region)
            .then((rows) => { if (live) setLoaded({ region, hotels: rows, failed: false }); })
            .catch(() => { if (live) setLoaded({ region, hotels: [], failed: true }); });
        return () => { live = false; };
    }, [region]);

    useEffect(() => {
        const prev = document.title;
        document.title = `${t('hotels.pageTitle', { city })} | MedSociety`;
        return () => { document.title = prev; };
    }, [t, city, i18n.language]);

    // The near-provider only counts when it is in this region.
    const origin = near && (near.region ?? regionOf(near.lng)) === region ? near : null;

    const rows = useMemo(() => {
        const list = (hotels ?? [])
            .filter((h) => price === null || h.price_band === price)
            .filter((h) => amenity === null || h.amenities.includes(amenity))
            .map((h) => ({ hotel: h, km: origin ? distanceKm(origin.lat, origin.lng, h.lat, h.lng) : undefined }));
        if (origin) list.sort((a, b) => (a.km ?? 0) - (b.km ?? 0));
        return list;
    }, [hotels, price, amenity, origin]);

    // Stable inputs for the map, so it only redraws when what it shows changes.
    const mapHotels = useMemo(() => rows.map((r) => r.hotel), [rows]);
    const originId = origin?.id;
    const originLat = origin?.lat;
    const originLng = origin?.lng;
    const originName = origin?.name;
    const mapOrigin = useMemo(
        () => (originId && originLat != null && originLng != null ? { lat: originLat, lng: originLng, name: originName ?? '' } : null),
        [originId, originLat, originLng, originName],
    );

    // One impression per region (and origin) the list was shown for.
    const shownFor = useRef('');
    useEffect(() => {
        if (!hotels || hotels.length === 0) return;
        const key = `${region}:${origin?.id ?? ''}`;
        if (shownFor.current === key) return;
        shownFor.current = key;
        track('hotel_impression', {
            surface: 'hotels_page', region, count: hotels.length,
            ...(origin ? { provider_id: origin.id } : {}),
        });
    }, [hotels, region, origin]);

    // Only amenities some hotel here has are worth a filter chip.
    const amenitiesHere = HOTEL_AMENITIES.filter((a) => (hotels ?? []).some((h) => h.amenities.includes(a)));
    const pricesHere = [1, 2, 3, 4].filter((p) => (hotels ?? []).some((h) => h.price_band === p));

    const switchRegion = (r: RegionId) => {
        const next = new URLSearchParams(params);
        next.set('region', r);
        next.delete('near');
        setPrice(null);
        setAmenity(null);
        setParams(next, { replace: true });
    };

    return (
        <main id="main-content" className="ms-hotels-page">
            <header className="ms-hotels-hero">
                <h1>{t('hotels.pageTitle', { city })}</h1>
                <p>{t('hotels.pageSubtitle')}</p>
                <div className="ms-hotels-regions" role="group" aria-label={t('hotels.regionLabel')}>
                    {(Object.keys(REGIONS) as RegionId[]).map((r) => (
                        <button key={r} type="button" className={r === region ? 'on' : ''} aria-pressed={r === region} onClick={() => switchRegion(r)}>
                            {REGIONS[r].mx.city}
                        </button>
                    ))}
                </div>
                <div className="ms-hotels-datebar">
                    <StayDates idPrefix="hotels-page" checkin={draftDates.checkin} checkout={draftDates.checkout} onChange={setDates} />
                    <p>{stay ? t('hotels.datesSet') : t('hotels.datesHint')}</p>
                </div>
                {origin && (
                    <p className="ms-hotels-near">
                        {t('hotels.sortedNear', { name: origin.name })}{' '}
                        <Link to={`/providers/${origin.id}`}>{t('hotels.backToProvider')}</Link>
                    </p>
                )}
            </header>

            {(pricesHere.length > 1 || amenitiesHere.length > 0) && (
                <div className="ms-hotels-filters" role="group" aria-label={t('hotels.filtersLabel')}>
                    {pricesHere.length > 1 && pricesHere.map((p) => (
                        <button key={p} type="button" className={price === p ? 'on' : ''} aria-pressed={price === p}
                            title={t(`hotels.price.${p}`)} onClick={() => setPrice(price === p ? null : p)}>
                            {'$'.repeat(p)}
                        </button>
                    ))}
                    {amenitiesHere.map((a) => (
                        <button key={a} type="button" className={amenity === a ? 'on' : ''} aria-pressed={amenity === a}
                            onClick={() => setAmenity(amenity === a ? null : a)}>
                            {t(`hotels.amenity.${a}`)}
                        </button>
                    ))}
                </div>
            )}

            <div className="ms-hotels-body">
                <div className="ms-hotels-list" aria-live="polite" aria-busy={hotels === null}>
                    {hotels === null && (
                        <>
                            <span className="sr-only">{t('hotels.loading')}</span>
                            {Array.from({ length: 4 }).map((_, i) => <HotelSkeleton key={i} />)}
                        </>
                    )}
                    {hotels !== null && rows.length === 0 && (
                        <p className="ms-hotels-empty">
                            {failed ? t('hotels.error') : hotels.length === 0 ? t('hotels.emptyRegion', { city }) : t('hotels.emptyFiltered')}
                        </p>
                    )}
                    {rows.map(({ hotel, km }) => (
                        <HotelCard key={hotel.id} hotel={hotel} surface="hotels_page" distanceKm={km}
                            fromName={origin?.name} providerId={origin?.id} checkin={stay?.checkin} checkout={stay?.checkout} />
                    ))}
                    {rows.length > 0 && <p className="ms-hotel-disclosure">{t('hotels.disclosure')}</p>}
                </div>
                {rows.length > 0 && <HotelMap hotels={mapHotels} center={REGIONS[region].center} origin={mapOrigin} />}
            </div>
        </main>
    );
}
