import { useTranslation } from 'react-i18next';
import { addDays, todayIso } from '../../utils/hotelLinks';

interface Props {
    checkin: string;
    checkout: string;
    onChange: (next: { checkin: string; checkout: string }) => void;
    /** For the label ids, when two date pickers share a page. */
    idPrefix: string;
}

/**
 * Check-in and check-out, as native date inputs (a phone shows its own
 * calendar). Moving check-in past check-out pushes check-out to the next day.
 */
export function StayDates({ checkin, checkout, onChange, idPrefix }: Props) {
    const { t } = useTranslation();
    const today = todayIso();
    const setIn = (v: string) => onChange({ checkin: v, checkout: v && (!checkout || checkout <= v) ? addDays(v, 1) : checkout });
    const setOut = (v: string) => onChange({ checkin, checkout: v });
    return (
        <div className="ms-stay-dates">
            <label htmlFor={`${idPrefix}-in`}>
                <span>{t('hotels.checkin')}</span>
                <input id={`${idPrefix}-in`} type="date" value={checkin} min={today} onChange={(e) => setIn(e.target.value)} />
            </label>
            <label htmlFor={`${idPrefix}-out`}>
                <span>{t('hotels.checkout')}</span>
                <input id={`${idPrefix}-out`} type="date" value={checkout} min={checkin ? addDays(checkin, 1) : addDays(today, 1)}
                    onChange={(e) => setOut(e.target.value)} />
            </label>
        </div>
    );
}
