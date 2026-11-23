import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { listHotels, type HotelCountry } from '../../lib/hotelRead';
import { track } from '../../lib/posthog';
import type { Hotel } from '../../types/hotel';
import { REGIONS, type RegionId } from '../../utils/region';
import { IconArrowRight } from '../icons/Icons';
import { HotelCard } from './HotelCard';
import { HotelSkeleton } from './HotelSkeleton';

const ROW_SIZE = 10;

/**
 * A homepage row of hotels, in the same track as the Discover rows: near the
 * clinics in Mexico, or on the US side for patients who cross for the day. Renders nothing for a region with no published hotels, or
 * when hotels cannot be loaded: the doctors are the page, hotels are extra.
 */
export function HotelRow({ region, side = 'mx' }: { region: RegionId; side?: 'mx' | 'us' }) {
    const { t } = useTranslation();
    const country: HotelCountry = side === 'us' ? 'US' : 'MX';
    const key = `${region}:${side}`;
    const [loaded, setLoaded] = useState<{ key: string; hotels: Hotel[] } | null>(null);
    const hotels = loaded?.key === key ? loaded.hotels : null;
    const city = REGIONS[region][side].city;

    useEffect(() => {
        let live = true;
        listHotels(region, country)
            .then((rows) => { if (live) setLoaded({ key, hotels: rows.slice(0, ROW_SIZE) }); })
            .catch(() => { if (live) setLoaded({ key, hotels: [] }); });
        return () => { live = false; };
    }, [region, country, key]);

    const shown = useRef('');
    useEffect(() => {
        if (!hotels || hotels.length === 0 || shown.current === key) return;
        shown.current = key;
        track('hotel_impression', { surface: 'home', region, side, count: hotels.length, ids: hotels.map((h) => h.id).join(',') });
    }, [hotels, region, side, key]);

    if (hotels !== null && hotels.length === 0) return null;
    const all = `/hotels?region=${region}${side === 'us' ? '&side=us' : ''}`;

    return (
        <section className="ms-row ms-hotel-row" aria-labelledby={`home-hotels-title-${side}`}>
            <div className="ms-hotel-row-head">
                <h2 id={`home-hotels-title-${side}`} className="ms-row-title">
                    <Link to={all}>{t(side === 'us' ? 'hotels.rowTitleUs' : 'hotels.rowTitle', { city })} <IconArrowRight size={16} /></Link>
                </h2>
                <p>{t(side === 'us' ? 'hotels.rowSubtitleUs' : 'hotels.rowSubtitle')}</p>
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
