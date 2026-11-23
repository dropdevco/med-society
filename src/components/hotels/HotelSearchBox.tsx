import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { RegionId } from '../../utils/region';
import { DEFAULT_OCCUPANCY, validStay, type Occupancy } from '../../utils/hotelLinks';
import { track } from '../../lib/posthog';
import { IconSearch } from '../icons/Icons';
import { StayDates } from './StayDates';
import { WherePicker } from './WherePicker';
import { GuestsPicker } from './GuestsPicker';

/**
 * The homepage's Hotels tab: which city, which nights, then /hotels with both.
 * Dates are optional; without them the list still opens and Booking.com asks
 * for dates itself.
 */
export function HotelSearchBox({ region }: { region: RegionId }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    // "sandiego-tijuana" = stay in Tijuana; "sandiego-tijuana:us" = stay in San Diego and cross.
    const [where, setWhere] = useState<string>(region);
    const [dates, setDates] = useState({ checkin: '', checkout: '' });
    const [guests, setGuests] = useState<Occupancy>(DEFAULT_OCCUPANCY);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const [city, side] = where.split(':') as [RegionId, 'us' | undefined];
        const p = new URLSearchParams({ region: city });
        if (side === 'us') p.set('side', 'us');
        const stay = validStay(dates.checkin, dates.checkout);
        if (stay) { p.set('checkin', stay.checkin); p.set('checkout', stay.checkout); }
        p.set('adults', String(guests.adults)); p.set('children', String(guests.children)); p.set('rooms', String(guests.rooms));
        track('search_performed', { vertical: 'hotels', region: city, side: side ?? 'mx', dated: Boolean(stay) });
        navigate(`/hotels?${p.toString()}`);
    };

    return (
        <form className="ms-hotel-search" role="search" aria-label={t('hotels.searchLabel')} onSubmit={submit}>
            <WherePicker value={where} onChange={setWhere} />
            <StayDates idPrefix="hotel-search" checkin={dates.checkin} checkout={dates.checkout} onChange={setDates} />
            <GuestsPicker value={guests} onChange={setGuests} />
            <button type="submit" className="ms-hotel-search-btn press">
                <IconSearch size={16} weight={2} /> {t('hotels.searchButton')}
            </button>
        </form>
    );
}
