import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REGIONS, type RegionId } from '../../utils/region';
import { IconCheck, IconChevronDown } from '../icons/Icons';

/** "sandiego-tijuana" = stay in Tijuana; "sandiego-tijuana:us" = stay in San Diego and cross. */
export type WhereValue = string;

interface Option { value: WhereValue; city: string; hint: string; group: 'mx' | 'us' }

/**
 * Where to stay, as a listbox instead of a native select: the two sides of the
 * border are two labelled groups, each city with a line saying what it is.
 * Keyboard: arrows, Home/End, Enter or Space to choose, Escape to close.
 */
export function WherePicker({ value, onChange }: { value: WhereValue; onChange: (v: WhereValue) => void }) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language.startsWith('es') ? 'es' : 'en';
    const id = useId();
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const root = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);

    const options = useMemo<Option[]>(() => {
        const ids = Object.keys(REGIONS) as RegionId[];
        return [
            ...ids.map((r): Option => ({ value: r, city: REGIONS[r].mx.city, hint: REGIONS[r].mx.hint[lang], group: 'mx' })),
            ...ids.map((r): Option => ({
                value: `${r}:us`, city: REGIONS[r].us.city,
                hint: t('hotels.crossTo', { mx: REGIONS[r].mx.city }), group: 'us',
            })),
        ];
    }, [lang, t]);
    const selected = Math.max(0, options.findIndex((o) => o.value === value));
    const current = options[selected];

    useEffect(() => {
        if (!open) return;
        const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, [open]);

    const choose = (i: number) => {
        onChange(options[i].value);
        setOpen(false);
        button.current?.focus();
    };
    const openList = () => { setActive(selected); setOpen(true); };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (!open) {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); }
            return;
        }
        const last = options.length - 1;
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(last, a + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
        else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
        else if (e.key === 'End') { e.preventDefault(); setActive(last); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
        else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
        else if (e.key === 'Tab') setOpen(false);
    };

    const listId = `${id}-list`;
    const optId = (i: number) => `${id}-opt-${i}`;
    const groups: { key: 'mx' | 'us'; label: string }[] = [
        { key: 'mx', label: t('hotels.groupMx') },
        { key: 'us', label: t('hotels.groupUs') },
    ];

    return (
        <div className="ms-where" ref={root}>
            <span className="ms-where-label" id={`${id}-label`}>{t('hotels.whereLabel')}</span>
            <button
                ref={button}
                type="button"
                className="ms-where-btn"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-labelledby={`${id}-label ${id}-value`}
                aria-activedescendant={open ? optId(active) : undefined}
                onClick={() => (open ? setOpen(false) : openList())}
                onKeyDown={onKeyDown}
            >
                <span id={`${id}-value`} className="ms-where-value">
                    <b>{current.city}</b>
                    <small>{current.hint}</small>
                </span>
                <IconChevronDown size={16} />
            </button>
            {open && (
                <div className="ms-where-pop">
                    <ul id={listId} role="listbox" aria-labelledby={`${id}-label`} className="ms-where-list">
                        {groups.map((g) => (
                            <li key={g.key} role="presentation" className="ms-where-group">
                                <span className="ms-where-group-title" aria-hidden="true">{g.label}</span>
                                <ul role="group" aria-label={g.label}>
                                    {options.map((o, i) => o.group !== g.key ? null : (
                                        <li
                                            key={o.value}
                                            id={optId(i)}
                                            role="option"
                                            aria-selected={i === selected}
                                            className={`ms-where-opt${i === active ? ' is-active' : ''}${i === selected ? ' is-selected' : ''}`}
                                            onMouseEnter={() => setActive(i)}
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => choose(i)}
                                        >
                                            <span><b>{o.city}</b><small>{o.hint}</small></span>
                                            {i === selected && <IconCheck size={15} />}
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
