import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderFilters, Specialty, Country } from '../../types/provider';
import { parseCityValue, suggest, type Suggestion, type SuggestVocabulary } from '../../utils/facets';
import { fold } from '../../utils/search';
import { isPostalQuery, normalizePostal } from '../../utils/geo';
import { REGIONS, type RegionId } from '../../utils/region';
import { regionPatch } from '../../utils/filters';
import { whereLabel as whereLabelOf } from '../../utils/place';
import { PlacePicker } from './PlacePicker';
import {
    IconSearch, IconClose, IconMapPin, IconStar, IconShield,
    IconCheck, SpecialtyIcon,
} from '../icons/Icons';

/** What the hero is holding before the user commits it. */
interface Draft {
    region: RegionId;
    text: string;
    specialty: Specialty[];
    country: Country | '';
    postalCode: string;
    insurances: string[];
}

interface SearchHeroProps {
    filters: ProviderFilters;
    vocabulary: SuggestVocabulary;
    /** Every insurer we hold, most common first. Feeds the third segment. */
    insurers: string[];
    /** Commits the draft as a filter patch — this is what runs the search. */
    onSubmit: (patch: Partial<ProviderFilters>) => void;
    /** A provider picked straight from autocomplete skips the results list. */
    onProvider: (id: string) => void;
    /** Focus the query field on mount — used when the header pill expands. */
    autoFocus?: boolean;
    /**
     * The WHERE the box is showing, committed or not, so a search run from
     * outside it (the smart bar beside it) can search the same place. Null
     * when the box unmounts.
     */
    onWhereChange?: (where: HeroWhere | null) => void;
    /**
     * The visitor picked a place in another border region. The region is what
     * the page is *about* (its rows, its map, its counts), not a filter waiting
     * for the Search button, so it is applied the moment it is picked — see
     * WherePopover. The typed query and any chosen specialties stay in the box.
     */
    onRegionChange?: (patch: Partial<ProviderFilters>) => void;
}

/** The WHERE segment's draft: region, side and postal code. */
export type HeroWhere = Pick<ProviderFilters, 'region' | 'country' | 'postalCode'>;

type Segment = 'what' | 'where' | 'cover' | null;

function draftFrom(f: ProviderFilters): Draft {
    return {
        region: f.region,
        text: f.search,
        specialty: f.specialty,
        country: f.country,
        postalCode: f.postalCode,
        insurances: f.insurances,
    };
}

/**
 * The search box, and the whole point of the redesign.
 *
 * Three segments, in the order a patient actually thinks: *what* is wrong,
 * *where* they can get to, and *what their cover pays for*. Nothing runs until
 * they press search — a half-built query that reloads the results on every
 * keystroke is why the old page had to open on a map, because there was never
 * a moment where the user had finished saying what they wanted.
 */
