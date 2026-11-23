import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { todayIso } from '../../utils/hotelLinks';
import { IconChevronLeft, IconChevronRight } from '../icons/Icons';

interface Props {
    checkin: string;
    checkout: string;
    onChange: (next: { checkin: string; checkout: string }) => void;
    /** For the label ids, when two date pickers share a page. */
    idPrefix: string;
    /** 'trip' = depart/return wording for flights; the dates may be one way (no return). */
    kind?: 'stay' | 'trip';
}

const pad = (n: number) => String(n).padStart(2, '0');
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const addMonths = (iso: string, n: number) => {
    const d = new Date(`${monthStart(iso)}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`;
};
const nightsBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** The cells of one month: blanks up to the first weekday (Sunday first), then each day as an ISO date. */
function monthCells(first: string): (string | null)[] {
    const d = new Date(`${first}T00:00:00Z`);
    const lead = d.getUTCDay();
    const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${first.slice(0, 8)}${pad(i + 1)}`)];
}

/**
 * Check-in and check-out as one range calendar in a popover: the first click
 * is check-in, the second is check-out, a click at or before check-in starts
 * over. Past days are off. Two months side by side on a wide screen, one on a
 * phone (CSS). Escape or a click outside closes it.
 */
export function StayDates({ checkin, checkout, onChange, idPrefix, kind = 'stay' }: Props) {
    const { t: tr, i18n } = useTranslation();
    // Flights reuse this calendar with their own words (flights.*); hotels keep hotels.*.
    const t = (key: string, opts?: Record<string, unknown>) =>
        tr(kind === 'trip' && key !== 'hotels.prevMonth' && key !== 'hotels.nextMonth' && key !== 'hotels.addDate' && key !== 'hotels.clearDates'
            ? key.replace('hotels.', 'flights.') : key, opts);
    const locale = i18n.language.startsWith('es') ? 'es-MX' : 'en-US';
    const id = useId();
    const today = todayIso();
    const root = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [picking, setPicking] = useState<'in' | 'out'>('in');
    const [view, setView] = useState(monthStart(checkin || today));
    const [hover, setHover] = useState('');

    useEffect(() => {
        if (!open) return;
        const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', outside);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
    }, [open]);

    const show = (mode: 'in' | 'out') => {
        const out = mode === 'out' && Boolean(checkin);
        setPicking(out ? 'out' : 'in');
        setView(monthStart(out ? checkin : (checkin || today)));
        setOpen(true);
    };

    const pickDay = (d: string) => {
        if (picking === 'out' && checkin && d > checkin) {
            onChange({ checkin, checkout: d });
            setOpen(false);
            return;
        }
        onChange({ checkin: d, checkout: '' });
        setPicking('out');
    };

    const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...opts }).format(new Date(`${iso}T00:00:00Z`));
    const short = (iso: string) => fmt(iso, { weekday: 'short', month: 'short', day: 'numeric' });
    // 2026-11-01 is a Sunday: its first seven days are Sunday to Saturday.
    const weekdays = Array.from({ length: 7 }, (_, i) => fmt(`2026-11-0${i + 1}`, { weekday: 'narrow' }));
    const end = picking === 'out' && checkin && !checkout ? hover : checkout;
    const hasRange = Boolean(checkin && end && end > checkin);
    const inRange = (d: string) => hasRange && d > checkin && d < end;
    const canGoBack = view > monthStart(today);
    const nights = checkin && checkout ? nightsBetween(checkin, checkout) : 0;
    const months = [view, addMonths(view, 1)];

    const field = (kind: 'in' | 'out', value: string, label: string) => (
        <div className="ms-stay-field">
            <span id={`${id}-${kind}-l`}>{label}</span>
            <button
                type="button"
                id={`${idPrefix}-${kind}`}
                className={`ms-stay-btn${open && picking === kind ? ' is-on' : ''}`}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-labelledby={`${id}-${kind}-l ${idPrefix}-${kind}`}
                onClick={() => show(kind)}
            >
                {value ? short(value) : <em>{t('hotels.addDate')}</em>}
            </button>
        </div>
    );

    return (
        <div className="ms-stay-dates" ref={root}>
            {field('in', checkin, t('hotels.checkin'))}
            {field('out', checkout, t('hotels.checkout'))}
            {open && (
                <div className="ms-cal" role="dialog" aria-label={t('hotels.chooseDates')} onMouseLeave={() => setHover('')}>
                    <div className="ms-cal-top">
                        <h3>{t('hotels.calTitle')}</h3>
                        <p>{t(picking === 'out' && checkin ? 'hotels.pickCheckout' : 'hotels.pickCheckin')}</p>
                    </div>
                    <button type="button" className="ms-cal-nav ms-cal-prev" aria-label={t('hotels.prevMonth')} disabled={!canGoBack}
                        onClick={() => setView(addMonths(view, -1))}><IconChevronLeft size={16} /></button>
                    <button type="button" className="ms-cal-nav ms-cal-next" aria-label={t('hotels.nextMonth')}
                        onClick={() => setView(addMonths(view, 1))}><IconChevronRight size={16} /></button>
                    <div className="ms-cal-months">
                        {months.map((m, mi) => (
                            <div key={m} className={`ms-cal-month${mi === 1 ? ' ms-cal-second' : ''}`}>
                                <b className="ms-cal-title">{fmt(m, { month: 'long', year: 'numeric' })}</b>
                                <div className="ms-cal-grid">
                                    {weekdays.map((w, i) => <span key={i} className="ms-cal-dow" aria-hidden="true">{w}</span>)}
                                    {monthCells(m).map((d, i) => d === null ? <span key={`b${i}`} /> : (
                                        <button
                                            key={d}
                                            type="button"
                                            disabled={d < today}
                                            aria-label={fmt(d, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                            aria-pressed={d === checkin || d === checkout}
                                            className={`ms-cal-day${d === checkin ? ' is-start' : ''}${d === end && hasRange ? ' is-end' : ''}${d === checkin && hasRange ? ' band-right' : ''}${d === end && hasRange ? ' band-left' : ''}${inRange(d) ? ' is-range' : ''}${d === today ? ' is-today' : ''}`}
                                            onMouseEnter={() => setHover(d)}
                                            onClick={() => pickDay(d)}
                                        >
                                            <span>{Number(d.slice(8))}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="ms-cal-foot">
                        <span className={`ms-cal-sum${nights > 0 ? ' is-set' : ''}`}>
                            {nights > 0 ? `${t('hotels.nights', { count: nights })} · ${short(checkin)} → ${short(checkout)}` : t('hotels.noDates')}
                        </span>
                        {(checkin || checkout) && (
                            <button type="button" className="ms-cal-clear" onClick={() => { onChange({ checkin: '', checkout: '' }); setPicking('in'); }}>
                                {t('hotels.clearDates')}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
