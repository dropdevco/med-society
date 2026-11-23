import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IconBed, IconClinic, IconPlane } from '../icons/Icons';

export type Vertical = 'care' | 'hotels' | 'flights';

const TABS: { id: Vertical; icon: typeof IconClinic; labelKey: string }[] = [
    { id: 'care', icon: IconClinic, labelKey: 'hotels.tabCare' },
    { id: 'hotels', icon: IconBed, labelKey: 'hotels.tabHotels' },
    { id: 'flights', icon: IconPlane, labelKey: 'hotels.tabFlights' },
];

/**
 * What the homepage search is for, the way Expedia and Booking.com put Stays,
 * Flights and Cars above one box. A real tablist: arrow keys move between
 * tabs, and only the active tab is in the tab order.
 */
export function VerticalTabs({ value, onChange, panelId }: { value: Vertical; onChange: (v: Vertical) => void; panelId: string }) {
    const { t } = useTranslation();
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const onKey = (e: React.KeyboardEvent, i: number) => {
        const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!dir) return;
        e.preventDefault();
        const next = (i + dir + TABS.length) % TABS.length;
        onChange(TABS[next].id);
        refs.current[next]?.focus();
    };
    return (
        <div className="ms-vertical-tabs" role="tablist" aria-label={t('hotels.tabsLabel')}>
            {TABS.map(({ id, icon: Icon, labelKey }, i) => (
                <button
                    key={id}
                    ref={(el) => { refs.current[i] = el; }}
                    type="button"
                    role="tab"
                    id={`vertical-tab-${id}`}
                    aria-selected={value === id}
                    aria-controls={panelId}
                    tabIndex={value === id ? 0 : -1}
                    className={`press${value === id ? ' is-active' : ''}`}
                    onClick={() => onChange(id)}
                    onKeyDown={(e) => onKey(e, i)}
                >
                    <Icon size={18} />
                    {t(labelKey)}
                </button>
            ))}
        </div>
    );
}
