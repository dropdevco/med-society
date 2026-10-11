import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderFilters, Specialty } from '../../types/provider';
import { SpecialtyLabels } from '../../types/provider';
import type { FacetCounts } from '../../utils/facets';
import { topInsurers } from '../../utils/facets';
import { fold } from '../../utils/search';
import { REGIONS, REGION_IDS } from '../../utils/region';
import { regionPatch } from '../../utils/filters';
import { languageName } from '../../utils/languages';
import { formatPrice, isEnglish, MXN_PER_USD } from '../../utils/currency';
import {
    SpecialtyIcon, IconBorder, IconUS, IconMX,
    IconStar, IconChevronDown, IconSearch,
} from '../icons/Icons';

interface FilterBarProps {
    filters: ProviderFilters;
    updateFilter: <K extends keyof ProviderFilters>(key: K, value: ProviderFilters[K]) => void;
    patchFilters: (patch: Partial<ProviderFilters>) => void;
    facets: FacetCounts;
}

const ALL_SPECIALTIES = Object.keys(SpecialtyLabels) as Specialty[];

/**
 * Showing all fifteen at once buries the rest of the rail. These six cover the
 * bulk of border-clinic demand; the others stay one click away.
 */
const PRIMARY_SPECIALTIES: Specialty[] = [
    'dentist', 'general', 'obgyn', 'optometry', 'plastic_surgery', 'urgent_care',
];

const RATINGS = [0, 3, 4, 4.5];
/**
 * Ceiling options for the price filter, stored in MXN either way (the URL
 * param and the filter state are always MXN — see ProviderFilters.maxPriceMxn
 * — only the label changes with language). Spanish keeps the original MXN
 * ceilings; English shows round USD ceilings converted to their MXN
 * equivalent so the stored/compared value is still a single MXN number.
 */
const PRICE_CEILINGS_MXN = [500, 1000, 2000, 5000];
const PRICE_CEILINGS_USD = [25, 50, 100, 250];
const INSURERS_SHOWN = 12;

/** Toggle a value in or out of a multi-select axis. */
function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * The vertical filter rail.
 *
 * Every option carries the count it would yield, computed with its own axis
 * released — so a zero tells you the combination is a dead end *before* you
 * click it and stare at an empty list.
 */
