import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FLIGHT_PAX_LIMIT, validTravellers, type Travellers } from '../../utils/flightLinks';
import { IconChevronDown } from '../icons/Icons';

type Kind = keyof Travellers;

/**
 * Adults, children and infants with +/- steppers, in the same popover as the
 * hotels' occupancy picker. Airlines' age bands: child 2 to 11, infant under 2
 * on a lap (never more infants than adults), nine seats at most.
 */
export function TravellersPicker({ value, onChange }: { value: Travellers; onChange: (next: Travellers) => void }) {
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
        value.children ? t('hotels.children', { count: value.children }) : '',
        value.infants ? t('flights.infants', { count: value.infants }) : '',
    ].filter(Boolean).join(' · ');

    const step = (kind: Kind, delta: number) => onChange(validTravellers({ ...value, [kind]: value[kind] + delta }));
    const seats = value.adults + value.children;
    const rows: { kind: Kind; name: string; hint: string; min: number; canAdd: boolean }[] = [
        { kind: 'adults', name: t('hotels.adults'), hint: t('flights.adultsHint'), min: 1, canAdd: seats < FLIGHT_PAX_LIMIT },
        { kind: 'children', name: t('hotels.children'), hint: t('flights.childrenHint'), min: 0, canAdd: seats < FLIGHT_PAX_LIMIT },
        { kind: 'infants', name: t('flights.infantsName'), hint: t('flights.infantsHint'), min: 0, canAdd: value.infants < value.adults },
    ];

    return (
        <div className="ms-guests" ref={root}>
            <span className="ms-where-label" id={`${id}-l`}>{t('flights.travellers')}</span>
            <button
                type="button"
                className="ms-guests-btn"
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={`${t('flights.travellers')}: ${label}`}
                onClick={() => setOpen((o) => !o)}
            >
                <span>{label}</span>
                <IconChevronDown size={16} />
            </button>
            {open && (
                <div className="ms-guests-pop" role="dialog" aria-label={t('flights.travellers')}>
                    {rows.map(({ kind, name, hint, min, canAdd }) => (
                        <div key={kind} className="ms-guests-row">
                            <div><b>{name}</b><small>{hint}</small></div>
                            <div className="ms-guests-step">
                                <button type="button" aria-label={`${name} −`} disabled={value[kind] <= min} onClick={() => step(kind, -1)}>−</button>
                                <output aria-live="polite">{value[kind]}</output>
                                <button type="button" aria-label={`${name} +`} disabled={!canAdd} onClick={() => step(kind, 1)}>+</button>
                            </div>
                        </div>
                    ))}
                    <button type="button" className="ms-guests-done" onClick={() => setOpen(false)}>{t('hotels.done')}</button>
                </div>
            )}
        </div>
    );
}
