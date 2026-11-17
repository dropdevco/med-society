import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconClose, IconChevronLeft, IconChevronRight } from '../icons/Icons';
import { googlePhotoAttribution } from '../../lib/googlePhotoAttribution';

export interface LightboxPhoto {
    url: string;
    /** Pre-built anchor markup from the Places SDK, parsed before render. */
    attributionHtml?: string;
}

/**
 * Full-view gallery for a clinic's photos.
 *
 * The drawer showed photos as a 148x104 scroll strip with no click handler, so
 * the only way to see what a clinic actually looks like was to squint at a
 * thumbnail — on a directory where photo quality is the thing we are asking
 * clinics to compete on. This is the other half of that: tap a thumbnail, see
 * the photo.
 *
 * Modelled on InquiryModal, which is the house pattern for an overlay: scrim
 * that closes on click, stopPropagation on the panel, Escape to close, body
 * scroll locked while open, role="dialog" aria-modal.
 */
export function PhotoLightbox({ photos, index, onClose, onIndex }: {
    photos: LightboxPhoto[];
    index: number;
    onClose: () => void;
    onIndex: (next: number) => void;
}) {
    const { t } = useTranslation();
    const closeRef = useRef<HTMLButtonElement>(null);
    const touchX = useRef<number | null>(null);

    const count = photos.length;
    const step = useCallback((delta: number) => {
        if (count === 0) return;
        // Wraps, so holding the arrow key at either end is not a dead control.
        onIndex(((index + delta) % count + count) % count);
    }, [count, index, onIndex]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        };
        window.addEventListener('keydown', onKey);
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        closeRef.current?.focus();
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = previous;
        };
    }, [onClose, step]);

    const photo = photos[index];
    if (!photo) return null;

    /**
     * Portalled to the body, not rendered in place.
     *
     * The drawer animates in with a transform, and a transformed ancestor
     * becomes the containing block for `position: fixed` descendants — so a
     * full-screen scrim rendered inside the drawer covered the drawer and
     * nothing else, which is the opposite of a lightbox.
     */
    return createPortal(
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('drawer.photos')}
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 300,
                background: 'rgba(8, 15, 28, 0.88)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '3.5rem 1rem 1rem',
                animation: 'fadeIn 0.18s var(--ease-out) both',
            }}
            onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={(e) => {
                const start = touchX.current;
                touchX.current = null;
                const end = e.changedTouches[0]?.clientX;
                if (start == null || end == null) return;
                // 48px of travel before it counts, so a tap that drifts a
                // couple of pixels does not advance the gallery.
                if (Math.abs(end - start) > 48) step(end < start ? 1 : -1);
            }}
        >
            <button
                ref={closeRef}
                onClick={onClose}
                aria-label={t('search.clear')}
                style={{ ...circleStyle, top: '1rem', right: '1rem' }}
            >
                <IconClose size={20} weight={2.2} />
            </button>

            {count > 1 && (
                <>
                    <button
                        onClick={(e) => { e.stopPropagation(); step(-1); }}
                        aria-label={t('drawer.photoPrev')}
                        style={{ ...circleStyle, left: '1rem', top: '50%', transform: 'translateY(-50%)' }}
                    >
                        <IconChevronLeft size={22} weight={2.2} />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); step(1); }}
                        aria-label={t('drawer.photoNext')}
                        style={{ ...circleStyle, right: '1rem', top: '50%', transform: 'translateY(-50%)' }}
                    >
                        <IconChevronRight size={22} weight={2.2} />
                    </button>
                </>
            )}

            <img
                src={photo.url}
                alt={`${t('drawer.photoAlt')} ${index + 1}`}
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                    borderRadius: 'var(--radius)',
                    boxShadow: '0 24px 70px rgba(0,0,0,0.5)',
                }}
            />

            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    marginTop: '0.85rem', textAlign: 'center',
                    color: 'rgba(255,255,255,0.72)', fontSize: '0.76rem', lineHeight: 1.5,
                    maxWidth: '46rem',
                }}
            >
                {count > 1 && (
                    <div style={{ fontWeight: 700, marginBottom: photo.attributionHtml ? '0.3rem' : 0 }}>
                        {t('drawer.photoCount', { index: index + 1, total: count })}
                    </div>
                )}
                {/*
                  Google requires the photographer attribution it supplies to be
                  shown with the photo, so it travels into the full view too —
                  a lightbox that drops it would be the one place we display the
                  photo largest and credit it least.
                */}
                {photo.attributionHtml && (
                    <span className="ms-photo-credit">
                        {googlePhotoAttribution(photo.attributionHtml)}
                    </span>
                )}
            </div>
        </div>,
        document.body,
    );
}

const circleStyle: React.CSSProperties = {
    position: 'absolute',
    width: 42, height: 42, borderRadius: '50%',
    background: 'rgba(255,255,255,0.14)',
    border: '1px solid rgba(255,255,255,0.28)',
    color: '#ffffff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 1,
};
