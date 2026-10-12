import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewItem } from '../../types/review';
import { IconStar, IconChevronLeft, IconChevronRight } from '../icons/Icons';

interface ReviewCarouselProps {
    reviews: ReviewItem[];
    loading: boolean;
    /**
     * Where these reviews come from, said under the heading ("From Doctoralia ·
     * latest 10 of 2,820"). A listing can carry two carousels — Google's and
     * Doctoralia's — and the reader should never have to guess which is which.
     */
    note?: string;
}

export function ReviewCarousel({ reviews, loading, note }: ReviewCarouselProps) {
    const { t } = useTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(true);

    const updateScrollButtons = () => {
        const el = scrollRef.current;
        if (!el) return;
        setCanScrollLeft(el.scrollLeft > 4);
        setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
    };

    const scroll = (direction: 'left' | 'right') => {
        const el = scrollRef.current;
        if (!el) return;
        const amount = el.clientWidth * 0.8;
        el.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <SectionHeading>{t('drawer.topReviews')}</SectionHeading>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {[1, 2].map((i) => (
                        <div
                            key={i}
                            className="skeleton"
                            style={{
                                minWidth: 250, height: 132,
                                borderRadius: 'var(--radius)',
                                border: '1px solid var(--border)',
                            }}
                        />
                    ))}
                </div>
            </div>
        );
    }

    if (reviews.length === 0) return null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}>
                    <SectionHeading>{t('drawer.topReviews')}</SectionHeading>
                    {note && <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>{note}</span>}
                </div>

                {reviews.length > 1 && (
                    <div style={{ display: 'flex', gap: '0.3rem' }}>
                        <ScrollButton direction="left" disabled={!canScrollLeft} onClick={() => scroll('left')} />
                        <ScrollButton direction="right" disabled={!canScrollRight} onClick={() => scroll('right')} />
                    </div>
                )}
            </div>

            <div
                ref={scrollRef}
                onScroll={updateScrollButtons}
                className="review-scroll-track"
                style={{
                    display: 'flex',
                    gap: '0.75rem',
                    overflowX: 'auto',
                    scrollSnapType: 'x mandatory',
                    WebkitOverflowScrolling: 'touch',
                    paddingBottom: '0.25rem',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                }}
            >
                {reviews.map((review, idx) => (
                    <ReviewCard key={idx} review={review} />
                ))}
            </div>
        </div>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h3
            style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--gray-400)',
                margin: 0,
            }}
        >
            {children}
        </h3>
    );
}

/* ── Individual review card ───────────────────────────────────────────── */
function ReviewCard({ review }: { review: ReviewItem }) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const isLong = review.text.length > 120;

    return (
        <div
            style={{
                minWidth: 265,
                maxWidth: 285,
                flexShrink: 0,
                scrollSnapAlign: 'start',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: '0.95rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.6rem',
                transition: 'border-color 0.2s var(--ease-out)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
            {/* Author */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                {review.profile_photo_url ? (
                    <img
                        src={review.profile_photo_url}
                        alt=""
                        referrerPolicy="no-referrer"
                        style={{
                            width: 32, height: 32, borderRadius: '50%',
                            objectFit: 'cover',
                            border: '1px solid var(--border)',
                        }}
                    />
                ) : (
                    <div
                        style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'var(--brand)', color: 'var(--on-brand)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.8rem', fontWeight: 800,
                        }}
                    >
                        {review.author_name.charAt(0).toUpperCase()}
                    </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                        style={{
                            fontSize: '0.85rem', fontWeight: 700,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                    >
                        {review.author_name}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--gray-500)' }}>
                        {review.relative_time_description}
                    </div>
                </div>
            </div>

            {/* Stars */}
            <div style={{ display: 'flex', gap: '2px' }} aria-label={`${review.rating} / 5`}>
                {Array.from({ length: 5 }).map((_, i) => (
                    <IconStar
                        key={i}
                        size={13}
                        filled={i < review.rating}
                        style={{ color: i < review.rating ? 'var(--star)' : 'var(--gray-700)' }}
                    />
                ))}
            </div>

            <p
                style={{
                    fontSize: '0.84rem',
                    lineHeight: 1.55,
                    color: 'var(--gray-300)',
                    margin: 0,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: expanded ? 999 : 3,
                    WebkitBoxOrient: 'vertical',
                }}
            >
                {review.text || t('drawer.noWrittenReview')}
            </p>

            {review.translated && (
                <span style={{ fontSize: '0.72rem', color: 'var(--gray-500)', fontStyle: 'italic' }}>
                    {t('reviews.translated')}
                </span>
            )}

            {isLong && (
                <button
                    onClick={() => setExpanded(!expanded)}
                    style={{
                        background: 'none', border: 'none', padding: 0,
                        fontSize: '0.78rem', color: 'var(--gold)',
                        alignSelf: 'flex-start', fontWeight: 700,
                    }}
                >
                    {expanded ? t('drawer.showLess') : t('drawer.readMore')}
                </button>
            )}
        </div>
    );
}

/* ── Scroll arrow ─────────────────────────────────────────────────────── */
function ScrollButton({ direction, disabled, onClick }: {
    direction: 'left' | 'right';
    disabled: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            aria-label={direction === 'left' ? 'Previous reviews' : 'Next reviews'}
            style={{
                width: 28, height: 28,
                borderRadius: '50%',
                background: 'var(--navy-800)',
                border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.35 : 1,
                transition: 'opacity 0.15s var(--ease-out)',
                color: 'var(--gray-300)',
                padding: 0,
            }}
        >
            {direction === 'left' ? <IconChevronLeft size={15} weight={2} /> : <IconChevronRight size={15} weight={2} />}
        </button>
    );
}
