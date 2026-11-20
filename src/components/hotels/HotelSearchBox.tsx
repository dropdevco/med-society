import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { REGIONS, type RegionId } from '../../utils/region';
import { validStay } from '../../utils/hotelLinks';
import { track } from '../../lib/posthog';
import { IconSearch } from '../icons/Icons';
import { StayDates } from './StayDates';

/**
 * The homepage's Hotels tab: which city, which nights, then /hotels with both.
 * Dates are optional; without them the list still opens and Booking.com asks
 * for dates itself.
 */
export function HotelSearchBox({ region }: { region: RegionId }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [city, setCity] = useState<RegionId>(region);
    const [dates, setDates] = useState({ checkin: '', checkout: '' });

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const p = new URLSearchParams({ region: city });
        const stay = validStay(dates.checkin, dates.checkout);
        if (stay) { p.set('checkin', stay.checkin); p.set('checkout', stay.checkout); }
        track('search_performed', { vertical: 'hotels', region: city, dated: Boolean(stay) });
        navigate(`/hotels?${p.toString()}`);
    };

    return (
        <form className="ms-hotel-search" role="search" aria-label={t('hotels.searchLabel')} onSubmit={submit}>
            <label className="ms-hotel-search-city" htmlFor="hotel-search-city">
                <span>{t('hotels.whereLabel')}</span>
                <select id="hotel-search-city" value={city} onChange={(e) => setCity(e.target.value as RegionId)}>
                    {(Object.keys(REGIONS) as RegionId[]).map((r) => (
                        <option key={r} value={r}>{REGIONS[r].mx.city}</option>
                    ))}
                </select>
            </label>
            <StayDates idPrefix="hotel-search" checkin={dates.checkin} checkout={dates.checkout} onChange={setDates} />
            <button type="submit" className="ms-hotel-search-btn press">
                <IconSearch size={16} weight={2} /> {t('hotels.searchButton')}
            </button>
        </form>
    );
}
