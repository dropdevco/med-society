import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Live fares are off unless this is set; off means nothing the visitor types leaves the page. */
export const FARES_ON = import.meta.env.VITE_FLIGHT_FARES === 'on';

interface Props { from: string | null; to: string; depart: string; ret: string }
interface Fare { price: number }

/**
 * "Recently seen from $X" under the search box, from /api/flight-fares. Shown
 * only once airports and a departure date are chosen, and silent when there is
 * no fare: most thin routes have none.
 */
export function RecentFare({ from, to, depart, ret }: Props) {
    const { t, i18n } = useTranslation();
    const key = from && depart ? new URLSearchParams({ from, to, depart, ...(ret ? { return: ret } : {}) }).toString() : '';
    // Keyed by the query, so an old answer is never shown beside new choices.
    const [found, setFound] = useState<{ key: string; fare: Fare } | null>(null);

    useEffect(() => {
        if (!FARES_ON || !key) return;
        const abort = new AbortController();
        const wait = setTimeout(() => {
            fetch(`/api/flight-fares?${key}`, { signal: abort.signal })
                .then((r) => (r.ok ? r.json() : null))
                .then((b: { fare?: Fare | null } | null) => { if (b?.fare) setFound({ key, fare: b.fare }); })
                .catch(() => { /* no fare line is the right answer */ });
        }, 500);
        return () => { clearTimeout(wait); abort.abort(); };
    }, [key]);

    if (!FARES_ON || !found || found.key !== key) return null;
    const price = new Intl.NumberFormat(i18n.language.startsWith('es') ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(found.fare.price);
    return (
        <p className="ms-flight-fare" role="status">
            <b>{t('flights.fareFrom', { price })}</b>
            <small>{t('flights.fareNote')}</small>
        </p>
    );
}
