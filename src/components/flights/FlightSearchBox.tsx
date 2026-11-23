import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RegionId } from '../../utils/region';
import { DEFAULT_OCCUPANCY, type Occupancy } from '../../utils/hotelLinks';
import {
    FLIGHT_DESTINATIONS, ORIGIN_AIRPORTS, earnsFlightCommission, flightHref, parseAirport, suggestedTrip,
} from '../../utils/flightLinks';
import { track } from '../../lib/posthog';
import { IconSearch } from '../icons/Icons';
import { StayDates } from '../hotels/StayDates';
import { GuestsPicker } from '../hotels/GuestsPicker';

/**
 * The homepage's Flights tab. We never show fares or sell tickets: this opens
 * the partner's results (flightLinks.ts) in a new tab. Nothing typed here is
 * stored or sent to us; the analytics event carries only the airports and
 * whether it was a round trip.
 */
export function FlightSearchBox({ region }: { region: RegionId }) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language.startsWith('es') ? 'es' : 'en';
    const listId = useId();
    const [from, setFrom] = useState('');
    const [to, setTo] = useState(() => FLIGHT_DESTINATIONS.find((d) => d.region === region && d.side === 'us')?.code ?? 'SAN');
    const [dates, setDates] = useState({ checkin: '', checkout: '' });
    const [pax, setPax] = useState<Occupancy>({ ...DEFAULT_OCCUPANCY, children: 0, rooms: 1 });
    const [error, setError] = useState('');
    const dest = FLIGHT_DESTINATIONS.find((d) => d.code === to) ?? FLIGHT_DESTINATIONS[0];

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const origin = parseAirport(from);
        if (!origin) { setError(t('flights.badFrom')); return; }
        // No date picked yet: suggest the usual two-week-out trip rather than refuse.
        const trip = dates.checkin ? { depart: dates.checkin, ret: dates.checkout } : suggestedTrip();
        const href = flightHref({ from: origin, to, depart: trip.depart, ret: trip.ret, adults: pax.adults });
        if (!href) { setError(t('flights.badDates')); return; }
        setError('');
        track('flight_search', {
            from: origin, to, round_trip: Boolean(trip.ret), adults: pax.adults,
            dated: Boolean(dates.checkin), earns: earnsFlightCommission(href),
        });
        window.open(href, '_blank', 'noopener,noreferrer');
    };

    return (
        <div className="ms-flight-search-wrap">
            <form className="ms-hotel-search ms-flight-search" role="search" aria-label={t('flights.searchLabel')} onSubmit={submit}>
                <label>
                    <span>{t('flights.from')}</span>
                    <input
                        type="text"
                        value={from}
                        list={listId}
                        placeholder={t('flights.fromPlaceholder')}
                        autoComplete="off"
                        autoCapitalize="characters"
                        aria-invalid={Boolean(error)}
                        onChange={(e) => { setFrom(e.target.value); setError(''); }}
                    />
                    <datalist id={listId}>
                        {ORIGIN_AIRPORTS.map(([code, city]) => <option key={code} value={`${city} (${code})`} />)}
                    </datalist>
                </label>
                <label>
                    <span>{t('flights.to')}</span>
                    <select value={to} onChange={(e) => setTo(e.target.value)}>
                        {FLIGHT_DESTINATIONS.map((d) => (
                            <option key={d.code} value={d.code}>{d.city[lang]} ({d.code})</option>
                        ))}
                    </select>
                </label>
                <StayDates idPrefix="flight-search" kind="trip" checkin={dates.checkin} checkout={dates.checkout} onChange={setDates} />
                <GuestsPicker value={pax} onChange={(g) => setPax({ ...pax, adults: g.adults })} adultsOnly />
                <button type="submit" className="ms-hotel-search-btn press">
                    <IconSearch size={16} weight={2} /> {t('flights.searchButton')}
                </button>
            </form>
            {error && <p className="ms-flight-error" role="alert">{error}</p>}
            <p className="ms-flight-note">
                <span><b>{t('flights.next')}:</b> {dest.next[lang]}</span>
                <span>{t('flights.disclosure')}</span>
            </p>
        </div>
    );
}
