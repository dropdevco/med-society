import { Fragment, useRef, useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider, ProviderFilters } from '../../types/provider';
import type { DiscoverRow } from '../../utils/discover';
import { ProviderTile } from '../provider/ProviderTile';
import { IconChevronLeft, IconChevronRight, IconArrowRight } from '../icons/Icons';

interface DiscoverProps {
    rows: DiscoverRow[];
    loading: boolean;
    onSelect: (p: Provider) => void;
    /** Applies the row's filters, which flips the page into results mode. */
    onSeeAll: (patch: Partial<ProviderFilters>) => void;
    /** Shown after the first row (or first, when there are no rows): the hotels row. */
    afterFirst?: React.ReactNode;
}

/**
 * What sits under the search box before anyone has searched.
 *
 * Deliberately no map. A map answers "what is around here", but someone opening
 * a healthcare directory already knows they want a dentist — they need a way to
 * say so, and then something to look at while they decide. These rows are the
 * something: real providers, real photos, and each row is a search they can
 * step into with one click.
 */
export function Discover({ rows, loading, onSelect, onSeeAll, afterFirst }: DiscoverProps) {
    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2.75rem' }}>
                {[0, 1].map((i) => (
                    <div key={i}>
                        <div
                            className="skeleton"
                            style={{ width: 260, height: 22, borderRadius: 6, marginBottom: '1.1rem' }}
                        />
                        <div className="ms-row-track" style={{ overflow: 'hidden' }}>
                            {Array.from({ length: 7 }).map((_, j) => (
                                <div key={j} className="ms-row-cell">
                                    <div
                                        className="skeleton"
                                        style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 'var(--radius)' }}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2.75rem' }}>
            {rows.length === 0 && afterFirst}
            {rows.map((row, rowIndex) => (
                <Fragment key={row.id}>
                    <Row row={row} rowIndex={rowIndex} onSelect={onSelect} onSeeAll={onSeeAll} />
                    {rowIndex === 0 && afterFirst}
                </Fragment>
            ))}
        </div>
    );
}

function Row({ row, rowIndex, onSelect, onSeeAll }: {
    row: DiscoverRow;
    rowIndex: number;
    onSelect: (p: Provider) => void;
    onSeeAll: (patch: Partial<ProviderFilters>) => void;
}) {
    const { t } = useTranslation();
    const trackRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ start: true, end: false });

    /**
     * Which arrows are usable. Derived from scroll position rather than from a
     * click counter, so a trackpad swipe, a keyboard tab through the tiles and
     * a window resize all keep the arrows honest.
     */
    const measure = useCallback(() => {
        const el = trackRef.current;
        if (!el) return;
        const max = el.scrollWidth - el.clientWidth;
        setEdges({ start: el.scrollLeft <= 2, end: el.scrollLeft >= max - 2 });
    }, []);

    useEffect(() => {
        measure();
        const el = trackRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [measure]);

    const page = (dir: 1 | -1) => {
        const el = trackRef.current;
        if (!el) return;
        // Roughly a screenful, less one tile of overlap so nothing is skipped.
        el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' });
    };

    return (
        <section className="ms-row">
            <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '1rem', marginBottom: '1rem',
            }}>
                <button
                    onClick={() => onSeeAll(row.filters)}
                    className="ms-row-title"
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                        background: 'none', color: 'var(--white)', padding: 0,
                        fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-0.015em',
                        textAlign: 'left', minWidth: 0,
                    }}
                >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {t(row.titleKey)}
                    </span>
                    <span className="cta-arrow" style={{ display: 'flex', flexShrink: 0 }}>
                        <IconArrowRight size={18} weight={2.4} />
                    </span>
                </button>

                <div className="desktop-only" style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
                    <Arrow
                        dir="left"
                        disabled={edges.start}
                        label={t('discover.scrollBack')}
                        onClick={() => page(-1)}
                    />
                    <Arrow
                        dir="right"
                        disabled={edges.end}
                        label={t('discover.scrollOn')}
                        onClick={() => page(1)}
                    />
                </div>
            </div>

            <div ref={trackRef} onScroll={measure} className="ms-row-track">
                {row.providers.map((p, tileIndex) => (
                    <div key={p.id} className="ms-row-cell">
                        <ProviderTile
                            provider={p}
                            onClick={onSelect}
                            // Only the first couple of rows sit above the fold
                            // on load, and only their first handful of tiles —
                            // the rest of even those rows is off-screen until
                            // the user scrolls the row horizontally.
                            priority={rowIndex < 2 && tileIndex < 6}
                        />
                    </div>
                ))}
            </div>
        </section>
    );
}

function Arrow({ dir, disabled, label, onClick }: {
    dir: 'left' | 'right'; disabled: boolean; label: string; onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className="press"
            style={{
                width: 32, height: 32, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'var(--navy-800)',
                border: '1px solid var(--border)',
                color: disabled ? 'var(--gray-600)' : 'var(--white)',
                opacity: disabled ? 0.45 : 1,
                cursor: disabled ? 'default' : 'pointer',
            }}
        >
            {dir === 'left' ? <IconChevronLeft size={16} weight={2.2} /> : <IconChevronRight size={16} weight={2.2} />}
        </button>
    );
}