export function SearchHero({
    filters, vocabulary, insurers, onSubmit, onProvider, autoFocus, onWhereChange, onRegionChange,
}: SearchHeroProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<Draft>(() => draftFrom(filters));
    const [open, setOpen] = useState<Segment>(null);
    const [active, setActive] = useState(-1);
    const wrapRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Adopt filter changes made elsewhere — a removed chip, the back button, a
    // shared link. Compared against the filters we were built from rather than
    // synced in an effect, so the box never paints a stale query first.
    const [seen, setSeen] = useState(filters);
    if (filters !== seen) {
        setSeen(filters);
        const same = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);
        const untouched = seen.search === filters.search
            && same(seen.specialty, filters.specialty)
            && same(seen.insurances, filters.insurances);
        // Only the place changed (a region switch made from this very box, or
        // from the Filters dialog): take the new place, keep the words being typed.
        setDraft((d) => (untouched
            ? { ...d, region: filters.region, country: filters.country, postalCode: filters.postalCode }
            : draftFrom(filters)));
    }

    useEffect(() => {
        if (autoFocus) inputRef.current?.focus();
    }, [autoFocus]);

    useEffect(() => {
        onWhereChange?.({ region: draft.region, country: draft.country, postalCode: draft.postalCode });
        return () => onWhereChange?.(null);
    }, [onWhereChange, draft.region, draft.country, draft.postalCode]);

    /**
     * WHERE and Insurance open a popover rather than take text, so they are
     * buttons to the keyboard and to screen readers. Not real <button>s: the
     * popover (itself full of buttons) renders inside the segment, and buttons
     * cannot nest. Keys pressed inside the popover are its own business.
     */
    const segmentProps = (segment: 'where' | 'cover') => ({
        role: 'button' as const,
        tabIndex: 0,
        'aria-haspopup': 'dialog' as const,
        'aria-expanded': open === segment,
        onClick: () => setOpen(open === segment ? null : segment),
        onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(open === segment ? null : segment);
            }
        },
    });

    // WHERE and Insurance hang from a field that can sit low on a phone, so
    // their last rows (and the ZIP box) used to open below the screen with no
    // hint to scroll. Bring the popover fully into view when it opens; a
    // popover that already fits scrolls nothing.
    useEffect(() => {
        if (open !== 'where' && open !== 'cover') return;
        const pop = wrapRef.current?.querySelector('.ms-pop-where, .ms-pop-cover');
        if (!pop) return;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        pop.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(null);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const suggestions = useMemo(
        () => (open === 'what' ? suggest(vocabulary, draft.text) : []),
        [open, draft.text, vocabulary],
    );

    const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

    const submit = (override?: Partial<Draft>) => {
        const d = { ...draft, ...override };
        setOpen(null);
        // A bare five-digit query is a location, not a name. Committing it as
        // text as well would AND a literal digit match onto the radius and
        // return nothing.
        const asPostal = isPostalQuery(d.text);
        onSubmit({
            region: d.region,
            // A camera box drawn over the old region means nothing in the new one.
            ...(d.region !== filters.region ? { mapArea: null } : {}),
            search: asPostal ? '' : d.text.trim(),
            specialty: d.specialty,
            country: d.country,
            postalCode: asPostal ? normalizePostal(d.text) : d.postalCode,
            insurances: d.insurances,
        });
    };

    /**
     * A suggestion is a filter, not more text. Picking "Dentist" should narrow
     * the directory; leaving the word in the box would additionally demand that
     * clinics spell it out, and quietly drop the ones that don't.
     *
     * Picking *stages* the filter — it does not run the search. Committing on
     * click meant a query could only ever be one thing wide: tapping "Dentist"
     * reloaded the results before the user could add "Juárez" or their
     * insurer, and the box they were still typing in was already stale. The
     * search runs from the search button or Enter, and nowhere else.
     *
     * The exception is a provider, which is a destination rather than a filter
     * — there is nothing left to add to it.
     */
    const pick = (s: Suggestion) => {
        setActive(-1);
        switch (s.kind) {
            case 'specialty':
                patch({ text: '', specialty: [...new Set([...draft.specialty, s.value as Specialty])] });
                inputRef.current?.focus();
                break;
            case 'city': {
                // A city is a region plus a side of its border. Setting only
                // the side used to turn "Tijuana" into "all of Mexico", which
                // was mostly Ciudad Juárez.
                const where = parseCityValue(s.value);
                if (where) patch({ text: '', region: where.region, country: where.country, postalCode: '' });
                inputRef.current?.focus();
                break;
            }
            case 'postal':
                patch({ text: '', postalCode: s.value });
                inputRef.current?.focus();
                break;
            case 'insurance':
                patch({ text: '', insurances: [...new Set([...draft.insurances, s.value])] });
                inputRef.current?.focus();
                break;
            case 'provider':
                setOpen(null);
                onProvider(s.value);
                break;
            case 'service':
                // A service is free text — there is no filter axis for it, so
                // it has to land in the box and be searched as words.
                patch({ text: s.label });
                setOpen(null);
                break;
        }
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!suggestions.length) return;
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            const span = suggestions.length + 1; // the list, plus "nothing selected"
            setActive((i) => (((i + 1 + dir) % span) + span) % span - 1);
            return;
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (active >= 0 && suggestions[active]) pick(suggestions[active]);
            else submit();
        }
    };

    const whereLabel = whereLabelOf(draft, t);

    const coverLabel = draft.insurances.length === 0
        ? t('search.anyCover')
        : draft.insurances.length === 1
            ? draft.insurances[0]
            : t('search.coverCount', { count: draft.insurances.length });

    return (
        <div ref={wrapRef} className="ms-hero-wrap">
            <div className={`ms-hero${open ? ' is-open' : ''}`} role="search">
                {/* ── What ── */}
                <div
                    className={`ms-seg ms-seg-what${open === 'what' ? ' is-active' : ''}`}
                    onClick={() => { setOpen('what'); inputRef.current?.focus(); }}
                >
                    <label className="ms-seg-label" htmlFor="ms-hero-q">{t('search.whatLabel')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <input
                            id="ms-hero-q"
                            ref={inputRef}
                            type="text"
                            role="combobox"
                            aria-expanded={open === 'what' && suggestions.length > 0}
                            aria-controls="ms-hero-suggestions"
                            aria-autocomplete="list"
                            autoComplete="off"
                            className="ms-seg-input"
                            placeholder={t('search.whatPlaceholder')}
                            value={draft.text}
                            onChange={(e) => { patch({ text: e.target.value }); setOpen('what'); setActive(-1); }}
                            onKeyDown={onKeyDown}
                        />
                        {draft.text && (
                            <button
                                onClick={(e) => { e.stopPropagation(); patch({ text: '' }); inputRef.current?.focus(); }}
                                aria-label={t('search.clear')}
                                className="ms-seg-clear"
                            >
                                <IconClose size={14} weight={2.2} />
                            </button>
                        )}
                    </div>

                    {/* Specialties picked from autocomplete live here, not in the
                        box — they are filters now, and the box is free for the
                        next word. */}
                    {draft.specialty.length > 0 && (
                        <div className="ms-seg-tags">
                            {draft.specialty.map((s) => (
                                <MiniChip
                                    key={s}
                                    label={t(`specialties.${s}`)}
                                    onRemove={() => patch({ specialty: draft.specialty.filter((x) => x !== s) })}
                                />
                            ))}
                        </div>
                    )}

                    {open === 'what' && suggestions.length > 0 && (
                        <ul id="ms-hero-suggestions" role="listbox" className="ms-pop ms-pop-what">
                            {suggestions.map((s, i) => (
                                <li key={`${s.kind}:${s.value}:${s.label}`} role="option" aria-selected={i === active}>
                                    <button
                                        onMouseEnter={() => setActive(i)}
                                        onClick={(e) => { e.stopPropagation(); pick(s); }}
                                        className={`ms-pop-row${i === active ? ' is-active' : ''}`}
                                    >
                                        <SuggestionIcon s={s} />
                                        <span className="ms-pop-label">{s.label}</span>
                                        <span className="ms-pop-meta">
                                            {t(`search.kind.${s.kind}`, { defaultValue: '' })}
                                            {s.count ? ` · ${s.count.toLocaleString()}` : ''}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <span className="ms-seg-divider" aria-hidden="true" />

                {/* ── Where ── */}
                <div
                    className={`ms-seg ms-seg-where${open === 'where' ? ' is-active' : ''}`}
                    {...segmentProps('where')}
                >
                    <span className="ms-seg-label">{t('search.whereLabel')}</span>
                    <span className="ms-seg-value">
                        {whereLabel}
                    </span>

                    {open === 'where' && (
                        <WherePopover
                            draft={draft}
                            onPick={(p) => {
                                patch(p);
                                setOpen(null);
                                // Another region: switch the page now, not on Search.
                                if (p.region && p.region !== filters.region) {
                                    onRegionChange?.({ ...regionPatch(p.region), country: p.country ?? '' });
                                }
                            }}
                        />
                    )}
                </div>

                <span className="ms-seg-divider" aria-hidden="true" />

                {/* ── Cover ── */}
                <div
                    className={`ms-seg ms-seg-cover${open === 'cover' ? ' is-active' : ''}`}
                    {...segmentProps('cover')}
                >
                    <span className="ms-seg-label">{t('search.coverLabel')}</span>
                    <span className={`ms-seg-value${draft.insurances.length ? '' : ' is-empty'}`}>
                        {coverLabel}
                    </span>

                    {open === 'cover' && (
                        <CoverPopover
                            insurers={insurers}
                            selected={draft.insurances}
                            onToggle={(name) => patch({
                                insurances: draft.insurances.includes(name)
                                    ? draft.insurances.filter((x) => x !== name)
                                    : [...draft.insurances, name],
                            })}
                            onClear={() => patch({ insurances: [] })}
                        />
                    )}
                </div>

                <button
                    onClick={() => submit()}
                    className="ms-hero-go press"
                    aria-label={t('search.submit')}
                >
                    <IconSearch size={19} weight={2.4} />
                    <span className="ms-hero-go-text">{t('search.submit')}</span>
                </button>
            </div>
        </div>
    );
}

/**
 * One list of places (see PlacePicker), then an optional ZIP. A row is a whole
 * crossing or one of its cities; either way it sets the region and the side in
 * one tap and closes the popover, and drops any ZIP the old place had. A ZIP
 * narrows within the region the draft already holds.
 */
function WherePopover({ draft, onPick }: {
    draft: Draft;
    onPick: (p: Partial<Draft>) => void;
}) {
    const { t } = useTranslation();
    const [zip, setZip] = useState(draft.postalCode);
    const region = REGIONS[draft.region];

    return (
        <div className="ms-pop ms-pop-where" onClick={(e) => e.stopPropagation()}>
            <PlacePicker
                value={draft}
                active={!draft.postalCode}
                onPick={(place) => onPick({ region: place.region, country: place.country, postalCode: '' })}
            />

            <div className="ms-pop-sep" />

            <form
                onSubmit={(e) => { e.preventDefault(); if (isPostalQuery(zip)) onPick({ postalCode: normalizePostal(zip) }); }}
                className="ms-pop-zip"
            >
                <label htmlFor="ms-hero-zip">{t('search.zipLabel')}</label>
                <input
                    id="ms-hero-zip"
                    inputMode="numeric"
                    maxLength={10}
                    placeholder={region.postalHint}
                    value={zip}
                    // The hyphen survives so a pasted ZIP+4 can be recognised
                    // and truncated, rather than silently becoming nine digits
                    // that match nothing.
                    onChange={(e) => setZip(e.target.value.replace(/[^\d-]/g, ''))}
                />
                <button type="submit" disabled={!isPostalQuery(zip)}>
                    {t('search.zipApply')}
                </button>
            </form>
        </div>
    );
}

/** How many insurers fit before the list stops being a list. */
const COVER_SHOWN = 8;

function CoverPopover({ insurers, selected, onToggle, onClear }: {
    insurers: string[]; selected: string[];
    onToggle: (name: string) => void; onClear: () => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');

    const shown = useMemo(() => {
        const q = fold(query.trim());
        const matched = q ? insurers.filter((n) => fold(n).includes(q)) : insurers;
        // A selected insurer always renders, or the search box can hide the
        // very filter the user is trying to switch off.
        return [...new Set([...selected, ...matched])].slice(0, COVER_SHOWN + selected.length);
    }, [insurers, query, selected]);

    return (
        <div className="ms-pop ms-pop-cover" onClick={(e) => e.stopPropagation()}>
            <div className="ms-pop-search">
                <IconShield size={15} />
                <input
                    autoFocus
                    placeholder={t('filters.insuranceSearch')}
                    aria-label={t('filters.insuranceSearch')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                />
            </div>

            <button onClick={onClear} className={`ms-pop-row${selected.length === 0 ? ' is-chosen' : ''}`}>
                <span className="ms-pop-label"><strong>{t('search.anyCover')}</strong></span>
                {selected.length === 0 && (
                    <span className="ms-pop-meta"><IconCheck size={15} weight={2.4} /></span>
                )}
            </button>

            {shown.map((name) => (
                <button
                    key={name}
                    onClick={() => onToggle(name)}
                    className={`ms-pop-row${selected.includes(name) ? ' is-chosen' : ''}`}
                >
                    <span className="ms-pop-label"><strong>{name}</strong></span>
                    {selected.includes(name) && (
                        <span className="ms-pop-meta"><IconCheck size={15} weight={2.4} /></span>
                    )}
                </button>
            ))}

            {shown.length === 0 && (
                <p className="ms-pop-empty">{t('filters.noInsurers')}</p>
            )}
        </div>
    );
}

function MiniChip({ label, onRemove }: { label: string; onRemove: () => void }) {
    return (
        <span className="ms-mini-chip">
            {label}
            <button
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                aria-label={`Remove ${label}`}
            >
                <IconClose size={11} weight={2.4} />
            </button>
        </span>
    );
}

function SuggestionIcon({ s }: { s: Suggestion }) {
    const inner =
        s.kind === 'specialty' ? <SpecialtyIcon specialty={s.value as Specialty} size={16} />
            : s.kind === 'city' || s.kind === 'postal' ? <IconMapPin size={16} />
                : s.kind === 'provider' ? <IconStar size={16} />
                    : s.kind === 'insurance' ? <IconShield size={16} />
                        : <IconSearch size={16} />;
    return <span className="ms-pop-ico">{inner}</span>;
}
