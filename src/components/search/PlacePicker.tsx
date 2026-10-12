import { useTranslation } from 'react-i18next';
import type { Country } from '../../types/provider';
import { REGIONS, REGION_IDS, type RegionId } from '../../utils/region';
import { IconBorder, IconCheck, IconMX, IconUS } from '../icons/Icons';

/** A place is a border crossing, narrowed to one of its two cities or not. */
export interface PlaceValue {
    region: RegionId;
    country: Country | '';
}

/** "Texas, United States" → "Texas": the state tells the cities apart at a glance. */
const stateOf = (hint: string) => hint.split(',')[0];

/**
 * The one place to say where you want care.
 *
 * Patients think in cities — "Tijuana", "San Diego" — not in "a region, then a
 * side of it", so this is a single list with a single tap. Each border crossing
 * is a row of its own (both of its cities together, which is what the directory
 * opens on and what a patient comparing prices across the line wants), and its
 * two cities nest beneath it. Choosing any row sets the region and the side
 * together; the region the row belongs to is never a separate question.
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

    const isChosen = (p: PlaceValue) => active && value.region === p.region && value.country === p.country;

    return (
        <div className="ms-places" role="group" aria-label={t('search.whereLabel')}>
            {REGION_IDS.map((id) => {
                const r = REGIONS[id];
                const both: PlaceValue = { region: id, country: '' };
                const cities: { place: PlaceValue; city: string; hint: string; icon: React.ReactNode }[] = [
                    { place: { region: id, country: 'US' }, city: r.us.city, hint: r.us.hint[lang], icon: <IconUS size={15} /> },
                    { place: { region: id, country: 'MX' }, city: r.mx.city, hint: r.mx.hint[lang], icon: <IconMX size={15} /> },
                ];

                return (
                    <div key={id} className="ms-places-group">
                        <button
                            type="button"
                            onClick={() => onPick(both)}
                            aria-pressed={isChosen(both)}
                            className={`ms-pop-row${isChosen(both) ? ' is-chosen' : ''}`}
                        >
                            <span className="ms-pop-ico"><IconBorder size={16} /></span>
                            <span className="ms-pop-label">
                                <strong>{r.name}</strong>
                                <em>{t('regions.bothSides')}</em>
                            </span>
                            {isChosen(both) && <span className="ms-pop-meta"><IconCheck size={15} weight={2.4} /></span>}
                        </button>

                        <div className="ms-places-kids">
                            {cities.map((c) => (
                                <button
                                    key={c.place.country}
                                    type="button"
                                    onClick={() => onPick(c.place)}
                                    aria-pressed={isChosen(c.place)}
                                    className={`ms-pop-row ms-pop-row-city${isChosen(c.place) ? ' is-chosen' : ''}`}
                                >
                                    <span className="ms-pop-ico">{c.icon}</span>
                                    <span className="ms-pop-label"><strong>{c.city}</strong></span>
                                    <span className="ms-pop-meta">{stateOf(c.hint)}</span>
                                    {isChosen(c.place) && <span className="ms-pop-meta"><IconCheck size={15} weight={2.4} /></span>}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
