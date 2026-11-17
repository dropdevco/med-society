import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { IconSearch, IconClose, IconMapPin, IconStar, SpecialtyIcon } from '../icons/Icons';
import type { Specialty } from '../../types/provider';
import { suggest, type Suggestion, type SuggestVocabulary } from '../../utils/facets';

interface SearchBarProps {
    value: string;
    /** Commits the query text. Already debounced by the time it fires. */
    onChange: (v: string) => void;
    /** A picked suggestion — usually a filter to set, not text to search. */
    onSuggestion: (s: Suggestion) => void;
    vocabulary: SuggestVocabulary;
    /** Bigger type and padding for the page-level search band. */
    large?: boolean;
    ref?: Ref<HTMLInputElement>;
}

/**
 * Typing re-scores every provider, so the query is committed on a trailing
 * delay rather than per character. Short enough to feel live, long enough that
 * a fast typist triggers one pass instead of twelve.
 */
const DEBOUNCE_MS = 120;

export function SearchBar({ value, onChange, onSuggestion, vocabulary, large, ref }: SearchBarProps) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState(value);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const wrapRef = useRef<HTMLDivElement>(null);
    // What we last pushed upward. Comparing against it is what tells an echo of
    // our own commit apart from a genuine external change — without it, the
    // parent's re-render lands mid-debounce and eats the characters typed since.
    const [committed, setCommitted] = useState(value);

    // Adopt an external change (a cleared chip, the back button, a shared URL).
    // Adjusting state during render rather than in an effect: React re-runs this
    // component before touching the DOM, so the input never paints the stale
    // value, and no cascading second render is scheduled.
    if (value !== committed) {
        setCommitted(value);
        setDraft(value);
    }

    useEffect(() => {
        if (draft === committed) return;
        const id = window.setTimeout(() => {
            setCommitted(draft);
            onChange(draft);
        }, DEBOUNCE_MS);
        return () => window.clearTimeout(id);
    }, [draft, committed, onChange]);

    const suggestions = useMemo(
        () => (open ? suggest(vocabulary, draft) : []),
        [open, draft, vocabulary],
    );

    // A click anywhere else dismisses the list; blur alone would fire before
    // the click on a suggestion could land.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const commitNow = (text: string) => {
        setCommitted(text);
        onChange(text);
    };

    const pick = (s: Suggestion) => {
        setOpen(false);
        setActive(-1);
        // A concept suggestion sets a filter, so the box is emptied — leaving
        // the word behind would AND a text match on top of the filter and
        // quietly drop clinics that carry the tag but never spell it out. A
        // service name is a text query, so it stays. Either way draft and
        // committed move together, or the next render reads the gap between
        // them as an external change and undoes this.
        const text = s.kind === 'service' ? s.label : '';
        setDraft(text);
        setCommitted(text);
        onSuggestion(s);
    };

    const onKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setOpen(false);
            setActive(-1);
            return;
        }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!suggestions.length) return;
            e.preventDefault();
            const dir = e.key === 'ArrowDown' ? 1 : -1;
            const span = suggestions.length + 1; // the list, plus "nothing selected"
            // -1 means the raw query is what Enter submits, and it stays in the
            // cycle so arrowing back up returns you to what you typed.
            setActive((i) => (((i + 1 + dir) % span) + span) % span - 1);
            return;
        }
        if (e.key === 'Enter') {
            if (active >= 0 && suggestions[active]) {
                e.preventDefault();
                pick(suggestions[active]);
            } else {
                setOpen(false);
                commitNow(draft);
            }
        }
    };

    const pad = large ? '1.05rem 3rem 1.05rem 3.1rem' : '0.8rem 2.6rem 0.8rem 2.75rem';

    return (
        <div ref={wrapRef} style={{ position: 'relative' }}>
            <span
                style={{
                    position: 'absolute', left: large ? '1.1rem' : '0.9rem', top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--gray-500)', pointerEvents: 'none',
                    display: 'flex',
                }}
            >
                <IconSearch size={large ? 20 : 18} />
            </span>
            <input
                ref={ref}
                type="search"
                role="combobox"
                aria-expanded={open && suggestions.length > 0}
                aria-controls="search-suggestions"
                aria-autocomplete="list"
                autoComplete="off"
                placeholder={t('search.placeholder')}
                aria-label={t('search.placeholder')}
                value={draft}
                onChange={(e) => {
                    setDraft(e.target.value);
                    setOpen(true);
                    setActive(-1);
                }}
                onFocus={(e) => {
                    setOpen(true);
                    e.currentTarget.style.borderColor = 'var(--gold)';
                    e.currentTarget.style.boxShadow = '0 0 0 3px var(--gold-dim)';
                }}
                onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = 'none';
                }}
                onKeyDown={onKeyDown}
                className="tint"
                style={{
                    width: '100%',
                    padding: pad,
                    background: 'var(--navy-800)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-pill)',
                    color: 'var(--white)',
                    fontSize: large ? '1.05rem' : '0.95rem',
                    fontWeight: 500,
                    outline: 'none',
                }}
            />
            {draft && (
                <button
                    onClick={() => {
                        setDraft('');
                        commitNow('');
                        setOpen(false);
                    }}
                    aria-label={t('search.clear')}
                    title={t('search.clear')}
                    style={{
                        position: 'absolute', right: large ? '1.1rem' : '0.85rem', top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none', color: 'var(--gray-500)',
                        display: 'flex', alignItems: 'center', padding: 0,
                    }}
                >
                    <IconClose size={16} weight={2} />
                </button>
            )}

            {open && suggestions.length > 0 && (
                <ul
                    id="search-suggestions"
                    role="listbox"
                    style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                        zIndex: 60, listStyle: 'none', margin: 0, padding: '0.35rem',
                        background: 'var(--navy-800)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        boxShadow: 'var(--shadow)',
                        maxHeight: '22rem', overflowY: 'auto',
                    }}
                >
                    {suggestions.map((s, i) => (
                        <li key={`${s.kind}:${s.value}`} role="option" aria-selected={i === active}>
                            <button
                                onMouseEnter={() => setActive(i)}
                                onClick={() => pick(s)}
                                style={{
                                    width: '100%', display: 'flex', alignItems: 'center', gap: '0.6rem',
                                    padding: '0.5rem 0.6rem', textAlign: 'left',
                                    borderRadius: 'var(--radius-sm)',
                                    background: i === active ? 'var(--surface-hover)' : 'transparent',
                                    color: 'var(--white)', fontSize: '0.9rem',
                                }}
                            >
                                <SuggestionIcon s={s} />
                                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {s.label}
                                </span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--gray-500)', flexShrink: 0 }}>
                                    {t(`search.kind.${s.clinic ? 'clinic' : s.kind}`, { defaultValue: '' })}
                                    {s.count ? ` · ${s.count.toLocaleString()}` : ''}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function SuggestionIcon({ s }: { s: Suggestion }) {
    const box = { display: 'flex', flexShrink: 0, color: 'var(--gray-500)' } as const;
    if (s.kind === 'specialty') {
        return <span style={box}><SpecialtyIcon specialty={s.value as Specialty} size={16} /></span>;
    }
    if (s.kind === 'city' || s.kind === 'postal') {
        return <span style={box}><IconMapPin size={16} /></span>;
    }
    if (s.kind === 'provider') {
        return <span style={box}><IconStar size={16} /></span>;
    }
    return <span style={box}><IconSearch size={16} /></span>;
}
