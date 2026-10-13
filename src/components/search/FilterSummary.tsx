import { useTranslation } from 'react-i18next';
import type { ProviderFilters, SortMode, Specialty } from '../../types/provider';
import { IconClose, IconMapPin, IconSliders, IconChevronDown } from '../icons/Icons';
import { RADIUS_OPTIONS } from '../../utils/geo';
import { formatPrice } from '../../utils/currency';
import type { PostalHit } from '../../utils/postalGeocode';
import { REGIONS, sideOf } from '../../utils/region';
import { languageName } from '../../utils/languages';

const SORTS: SortMode[] = ['relevance', 'rating', 'reviews', 'distance', 'price'];

interface FilterSummaryProps {
    filters: ProviderFilters;
    updateFilter: <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => void;
    patchFilters: (patch: Partial<ProviderFilters>) => void;
    resetFilters: () => void;
    count: number;
    /**
     * Replaces the "N providers" caption. Used when the keyword search found
     * nothing but the AI panel answered, where "0 clinics" above a list of
     * doctors reads as a contradiction.
     */
    countLabel?: string;
    activeCount: number;
    /** False when the searched code matches no provider we hold. */
    /**
     * What happened to the typed code. 'pending' exists so a geocode in flight
     * reads as "locating" rather than as "no such code", which is what a bare
     * boolean forced it to say for the ~200ms it takes to answer.
     */
    postalStatus: 'ok' | 'pending' | 'unknown' | 'ambiguous';
    /** The places an ambiguous code could mean. Empty unless status is 'ambiguous'. */
    postalChoices: PostalHit[];
    onChoosePostal: (hit: PostalHit) => void;
    /** Opens the Filters dialog — the one door to every filter. */
    onOpenFilters: () => void;
}

/**
 * The line above the results: how many, in what order, and what is narrowing
 * them.
 *
 * It sits inside the scrolling column rather than in the sticky toolbar,
 * because it is a caption for the list — the same place Airbnb puts "613
 * places in Ruidoso". Every active filter appears here as a removable chip,
 * which is what stands between a user and wondering why the directory looks
 * so small.
 */
