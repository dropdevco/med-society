import { useTranslation } from 'react-i18next';
import type { Country } from '../../types/provider';
import { REGIONS, type RegionId } from '../../utils/region';
import { IconCheck, IconMX } from '../icons/Icons';

/** A place is a border region, optionally narrowed to one of its two sides. */
export interface PlaceValue {
    region: RegionId;
    country: Country | '';
}

/** "Baja California, Mexico" → "Baja California": the state tells the cities apart. */
const stateOf = (hint: string) => hint.split(',')[0];

/**
 * Destinations, west to east. Listed explicitly rather than from REGION_IDS,
 * whose order follows DEFAULT_REGION and the database history.
 */
const DESTINATIONS: RegionId[] = ['sandiego-tijuana', 'elpaso-juarez'];

/**
 * The one place to say where you want care.
 *
 * MedSociety brings patients from anywhere in the US to clinics in Mexico, so
 * the question is which Mexican city, not which side of which crossing: the
 * list is just Tijuana and Ciudad Juárez. Picking one opens its region with no
 * side narrowed, exactly as the old "both sides" row did, so nothing about
 * fetching, the map or smart search changes. The US cities (San Diego, El
 * Paso) are no longer offered here; an old link that carries `country=US`
 * still works, it simply shows no row ticked.
 *
 * Shared by the search box's WHERE popover and the Filters dialog, which run
 * on the same `ms-pop-row` styles.
 */
export function PlacePicker({ value, active = true, onPick }: {
    value: PlaceValue;
    /**
     * False while a ZIP code is the location: no row is then the answer, so none
     * is ticked, rather than ticking one that the ZIP is overriding.
     */
    active?: boolean;
    onPick: (place: PlaceValue) => void;
}) {
    const { t, i18n } = useTranslation();
    const lang = i18n.language?.startsWith('es') ? 'es' : 'en';

    return (
        <div className="ms-places" role="group" aria-label={t('search.whereLabel')}>
            {DESTINATIONS.map((id) => {
                const r = REGIONS[id];
                const chosen = active && value.region === id && value.country !== 'US';

                return (
                    <button
                        key={id}
                        type="button"
                        onClick={() => onPick({ region: id, country: '' })}
                        aria-pressed={chosen}
                        className={`ms-pop-row${chosen ? ' is-chosen' : ''}`}
                    >
                        <span className="ms-pop-ico"><IconMX size={16} /></span>
                        <span className="ms-pop-label"><strong>{r.mx.city}</strong></span>
                        <span className="ms-pop-meta">{stateOf(r.mx.hint[lang])}</span>
                        {chosen && <span className="ms-pop-meta"><IconCheck size={15} weight={2.4} /></span>}
                    </button>
                );
            })}
        </div>
    );
}
