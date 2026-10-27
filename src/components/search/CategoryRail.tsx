import { useTranslation } from 'react-i18next';
import type { Specialty } from '../../types/provider';
import { SpecialtyIcon } from '../icons/Icons';
import { specialtyColor } from '../../utils/specialtyColors';
import { ScrollRail } from './ScrollRail';

interface CategoryRailProps {
    /** Specialties in directory order, largest first. */
    order: Specialty[];
    active: Specialty[];
    onToggle: (s: Specialty) => void;
    /** Home page: big tinted icon tiles instead of the toolbar's slim rail. */
    tiles?: boolean;
}

/**
 * The icon rail across the top, and the fastest path through the whole app.
 *
 * Airbnb puts its categories above the search box because most arrivals are
 * one word away from what they want — and so are these. A tap sets the
 * specialty filter directly, which means the shortest possible query is one
 * click, no typing, no map.
 */
export function CategoryRail({ order, active, onToggle, tiles }: CategoryRailProps) {
    const { t } = useTranslation();

    return (
        <ScrollRail className={`ms-cats${tiles ? ' is-tiles' : ''}`} role="tablist" label={t('filters.specialtyGroup')}>
            {order.map((s) => {
                const on = active.includes(s);
                return (
                    <button
                        key={s}
                        role="tab"
                        aria-selected={on}
                        onClick={() => onToggle(s)}
                        className={`ms-cat${on ? ' is-active' : ''}`}
                        // Each specialty carries its own hue here, on the icon
                        // and on the active underline, so the rail is scanned
                        // by colour rather than read word by word. The label
                        // stays on the text ramp — tinting both would cost the
                        // contrast the label needs to be legible at 0.72rem.
                        style={{ ['--cat-c' as string]: specialtyColor(s) }}
                    >
                        <span className="ms-cat-ico" aria-hidden="true">
                            <SpecialtyIcon specialty={s} size={tiles ? 26 : 22} weight={1.7} />
                        </span>
                        <span>{t(`specialties.${s}`)}</span>
                    </button>
                );
            })}
        </ScrollRail>
    );
}
