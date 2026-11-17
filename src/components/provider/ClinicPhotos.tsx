import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useGooglePhotos } from '../../hooks/useGooglePhotos';
import { googlePhotoAttribution } from '../../lib/googlePhotoAttribution';
import { PhotoLightbox, type LightboxPhoto } from './PhotoLightbox';

/**
 * Photos of the practice, pulled live from the provider's Google listing.
 *
 * Not stored in our database on purpose: Google's Places policies permit only
 * `place_id` to be retained indefinitely, and the photo URLs are signed and
 * expire. Fetching on open (and caching for the session) keeps us inside the
 * terms and avoids serving broken images.
 */
export function ClinicPhotos({ placeId, portrait, galleryUrls }: {
    placeId?: string;
    portrait?: string;
    /** Photos the provider published elsewhere (Doctoralia gallery); merged after the Google ones. */
    galleryUrls?: string[];
}) {
    const { t } = useTranslation();
    const { photos: googlePhotos, loading } = useGooglePhotos(placeId);
    const [open, setOpen] = useState<number | null>(null);
    /** URLs that failed to load — dropped from the strip and the lightbox so no broken tile shows. */
    const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
    const markBroken = useCallback((url: string) => {
        setBroken((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
    }, []);

    /**
     * The provider's own portrait leads, when it has a real one.
     *
     * Google photos only exist for the 1,390 providers carrying a
     * `googlePlaceId`; the 1,044 with a usable `imageUrl` are a different set.
     * Keying the whole section off `placeId` alone meant a provider whose photo
     * was already on its result card had no gallery here at all, which is the
     * "pictures on the detail page but not the card" complaint seen from the
     * other side.
     */
    const photos: LightboxPhoto[] = useMemo(() => {
        const merged: LightboxPhoto[] = [
            ...(portrait ? [{ url: portrait }] : []),
            ...googlePhotos,
            ...(galleryUrls ?? []).filter(Boolean).map((url) => ({ url })),
        ];
        const seen = new Set<string>();
        return merged.filter((p) => {
            if (seen.has(p.url) || broken.has(p.url)) return false;
            seen.add(p.url);
            return true;
        });
    }, [portrait, googlePhotos, galleryUrls, broken]);

    // Nothing to show and nothing pending — render no heading at all rather
    // than an empty section.
    if (photos.length === 0 && !(placeId && loading)) return null;

    return (
        <section>
            <h3
                style={{
                    fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: 'var(--gray-500)',
                    margin: '0 0 0.65rem',
                }}
            >
                {t('drawer.photos')}
            </h3>

            {loading && photos.length === 0 ? (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {[0, 1, 2].map((i) => (
                        <div
                            key={i}
                            style={{
                                width: 148, height: 104, flexShrink: 0,
                                borderRadius: 'var(--radius)',
                                background: 'var(--gray-100, rgba(128,128,128,0.12))',
                            }}
                        />
                    ))}
                </div>
            ) : (
                <>
                    <div
                        style={{
                            display: 'flex', gap: '0.5rem', overflowX: 'auto',
                            paddingBottom: '0.35rem', scrollSnapType: 'x mandatory',
                        }}
                    >
                        {photos.map((photo, i) => (
                            <button
                                key={photo.url}
                                onClick={() => setOpen(i)}
                                aria-label={`${t('drawer.photoAlt')} ${i + 1}`}
                                style={{
                                    padding: 0, border: 'none', background: 'none',
                                    flexShrink: 0, cursor: 'zoom-in', lineHeight: 0,
                                    borderRadius: 'var(--radius)', scrollSnapAlign: 'start',
                                }}
                            >
                                <img
                                    src={photo.url}
                                    alt={`${t('drawer.photoAlt')} ${i + 1}`}
                                    loading="lazy"
                                    decoding="async"
                                    onError={() => markBroken(photo.url)}
                                    style={{
                                        width: 148, height: 104, aspectRatio: '148 / 104',
                                        objectFit: 'cover', borderRadius: 'var(--radius)',
                                        background: 'var(--gray-100, rgba(128,128,128,0.12))',
                                    }}
                                />
                            </button>
                        ))}
                    </div>

                    {open !== null && (
                        <PhotoLightbox
                            photos={photos}
                            index={open}
                            onIndex={setOpen}
                            onClose={() => setOpen(null)}
                        />
                    )}

                    {/*
                      Google requires the photographer attribution it supplies to
                      be shown with the photo. It arrives as pre-built anchor
                      markup from the Places SDK, so it is parsed into elements
                      rather than injected as HTML — see lib/googlePhotoAttribution.
                    */}
                    {photos.some((p) => p.attributionHtml) && (
                        <p
                            style={{
                                margin: '0.45rem 0 0', fontSize: '0.7rem',
                                color: 'var(--gray-500)', lineHeight: 1.5,
                            }}
                        >
                            {googlePhotoAttribution(
                                [...new Set(photos.map((p) => p.attributionHtml).filter(Boolean))].join(' · '),
                            )}
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
