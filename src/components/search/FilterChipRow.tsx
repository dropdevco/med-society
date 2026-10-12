import { useTranslation } from 'react-i18next';
import type { ProviderFilters, Specialty } from '../../types/provider';
import type { FacetCounts } from '../../utils/facets';
import {
    IconSliders, IconStar, IconVerified,
    IconMX, IconUS, SpecialtyIcon,
} from '../icons/Icons';
import { ScrollRail } from './ScrollRail';
import { REGIONS } from '../../utils/region';

interface FilterChipRowProps {
    filters: ProviderFilters;
    updateFilter: <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => void;
    patchFilters: (patch: Partial<ProviderFilters>) => void;
    facets: FacetCounts;
    activeCount: number;
    onOpenFilters: () => void;
}

/** How many specialty shortcuts the row offers before it starts scrolling badly. */
const SPECIALTY_SHORTCUTS = 4;

/**
 * The horizontal filter row above the results.
 *
 * These are the handful of axes worth one click — the ones a patient changes
 * mid-search rather than sets up front. Everything else lives behind the
 * Filters button, which is the point: a rail of thirty checkboxes competing
 * with the results is a rail nobody reads, and the four decisions that actually
 * move the list get lost inside it.
 */
export function FilterChipRow({
    filters, updateFilter, patchFilters, facets, activeCount, onOpenFilters,
}: FilterChipRowProps) {
    const { t } = useTranslation();

    const toggleCountry = (c: 'MX' | 'US') =>
        updateFilter('country', filters.country === c ? '' : c);

    // Shortcuts are drawn from what this result set actually contains, so the
    // row never offers a specialty that would empty the page.
    const shortcuts = [...facets.specialty.entries()]
        .sort((a, b) => b[1] - a[1])
        .filter(([s]) => !filters.specialty.includes(s))
        .slice(0, SPECIALTY_SHORTCUTS)
        .map(([s]) => s as Specialty);

    return (
        <ScrollRail className="ms-chiprow">
            <button
                onClick={onOpenFilters}
                className={`ms-chip ms-chip-filters${activeCount > 0 ? ' is-active' : ''}`}
            >
                <IconSliders size={15} weight={2} />
                {t('filters.filtersLabel')}
                {activeCount > 0 && <span className="ms-chip-count">{activeCount}</span>}
            </button>

            <span className="ms-chiprow-sep" aria-hidden="true" />

            {/* The two sides of the selected region's border, by city name. */}
            <Chip
                icon={<IconMX size={14} />}
                label={REGIONS[filters.region].mx.city}
                on={filters.country === 'MX'}
                onClick={() => toggleCountry('MX')}
            />
            <Chip
                icon={<IconUS size={14} />}
                label={REGIONS[filters.region].us.city}
                on={filters.country === 'US'}
                onClick={() => toggleCountry('US')}
            />

            <Chip
                icon={<IconStar size={14} filled />}
                label={t('filters.rating45')}
                on={filters.minRating === 4.5}
                onClick={() => updateFilter('minRating', filters.minRating === 4.5 ? 0 : 4.5)}
            />

            <Chip
                label={t('filters.withPricing')}
                on={filters.withPricing}
                count={facets.withPricing}
                // Releasing the toggle must clear the ceiling too, or an
                // invisible max sits waiting to bite on the next tick.
                onClick={() => patchFilters(
                    filters.withPricing
                        ? { withPricing: false, maxPriceMxn: null }
                        : { withPricing: true },
                )}
            />

            <Chip
                icon={<IconVerified size={14} weight={2} />}
                label={t('filters.verified')}
                on={filters.verifiedOnly}
                count={facets.verified}
                onClick={() => updateFilter('verifiedOnly', !filters.verifiedOnly)}
            />

            {shortcuts.map((s) => (
                <Chip
                    key={s}
                    icon={<SpecialtyIcon specialty={s} size={14} weight={1.9} />}
                    label={t(`specialties.${s}`)}
                    count={facets.specialty.get(s)}
                    on={false}
                    onClick={() => updateFilter('specialty', [...filters.specialty, s])}
                />
            ))}
        </ScrollRail>
    );
}

function Chip({ icon, label, on, count, onClick }: {
    icon?: React.ReactNode; label: string; on: boolean; count?: number; onClick: () => void;
}) {
    // A zero-count shortcut is a dead end; showing it as pressable is a lie.
    const dead = !on && count === 0;
    return (
        <button
            onClick={onClick}
            aria-pressed={on}
            disabled={dead}
            className={`ms-chip${on ? ' is-active' : ''}${dead ? ' is-dead' : ''}`}
        >
            {icon}
            {label}
            {!on && count != null && count > 0 && (
                <span className="ms-chip-n">{count.toLocaleString()}</span>
            )}
        </button>
    );
}
