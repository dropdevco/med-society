import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ORIGIN_AIRPORTS } from '../../utils/flightLinks';

/**
 * Where you fly from: type a city or a 3-letter code, and up to six matching
 * airports appear in the same popover style as the "To" list. Anything typed
 * still works if it is a 3-letter code. Arrows move, Enter chooses, Escape closes.
 */
export function OriginInput({ value, onChange, invalid }: { value: string; onChange: (v: string) => void; invalid?: boolean }) {
    const { t } = useTranslation();
    const id = useId();
    const root = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);

    const matches = useMemo(() => {
        const q = value.trim().toLowerCase();
        if (!q || /\([a-z]{3}\)\s*$/i.test(value)) return [];
        const starts = ORIGIN_AIRPORTS.filter(([c, n]) => c.toLowerCase().startsWith(q) || n.toLowerCase().startsWith(q));
        const rest = ORIGIN_AIRPORTS.filter(([c, n]) => !starts.some(([sc]) => sc === c) && n.toLowerCase().includes(q));
        return [...starts, ...rest].slice(0, 6);
    }, [value]);
    const show = open && matches.length > 0;

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const choose = (i: number) => { const [code, city] = matches[i]; onChange(`${city} (${code})`); setOpen(false); };
    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!show) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(matches.length - 1, a + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
        else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };

    return (
        <div className="ms-where ms-airport-from" ref={root}>
            <span className="ms-where-label" id={`${id}-label`}>{t('flights.from')}</span>
            <input
                type="text"
                role="combobox"
                aria-labelledby={`${id}-label`}
                aria-expanded={show}
                aria-controls={`${id}-list`}
                aria-autocomplete="list"
                aria-activedescendant={show ? `${id}-opt-${active}` : undefined}
                aria-invalid={invalid}
                value={value}
                placeholder={t('flights.fromPlaceholder')}
                autoComplete="off"
                onChange={(e) => { onChange(e.target.value); setActive(0); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onKeyDown={onKeyDown}
            />
            {show && (
                <div className="ms-where-pop">
                    <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} className="ms-where-list">
                        {matches.map(([code, city], i) => (
                            <li
                                key={code}
                                id={`${id}-opt-${i}`}
                                role="option"
                                aria-selected={i === active}
                                className={`ms-where-opt${i === active ? ' is-active' : ''}`}
                                onMouseEnter={() => setActive(i)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => choose(i)}
                            >
                                <span><b>{city} <span className="ms-airport-code">{code}</span></b></span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