export function FilterBar({ filters, updateFilter, patchFilters, facets }: FilterBarProps) {
    const { t, i18n } = useTranslation();
    const [showAllTags, setShowAllTags] = useState(false);
    const [insuranceQuery, setInsuranceQuery] = useState('');

    const priceCeilings = isEnglish(i18n.language)
        ? PRICE_CEILINGS_USD.map((usd) => usd * MXN_PER_USD)
        : PRICE_CEILINGS_MXN;

    const RATING_LABELS: Record<number, string> = {
        0: t('filters.ratingAny'),
        3: t('filters.rating3'),
        4: t('filters.rating4'),
        4.5: t('filters.rating45'),
    };

    // Specialties ordered by how many results they'd actually yield, so the
    // rail reflects this directory rather than a hardcoded guess.
    const specialtyOptions = (showAllTags ? ALL_SPECIALTIES : PRIMARY_SPECIALTIES)
        // An active tag must stay visible even when hidden by the cut, or the
        // user sees a filter they cannot switch off.
        .concat(filters.specialty.filter((s) => !showAllTags && !PRIMARY_SPECIALTIES.includes(s)))
        .filter((s, i, arr) => arr.indexOf(s) === i);

    const insurerOptions = (() => {
        const q = fold(insuranceQuery.trim());
        const all = topInsurers(facets.insurance, q ? 400 : INSURERS_SHOWN);
        const matched = q ? all.filter((n) => fold(n).includes(q)).slice(0, INSURERS_SHOWN) : all;
        // Selected insurers always render, even if the search box hides them.
        return [...new Set([...filters.insurances, ...matched])];
    })();

    const languageOptions = [...facets.language.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {/* The region is a scope rather than a filter: switching loads the
                other region's directory and releases the side, the postal
                code and the map box, which all belonged to the old one. */}
            <Section title={t('regions.label')} defaultOpen>
                <div role="group" aria-label={t('regions.label')} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {REGION_IDS.map((id) => (
                        <Chip
                            key={id}
                            icon={<IconBorder size={14} />}
                            label={REGIONS[id].name}
                            active={filters.region === id}
                            onClick={() => { if (filters.region !== id) patchFilters(regionPatch(id)); }}
                        />
                    ))}
                </div>
            </Section>

            <Section title={t('filters.countryGroup')} defaultOpen>
                <div
                    role="group"
                    aria-label={t('filters.countryGroup')}
                    style={{
                        display: 'flex',
                        background: 'var(--surface)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-pill)',
                        padding: '3px', gap: '3px',
                    }}
                >
                    <SegItem
                        icon={<IconBorder size={14} />}
                        label={t('filters.bothSides')}
                        active={filters.country === ''}
                        onClick={() => updateFilter('country', '')}
                    />
                    <SegItem
                        icon={<IconMX size={14} />}
                        label={REGIONS[filters.region].mx.city}
                        active={filters.country === 'MX'}
                        onClick={() => updateFilter('country', 'MX')}
                    />
                    <SegItem
                        icon={<IconUS size={14} />}
                        label={REGIONS[filters.region].us.city}
                        active={filters.country === 'US'}
                        onClick={() => updateFilter('country', 'US')}
                    />
                </div>
            </Section>

            <Section title={t('filters.specialtyGroup', { defaultValue: 'Specialty' })} defaultOpen>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                    {specialtyOptions.map((key) => (
                        <CheckRow
                            key={key}
                            icon={<SpecialtyIcon specialty={key} size={15} weight={1.8} />}
                            label={t(`specialties.${key}`)}
                            count={facets.specialty.get(key) ?? 0}
                            checked={filters.specialty.includes(key)}
                            onChange={() => updateFilter('specialty', toggle(filters.specialty, key))}
                        />
                    ))}
                </div>
                <MoreButton
                    expanded={showAllTags}
                    onClick={() => setShowAllTags((v) => !v)}
                    label={showAllTags
                        ? t('filters.fewerTags')
                        : t('filters.moreTags', { count: ALL_SPECIALTIES.length - PRIMARY_SPECIALTIES.length })}
                />
            </Section>

            <Section title={t('filters.insuranceGroup', { defaultValue: 'Insurance accepted' })}>
                {facets.insurance.size > INSURERS_SHOWN && (
                    <div style={{ position: 'relative', marginBottom: '0.4rem' }}>
                        <span style={{
                            position: 'absolute', left: '0.6rem', top: '50%',
                            transform: 'translateY(-50%)', display: 'flex',
                            color: 'var(--gray-500)', pointerEvents: 'none',
                        }}>
                            <IconSearch size={14} />
                        </span>
                        <input
                            type="search"
                            value={insuranceQuery}
                            onChange={(e) => setInsuranceQuery(e.target.value)}
                            placeholder={t('filters.insuranceSearch', { defaultValue: 'Find an insurer' })}
                            aria-label={t('filters.insuranceSearch', { defaultValue: 'Find an insurer' })}
                            style={{
                                width: '100%', padding: '0.42rem 0.6rem 0.42rem 1.9rem',
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--white)', fontSize: '0.82rem', outline: 'none',
                            }}
                        />
                    </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                    {insurerOptions.length === 0 && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--gray-500)', padding: '0.3rem 0' }}>
                            {t('filters.noInsurers', { defaultValue: 'No insurers match' })}
                        </p>
                    )}
                    {insurerOptions.map((name) => (
                        <CheckRow
                            key={name}
                            label={name}
                            count={facets.insurance.get(name) ?? 0}
                            checked={filters.insurances.includes(name)}
                            onChange={() => updateFilter('insurances', toggle(filters.insurances, name))}
                        />
                    ))}
                </div>
            </Section>

            {languageOptions.length > 1 && (
                <Section title={t('filters.languageGroup', { defaultValue: 'Language' })}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                        {languageOptions.map(([code, count]) => (
                            <CheckRow
                                key={code}
                                label={languageName(code, i18n.language)}
                                count={count}
                                checked={filters.languages.includes(code)}
                                onChange={() => updateFilter('languages', toggle(filters.languages, code))}
                            />
                        ))}
                    </div>
                </Section>
            )}

            <Section title={t('filters.ratingLabel')} defaultOpen>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                    <IconStar size={14} filled style={{ color: 'var(--star)' }} />
                    {RATINGS.map((r) => (
                        <Chip
                            key={r}
                            label={RATING_LABELS[r]}
                            active={filters.minRating === r}
                            onClick={() => updateFilter('minRating', r)}
                        />
                    ))}
                </div>
            </Section>

            <Section title={t('filters.availabilityGroup', { defaultValue: 'Availability' })}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.1rem' }}>
                    <CheckRow
                        label={t('filters.verified', { defaultValue: 'Verified credentials' })}
                        count={facets.verified}
                        checked={filters.verifiedOnly}
                        onChange={() => updateFilter('verifiedOnly', !filters.verifiedOnly)}
                    />
                </div>
            </Section>

            <Section title={t('filters.priceGroup', { defaultValue: 'Price' })}>
                <CheckRow
                    label={t('filters.withPricing', { defaultValue: 'Publishes prices' })}
                    count={facets.withPricing}
                    checked={filters.withPricing}
                    // Releasing the toggle must clear the ceiling too, or an
                    // invisible max sits waiting to bite on the next tick.
                    onChange={() => patchFilters(
                        filters.withPricing
                            ? { withPricing: false, maxPriceMxn: null }
                            : { withPricing: true },
                    )}
                />

                {filters.withPricing && (
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                        <Chip
                            label={t('filters.priceAny', { defaultValue: 'Any' })}
                            active={filters.maxPriceMxn == null}
                            onClick={() => updateFilter('maxPriceMxn', null)}
                        />
                        {priceCeilings.map((max) => (
                            <Chip
                                key={max}
                                label={`≤ ${formatPrice(max, i18n.language)}`}
                                active={filters.maxPriceMxn === max}
                                onClick={() => updateFilter('maxPriceMxn', max)}
                            />
                        ))}
                    </div>
                )}

                <p style={{ margin: '0.5rem 0 0', fontSize: '0.7rem', color: 'var(--gray-500)', lineHeight: 1.5 }}>
                    {t('filters.priceNote', {
                        defaultValue: 'Only some providers publish prices. Turning this on hides the rest.',
                    })}
                </p>
            </Section>
        </div>
    );
}