export function FilterSummary({
    filters, updateFilter, patchFilters, resetFilters, count, countLabel, activeCount,
    postalStatus,
    postalChoices,
    onChoosePostal,
    onOpenFilters,
}: FilterSummaryProps) {
    const { t, i18n } = useTranslation();

    const drop = <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) =>
        () => updateFilter(key, value);

    const remove = <T,>(list: T[], v: T) => list.filter((x) => x !== v);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '0.6rem', flexWrap: 'wrap',
            }}>
                {countLabel ? (
                    <span style={{ fontSize: '0.95rem', color: 'var(--white)', fontWeight: 700 }}>
                        {countLabel}
                        {/* A smart search answers from one region's reviews;
                            say which, as the plain count does. */}
                        <span style={{ color: 'var(--gray-400)', fontWeight: 500 }}>
                            {' · '}{REGIONS[filters.region].name}
                        </span>
                    </span>
                ) : (
                    <span style={{ fontSize: '0.88rem', color: 'var(--gray-400)' }}>
                        <strong style={{ color: 'var(--white)', fontWeight: 800, fontSize: '1.05rem' }}>
                            {count.toLocaleString()}
                        </strong>
                        {' '}{t('filters.providersFoundSuffix', { count })}
                        {/* Which region the count is of: only one is loaded. */}
                        {' · '}{REGIONS[filters.region].name}
                    </span>
                )}

                {/* Wraps: on a 375px screen the filters button, the sort select
                    and the view toggle do not fit on one line, and without this
                    they pushed the page 130px wider than the viewport. */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    flexWrap: 'wrap', minWidth: 0,
                }}>
                    <button
                        onClick={onOpenFilters}
                        className={`ms-chip ms-chip-filters${activeCount > 0 ? ' is-active' : ''}`}
                    >
                        <IconSliders size={15} weight={2} />
                        {t('filters.filtersLabel')}
                        {activeCount > 0 && <span className="ms-chip-count">{activeCount}</span>}
                    </button>

                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                            {t('filters.sortLabel', { defaultValue: 'Sort' })}
                        </span>
                        <span className="ms-sort-wrap">
                            <select
                                value={filters.sort}
                                onChange={(e) => updateFilter('sort', e.target.value as SortMode)}
                                className="ms-sort-select"
                            >
                                {SORTS
                                    // Nearest is only an order when we have a point
                                    // to measure from.
                                    .filter((s) => s !== 'distance' || filters.postalCode)
                                    .map((s) => (
                                        <option key={s} value={s}>
                                            {t(`filters.sort.${s}`, { defaultValue: s })}
                                        </option>
                                    ))}
                            </select>
                            <IconChevronDown size={14} weight={2.4} />
                        </span>
                    </label>
                </div>
            </div>

            {/* `mapArea` is intentionally outside countActiveFilters (see the
                note there), so it has to be admitted here explicitly. Without
                this clause a map-only filter would narrow the list with no
                chip to explain it — exactly the invisible-filter failure this
                row exists to prevent. */}
            {(activeCount > 0 || filters.mapArea) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    {filters.postalCode && (
                        <PostalChip
                            code={filters.postalCode}
                            status={postalStatus}
                            choices={postalChoices}
                            onChoose={onChoosePostal}
                            radiusKm={filters.radiusKm}
                            onRadius={(km) => updateFilter('radiusKm', km)}
                            onClear={() => patchFilters({ postalCode: '', radiusKm: filters.radiusKm })}
                        />
                    )}

                    {filters.mapArea && (
                        <MapAreaChip onClear={() => patchFilters({ mapArea: null })} />
                    )}

                    {filters.country && (
                        <FilterChip
                            label={sideOf(filters.region, filters.country).city}
                            onRemove={drop('country', '')}
                        />
                    )}

                    {filters.specialty.map((s: Specialty) => (
                        <FilterChip
                            key={s}
                            label={t(`specialties.${s}`)}
                            onRemove={() => updateFilter('specialty', remove(filters.specialty, s))}
                        />
                    ))}

                    {filters.insurances.map((i) => (
                        <FilterChip
                            key={i}
                            label={i}
                            onRemove={() => updateFilter('insurances', remove(filters.insurances, i))}
                        />
                    ))}

                    {filters.languages.map((l) => (
                        <FilterChip
                            key={l}
                            label={languageName(l, i18n.language)}
                            onRemove={() => updateFilter('languages', remove(filters.languages, l))}
                        />
                    ))}

                    {filters.minRating > 0 && (
                        <FilterChip
                            label={t('filters.ratingChip', {
                                rating: filters.minRating,
                                defaultValue: `${filters.minRating}+ stars`,
                            })}
                            onRemove={drop('minRating', 0)}
                        />
                    )}

                    {filters.verifiedOnly && (
                        <FilterChip
                            label={t('filters.verified', { defaultValue: 'Verified credentials' })}
                            onRemove={drop('verifiedOnly', false)}
                        />
                    )}

                    {filters.withPricing && (
                        <FilterChip
                            label={filters.maxPriceMxn != null
                                ? `≤ ${formatPrice(filters.maxPriceMxn, i18n.language)}`
                                : t('filters.withPricing', { defaultValue: 'Publishes prices' })}
                            onRemove={() => patchFilters({ withPricing: false, maxPriceMxn: null })}
                        />
                    )}

                    <button
                        onClick={resetFilters}
                        style={{
                            fontSize: '0.82rem', color: 'var(--gold)',
                            background: 'none', fontWeight: 700, padding: '0.2rem 0.3rem',
                        }}
                    >
                        {t('filters.clearFilters')}
                    </button>
                </div>
            )}
        </div>
    );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.28rem 0.4rem 0.28rem 0.7rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.79rem', fontWeight: 600,
                background: 'var(--navy-800)', color: 'var(--gray-200)',
                border: '1px solid var(--border)',
                maxWidth: '15rem',
            }}
        >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {label}
            </span>
            <button
                onClick={onRemove}
                aria-label={`Remove ${label}`}
                title={`Remove ${label}`}
                style={{ display: 'flex', background: 'none', color: 'inherit', padding: '0.1rem', flexShrink: 0 }}
            >
                <IconClose size={13} weight={2.2} />
            </button>
        </span>
    );
}

