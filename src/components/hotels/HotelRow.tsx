import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listHotels } from '../../lib/hotelRead';
import { track } from '../../lib/posthog';
import type { Hotel } from '../../types/hotel';
import { REGIONS, type RegionId } from '../../utils/region';
import { IconArrowRight } from '../icons/Icons';
import { HotelCard } from './HotelCard';
import { HotelSkeleton } from './HotelSkeleton';

const ROW_SIZE = 10;

/**
 * A homepage row of hotels near the clinics, in the same track as the
 * Discover rows. Renders nothing for a region with no published hotels, or
 * when hotels cannot be loaded: the doctors are the page, hotels are extra.
 */
export function HotelRow({ region }: { region: RegionId }) {
    const { t } = useTranslation();
    const [loaded, setLoaded] = useState<{ region: RegionId; hotels: Hotel[] } | null>(null);
    const hotels = loaded?.region === region ? loaded.hotels : null;
    const city = REGIONS[region].mx.city;

    useEffect(() => {
        let live = true;
        listHotels(region)
            .then((rows) => { if (live) setLoaded({ region, hotels: rows.slice(0, ROW_SIZE) }); })
            .catch(() => { if (live) setLoaded({ region, hotels: [] }); });
        return () => { live = false; };
    }, [region]);

    const shown = useRef('');
    useEffect(() => {
        if (!hotels || hotels.length === 0 || shown.current === region) return;
        shown.current = region;
        track('hotel_impression', { surface: 'home', region, count: hotels.length, ids: hotels.map((h) => h.id).join(',') });
    }, [hotels, region]);

    if (hotels !== null && hotels.length === 0) return null;
    const all = `/hotels?region=${region}`;

    return (
        <section className="ms-row ms-hotel-row" aria-labelledby="home-hotels-title">
            <div className="ms-hotel-row-head">
                <h2 id="home-hotels-title" className="ms-row-title">
                    <Link to={all}>{t('hotels.rowTitle', { city })} <IconArrowRight size={16} /></Link>
                </h2>
                <p>{t('hotels.rowSubtitle')}</p>
            </div>
            <div className="ms-row-track">
                {hotels === null
                    ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="ms-row-cell"><HotelSkeleton /></div>)
                    : hotels.map((h) => (
                        <div key={h.id} className="ms-row-cell">
                            <HotelCard hotel={h} surface="home" compact />
                        </div>
                    ))}
            </div>
        </section>
    );
}
