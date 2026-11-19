import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { importLibrary } from '@googlemaps/js-api-loader';
// Side-effect import: configures the loader with our key. This worked
// without it only because the map chunk happened to load first; nothing
// guarantees that once these hooks are used outside the search page.
import '../lib/googleMaps';

export interface GoogleReview {
    author_name: string;
    rating: number;
    text: string;
    relative_time_description: string;
    profile_photo_url?: string;
}

/**
 * Reviews already fetched this session, keyed by `placeId:language`.
 *
 * Opening a provider fires a live Places round trip, which is most of the delay
 * when a drawer opens. Reviews change on the order of days, so re-fetching them
 * because a user reopened the same clinic is pure latency — and pure API spend.
 * The cache lives at module scope so it survives drawer unmount/remount.
 *
 * Language is part of the key, not an afterthought: the Places Details API
 * machine-translates review text (and localises `relative_time_description`)
 * to whatever `language` the request carries, so the same review comes back
 * as different text depending on the site's selected language. Caching by
 * placeId alone would have served an English visitor whatever language the
 * first visitor of the session happened to open that clinic in.
 */
const reviewCache = new Map<string, GoogleReview[]>();
const cacheKey = (placeId: string, lang: string) => `${placeId}:${lang}`;

/**
 * Fetches Google Place reviews for a given placeId using the Places Service.
 * Returns every review Google gives us, whatever the rating.
 * Automatically loads the Places library if not yet available.
 * Never invents reviews: with no place id, an API error, or no reviews on
 * Google, it returns an empty list and the page simply shows no review section.
 */
export function useGoogleReviews(placeId?: string) {
    const { i18n } = useTranslation();
    // Places only ships English and Spanish translations to us; anything else
    // the detector hands back (a browser locale, say) falls back to English
    // rather than sending Google a language code it doesn't recognise.
    const lang = i18n.language?.slice(0, 2) === 'es' ? 'es' : 'en';

    // Seed from cache during the first render so a revisited clinic — in the
    // language it was already viewed in — paints its reviews immediately,
    // with no loading flash.
    const [reviews, setReviews] = useState<GoogleReview[]>(
        () => (placeId && reviewCache.get(cacheKey(placeId, lang))) || [],
    );
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<string>('');

    useEffect(() => {
        if (!placeId) {
            setReviews([]);
            setStatus('no-place-id');
            return;
        }

        const key = cacheKey(placeId, lang);
        const cached = reviewCache.get(key);
        if (cached) {
            setReviews(cached);
            setStatus('cache');
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setStatus('loading');

        async function fetchReviews() {
            try {
                // Ensure the places library is loaded (idempotent — safe to call multiple times)
                await importLibrary('places');

                if (cancelled) return;

                const dummyDiv = document.createElement('div');
                const service = new google.maps.places.PlacesService(dummyDiv);

                service.getDetails(
                    {
                        placeId: placeId!,
                        fields: ['reviews'],
                        // The Details API machine-translates review text (and
                        // localises relative_time_description) to whatever
                        // language is requested here — this is the actual fix
                        // for "reviews stay in Spanish when the site is in
                        // English", and it costs nothing extra: it rides on a
                        // call we already make, no separate translation API.
                        language: lang,
                    },
                    (place, apiStatus) => {
                        if (cancelled) return;

                        console.log(`[useGoogleReviews] placeId=${placeId} lang=${lang} status=${apiStatus} reviews=${place?.reviews?.length ?? 0}`);
                        setStatus(apiStatus);

                        if (
                            apiStatus === google.maps.places.PlacesServiceStatus.OK &&
                            place?.reviews?.length
                        ) {
                            // Every review Google returns is shown, whatever the
                            // rating: a clinic with a rating must show the reviews
                            // behind it, and a 3-star-only listing showed none.
                            const good = place.reviews
                                .map((r) => ({
                                    author_name: r.author_name ?? 'Anonymous',
                                    rating: r.rating ?? 5,
                                    text: r.text ?? '',
                                    relative_time_description:
                                        (r as any).relative_time_description ?? '',
                                    profile_photo_url:
                                        (r as any).profile_photo_url ?? undefined,
                                }));
                            reviewCache.set(key, good);
                            setReviews(good);
                        } else {
                            // No reviews (or API limits / billing blocks): show none rather than invent any
                            console.warn(`[useGoogleReviews] status: ${apiStatus}. No reviews to show.`);
                            // Cache the fallback as well: asking again this
                            // session cannot produce reviews that do not exist,
                            // and each attempt is a billable Places call.
                            reviewCache.set(key, []);
                            setReviews([]);
                        }
                        setLoading(false);
                    }
                );
            } catch (err) {
                console.error('[useGoogleReviews] Error loading Places SDK:', err);
                if (!cancelled) {
                    // SDK could not load or key is invalid: show no reviews
                    setReviews([]);
                    setStatus('error-fallback');
                    setLoading(false);
                }
            }
        }

        fetchReviews();

        return () => { cancelled = true; };
    }, [placeId, lang]);

    return { reviews, loading, status };
}