/**
 * The other spatial chip: the results are clipped to whatever the map was
 * showing when "Search this area" was pressed.
 *
 * It carries no adjustable control — a box is only editable by moving the map —
 * so it is a location statement plus a clear button, and the pin marks it as
 * spatial rather than categorical.
 */
function MapAreaChip({ onClear }: { onClear: () => void }) {
    const { t } = useTranslation();
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                padding: '0.24rem 0.4rem 0.24rem 0.6rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.79rem', fontWeight: 600,
                background: 'var(--surface)', color: 'var(--white)',
                border: '1px solid var(--border-strong)',
            }}
        >
            <IconMapPin size={13} weight={2.2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            {t('filters.mapArea')}
            <button
                onClick={onClear}
                aria-label={t('filters.clearMapArea')}
                title={t('filters.clearMapArea')}
                style={{ display: 'flex', background: 'none', color: 'inherit', padding: '0.1rem' }}
            >
                <IconClose size={13} weight={2.2} />
            </button>
        </span>
    );
}

/** The location chip doubles as the radius control while a code is active. */
/**
 * The postal chip doubles as the radius selector, the "still looking" state,
 * and — when a five-digit code means a place on each side of the border — the
 * question about which one was meant. All four are the same chip because they
 * are all the same fact: what "near 79912" currently resolves to.
 */
function PostalChip({ code, status, choices, onChoose, radiusKm, onRadius, onClear }: {
    code: string;
    status: 'ok' | 'pending' | 'unknown' | 'ambiguous';
    choices: PostalHit[];
    onChoose: (hit: PostalHit) => void;
    radiusKm: number;
    onRadius: (km: number) => void;
    onClear: () => void;
}) {
    const { t } = useTranslation();
    const ok = status === 'ok';
    const unresolved = status === 'unknown';
    return (
        <span
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                padding: '0.24rem 0.4rem 0.24rem 0.7rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.79rem', fontWeight: 600,
                background: unresolved ? 'transparent' : 'var(--navy-800)',
                color: unresolved ? 'var(--gold)' : 'var(--gray-200)',
                border: `1px solid ${unresolved ? 'var(--gold)' : 'var(--border)'}`,
            }}
        >
            {status === 'pending' && t('filters.postalLocating', { code })}
            {status === 'unknown' && t('filters.postalNoMatch', { code })}
            {status === 'ambiguous' && t('filters.postalWhichSide', { code })}
            {ok && t('filters.nearPostal', { code })}

            {status === 'ambiguous' && choices.map((hit) => (
                <button
                    key={hit.country}
                    onClick={() => onChoose(hit)}
                    className="press"
                    style={{
                        borderRadius: 'var(--radius-pill)',
                        border: '1px solid var(--border-strong)',
                        background: 'var(--surface)',
                        color: 'var(--white)',
                        fontSize: '0.74rem', fontWeight: 700,
                        padding: '0.12rem 0.5rem',
                    }}
                >
                    {hit.label}
                </button>
            ))}

            {ok && (
                <select
                    aria-label={t('filters.radiusLabel')}
                    value={radiusKm}
                    onChange={(e) => onRadius(Number(e.target.value))}
                    style={{
                        background: 'var(--surface)', color: 'var(--white)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-pill)',
                        fontSize: '0.74rem', fontWeight: 700,
                        padding: '0.12rem 0.28rem',
                    }}
                >
                    {RADIUS_OPTIONS.map((km) => (
                        <option key={km} value={km}>{t('filters.radiusKm', { km })}</option>
                    ))}
                </select>
            )}

            <button
                onClick={onClear}
                aria-label={t('filters.clearPostal')}
                title={t('filters.clearPostal')}
                style={{ display: 'flex', background: 'none', color: 'inherit', padding: '0.1rem' }}
            >
                <IconClose size={13} weight={2.2} />
            </button>
        </span>
    );
}