// ── Building blocks ─────────────────────────────────────────────────────────

function Section({ title, defaultOpen, children }: {
    title: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
    const [open, setOpen] = useState(Boolean(defaultOpen));
    return (
        <section style={{ borderBottom: '1px solid var(--border)', padding: '0.15rem 0 0.5rem' }}>
            <button
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.6rem 0.1rem', background: 'none',
                    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.07em',
                    textTransform: 'uppercase', color: 'var(--gray-500)',
                }}
            >
                {title}
                <span style={{
                    display: 'flex',
                    transform: open ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.22s var(--ease-out)',
                }}>
                    <IconChevronDown size={13} weight={2.2} />
                </span>
            </button>
            {open && <div style={{ paddingBottom: '0.25rem' }}>{children}</div>}
        </section>
    );
}

function CheckRow({ icon, label, count, checked, onChange }: {
    icon?: React.ReactNode; label: string; count: number; checked: boolean; onChange: () => void;
}) {
    // A zero-count option stays clickable when it is the one that's checked —
    // otherwise you could filter yourself into a corner you can't leave.
    const dead = count === 0 && !checked;
    return (
        <label
            style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.32rem 0.25rem', borderRadius: 'var(--radius-sm)',
                cursor: dead ? 'default' : 'pointer',
                opacity: dead ? 0.42 : 1,
                fontSize: '0.87rem',
            }}
        >
            <input
                type="checkbox"
                checked={checked}
                disabled={dead}
                onChange={onChange}
                style={{ accentColor: 'var(--brand)', width: 15, height: 15, flexShrink: 0 }}
            />
            {icon && <span style={{ display: 'flex', color: 'var(--gray-500)', flexShrink: 0 }}>{icon}</span>}
            <span style={{
                flex: 1, minWidth: 0, color: 'var(--gray-200)',
                fontWeight: checked ? 700 : 500,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
                {label}
            </span>
            <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', flexShrink: 0 }}>
                {count.toLocaleString()}
            </span>
        </label>
    );
}

function MoreButton({ expanded, onClick, label }: {
    expanded: boolean; onClick: () => void; label: string;
}) {
    return (
        <button
            onClick={onClick}
            aria-expanded={expanded}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                marginTop: '0.4rem', padding: '0.3rem 0.25rem',
                background: 'none', color: 'var(--gold)',
                fontSize: '0.8rem', fontWeight: 700,
            }}
        >
            {label}
            <span style={{
                display: 'flex',
                transform: expanded ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.22s var(--ease-out)',
            }}>
                <IconChevronDown size={13} weight={2.2} />
            </span>
        </button>
    );
}

function SegItem({ icon, label, active, onClick }: {
    icon: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            aria-pressed={active}
            style={{
                flex: 1,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem',
                padding: '0.42rem 0.35rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.76rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                background: active ? 'var(--navy-800)' : 'transparent',
                color: active ? 'var(--white)' : 'var(--gray-400)',
                border: active ? '1px solid var(--border-strong)' : '1px solid transparent',
            }}
        >
            {icon}
            {label}
        </button>
    );
}

export function Chip({ icon, label, active, onClick }: {
    icon?: React.ReactNode; label: string; active: boolean; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            aria-pressed={active}
            className="press"
            style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.32rem',
                padding: '0.32rem 0.7rem',
                borderRadius: 'var(--radius-pill)',
                fontSize: '0.79rem',
                fontWeight: 600,
                background: active ? 'var(--brand)' : 'var(--navy-800)',
                color: active ? 'var(--on-brand)' : 'var(--gray-300)',
                border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                whiteSpace: 'nowrap',
            }}
        >
            {icon}
            {label}
        </button>
    );
}
