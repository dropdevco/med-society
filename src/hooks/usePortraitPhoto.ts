import { useSyncExternalStore } from 'react';
import type { Provider } from '../types/provider';
import { portraitImage, portraitWidth2x, PORTRAIT_WIDTHS, type PortraitSize } from '../utils/images';
import { placePhotoUrl, placePhotoProxyState, subscribePlacePhotoProxy } from '../utils/placePhoto';
import { useGooglePhotos } from './useGooglePhotos';

/**
 * The best photo we can show for a provider right now, without storing
 * anything new.
 *
 * A usable `imageUrl` wins outright (sized for `size` — see
 * src/utils/images.ts). Failing that, and only when the provider has a
 * `googlePlaceId`, there are two ways to get a Google photo:
 *
 * 1. The server proxy at /api/place-photo (see api/place-photo.ts) — a plain
 *    URL that resolves straight to a redirect, no JS SDK needed. This is the
 *    fast path and the one used whenever it's available.
 * 2. `useGooglePhotos`, which loads the Google Maps JS SDK client-side and
 *    calls `PlacesService.getDetails`. This is the slow path (Maps script
 *    ~4s, details ~5s, per the perf notes on place-photo.ts) kept only as a
 *    fallback for local dev without the proxy wired up, or a deploy missing
 *    `GOOGLE_PLACES_SERVER_KEY`.
 *
 * Which path applies depends on `placePhotoProxyState()`, a session-wide
 * probe (see src/utils/placePhoto.ts) of whether /api/place-photo actually
 * answers: `true` → path 1, `false` → path 2, `undefined` → probe still
 * pending, in which case neither path starts yet (the probe itself is fast,
 * so this is normally a very brief window) and the caller's existing
 * no-photo fallback (the monogram) stays visible.
 *
 * `useGooglePhotos` is always called (rules of hooks — its argument, not the
 * call itself, is conditional) with `undefined` whenever it shouldn't
 * actually fetch: when a static photo is already in hand, when the proxy is
 * available, or while the probe is still pending. The hook already treats an
 * undefined placeId as "nothing to fetch".
 *
 * No skeleton or spinner state is exposed beyond `loading`: the caller's
 * existing no-photo fallback (the monogram) is the visible state until a URL
 * resolves, then the photo pops in — the same behaviour the drawer's own
 * gallery already has. When the proxy 404s (place has no photo), the
 * tile/card's <img onError> already falls back to the monogram.
 */
export function usePortraitPhoto(
    provider: Provider,
    size: PortraitSize = 'large',
): { url?: string; srcSet?: string; loading: boolean } {
    const staticImage = portraitImage(provider.imageUrl, size);
    const staticUrl = staticImage?.src;
    const proxyReady = useSyncExternalStore(subscribePlacePhotoProxy, placePhotoProxyState, placePhotoProxyState);

    const placeId = provider.googlePlaceId;
    const useClientFallback = !staticUrl && proxyReady === false && Boolean(placeId);
    const { photos, loading: googleLoading } = useGooglePhotos(useClientFallback ? placeId : undefined);

    if (staticUrl) {
        return { url: staticUrl, srcSet: staticImage?.srcSet, loading: false };
    }
    if (!placeId) {
        return { url: undefined, loading: false };
    }
    if (proxyReady === undefined) {
        // Probe still pending — don't start either photo path yet.
        return { url: undefined, loading: true };
    }
    if (proxyReady) {
        // Only high-density screens ask for the wider (separately cached) size.
        return {
            url: placePhotoUrl(placeId, PORTRAIT_WIDTHS[size]),
            srcSet: size === 'large' ? undefined : `${placePhotoUrl(placeId, portraitWidth2x(size))} 2x`,
            loading: false,
        };
    }
    return { url: photos[0]?.url, loading: googleLoading };
}
