import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OCCUPANCY_LIMITS, validOccupancy, type Occupancy } from '../../utils/hotelLinks';
import { IconChevronDown } from '../icons/Icons';

interface Props {
    value: Occupancy;
    onChange: (next: Occupancy) => void;
    /** The slimmer button used in the /hotels header. */
    compact?: boolean;
}

type Kind = keyof Occupancy;

/**
 * Adults, children and rooms in one popover with +/- steppers, like a booking
 * site's "Select occupancy". Rooms can never exceed adults (validOccupancy).
 */
export function GuestsPicker({ value, onChange, compact }: Props) {
    const { t } = useTranslation();
    const id = useId();
    const root = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', outside);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', esc); };
    }, [open]);

    const label = [
        t('hotels.adults', { count: value.adults }),
        t('hotels.children', { count: value.children }),
        t('hotels.rooms', { count: value.rooms }),
    ].join(' · ');

    const step = (kind: Kind, delta: number) =>
        onChange(validOccupancy(
            kind === 'adults' ? value.adults + delta : value.adults,
            kind === 'children' ? value.children + delta : value.children,
            kind === 'rooms' ? value.rooms + delta : value.rooms,
        ));

    const rows: { kind: Kind; hint?: string }[] = [
        { kind: 'adults', hint: t('hotels.adultsHint') },
        { kind: 'children', hint: t('hotels.childrenHint') },
        { kind: 'rooms' },
    ];

    return (
        <div className={`ms-guests${compact ? ' is-compact' : ''}`} ref={root}>
            {!compact && <span className="ms-where-label" id={`${id}-l`}>{t('hotels.capGuests')}</span>}
            <button
                type="button"
                className="ms-guests-btn"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`${t('hotels.guestsLabel')}: ${label}`}
                onClick={() => setOpen((o) => !o)}
            >
                <span>{label}</span>
                <IconChevronDown size={16} />
            </button>
            {open && (
                <div className="ms-guests-pop" role="dialog" aria-label={t('hotels.guestsLabel')}>
                    {rows.map(({ kind, hint }) => {
                        const [lo, hi] = OCCUPANCY_LIMITS[kind];
                        const maxRooms = kind === 'rooms' ? Math.min(hi, value.adults) : hi;
                        return (
                            <div key={kind} className="ms-guests-row">
                                <div>
                                    <b>{t(`hotels.${kind}`)}</b>
                                    {hint && <small>{hint}</small>}
                                </div>
                                <div className="ms-guests-step">
                                    <button type="button" aria-label={`${t(`hotels.${kind}`)} −`} disabled={value[kind] <= lo} onClick={() => step(kind, -1)}>−</button>
                                    <output aria-live="polite">{value[kind]}</output>
                                    <button type="button" aria-label={`${t(`hotels.${kind}`)} +`} disabled={value[kind] >= maxRooms} onClick={() => step(kind, 1)}>+</button>
                                </div>
                            </div>
                        );
                    })}
                    <button type="button" className="ms-guests-done" onClick={() => setOpen(false)}>{t('hotels.done')}</button>
                </div>
            )}
        </div>
    );
}
