import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RegionId } from '../../utils/region';
import {
    FLIGHT_DESTINATIONS, earnsFlightCommission, flightHref, parseAirport, suggestedTrip, type Travellers,
} from '../../utils/flightLinks';
import { track } from '../../lib/posthog';
import { IconSearch } from '../icons/Icons';
import { StayDates } from '../hotels/StayDates';
import { TravellersPicker } from './TravellersPicker';
import { FARES_ON, RecentFare } from './RecentFare';
import { AirportPicker } from './AirportPicker';
import { OriginInput } from './OriginInput';

/**
 * The homepage's Flights tab. We never show fares or sell tickets: this opens
 * the partner's results (flightLinks.ts) in a new tab. Nothing typed here is
 * stored; the analytics event carries only the airports, passenger counts and
 * whether it was a round trip. With VITE_FLIGHT_FARES=on the airports and dates
 * are also sent to /api/flight-fares to show a recently seen fare (RecentFare).
 */
export function FlightSearchBox({ region }: { region: RegionId }) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language.startsWith('es') ? 'es' : 'en';
    const [from, setFrom] = useState('');
    const [to, setTo] = useState(() => FLIGHT_DESTINATIONS.find((d) => d.region === region && d.side === 'us')?.code ?? 'SAN');
    const [dates, setDates] = useState({ checkin: '', checkout: '' });
    const [pax, setPax] = useState<Travellers>({ adults: 2, children: 0, infants: 0 });
    const [error, setError] = useState('');
    const dest = FLIGHT_DESTINATIONS.find((d) => d.code === to) ?? FLIGHT_DESTINATIONS[0];

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const origin = parseAirport(from);
        if (!origin) { setError(t('flights.badFrom')); return; }
        // No date picked yet: suggest the usual two-week-out trip rather than refuse.
        const trip = dates.checkin ? { depart: dates.checkin, ret: dates.checkout } : suggestedTrip();
        const href = flightHref({ from: origin, to, depart: trip.depart, ret: trip.ret, ...pax });
        if (!href) { setError(t('flights.badDates')); return; }
        setError('');
        track('flight_search', {
            from: origin, to, round_trip: Boolean(trip.ret), ...pax,
            dated: Boolean(dates.checkin), earns: earnsFlightCommission(href),
        });
        window.open(href, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="ms-flight-search-wrap">
            <form className="ms-hotel-search ms-flight-search" role="search" aria-label={t('flights.searchLabel')} onSubmit={submit}>
                <OriginInput value={from} onChange={(v) => { setFrom(v); setError(''); }} invalid={Boolean(error)} />
                <AirportPicker value={to} onChange={setTo} />
                <StayDates idPrefix="flight-search" kind="trip" checkin={dates.checkin} checkout={dates.checkout} onChange={setDates} />
                <TravellersPicker value={pax} onChange={setPax} />
                <button type="submit" className="ms-hotel-search-btn press">
                    <IconSearch size={16} weight={2} /> {t('flights.searchButton')}
                </button>
            </form>
            {error && <p className="ms-flight-error" role="alert">{error}</p>}
            <RecentFare from={parseAirport(from)} to={to} depart={dates.checkin} ret={dates.checkout} />
            <p className="ms-flight-note">
                <span><b>{t('flights.next')}:</b> {dest.next[lang]}</span>
                <span>{t(FARES_ON ? 'flights.disclosureFares' : 'flights.disclosure')}</span>
            </p>
        </div>
    );
}
