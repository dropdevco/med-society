import { useEffect, useRef, useState } from 'react';
import { importLibrary } from '@googlemaps/js-api-loader';
import { useTranslation } from 'react-i18next';
import { MAPS_API_KEY as API_KEY } from '../../lib/googleMaps';
import { darkMapStyles, lightMapStyles } from './mapStyles';
import { IconMapPin } from '../icons/Icons';

interface ProviderMapProps {
    lat: number;
    lng: number;
    name: string;
    /** Rendered under the placeholder when there is no API key to draw a real map. */
    address: string;
    directionsUrl: string;
}

/**
 * A small, single-marker map centred on one provider.
 *
 * Reuses the same loader configuration and map styling as the search
 * results' MapView (see `../../lib/googleMaps` and `./mapStyles`) so a
 * provider's own page never looks like a different product from the map it
 * was found on. Deliberately lighter than MapView: one marker, no
 * clustering, no camera restriction, no hover overview — the page around it
 * already carries the address and the "get directions" link.
 */
export function ProviderMap({ lat, lng, name, address, directionsUrl }: ProviderMapProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const markerRef = useRef<google.maps.Marker | null>(null);
    /**
     * The coordinates as of first mount, read once into a ref so the init
     * effect below can depend on nothing but `mapInstance` — exactly the
     * pattern MapView's own init effect uses for its region's initial frame.
     * A coordinate change after mount (navigating from one provider straight
     * to another) is handled by the sync effect further down, which
     * re-centres the already-created map instance instead of tearing it down.
     */
    const initialCoordsRef = useRef({ lat, lng });

    useEffect(() => {
        if (!API_KEY || !containerRef.current || mapInstance) return;

        let isMounted = true;
        (async () => {
            try {
                const { Map } = await importLibrary('maps');
                await importLibrary('marker');

                const initialTheme = document.documentElement.getAttribute('data-theme') || 'light';
                const map = new Map(containerRef.current!, {
                    center: initialCoordsRef.current,
                    zoom: 15,
                    zoomControl: true,
                    streetViewControl: false,
                    mapTypeControl: false,
                    fullscreenControl: false,
                    clickableIcons: false,
                    styles: initialTheme === 'dark' ? darkMapStyles : lightMapStyles,
                });

                if (isMounted) setMapInstance(map);
            } catch (err) {
                console.error('[ProviderMap] Maps init error:', err);
            }
        })();
        return () => { isMounted = false; };
    }, [mapInstance]);

    // Keep the marker (and camera) in sync if the provider identity changes
    // under an already-mounted map — e.g. navigating from one provider page
    // straight to another without a full remount.
    useEffect(() => {
        if (!mapInstance) return;
        mapInstance.setCenter({ lat, lng });

        if (!markerRef.current) {
            markerRef.current = new google.maps.Marker({
                map: mapInstance,
                position: { lat, lng },
                title: name,
            });
        } else {
            markerRef.current.setPosition({ lat, lng });
            markerRef.current.setTitle(name);
        }
    }, [mapInstance, lat, lng, name]);

    useEffect(() => {
        if (!mapInstance) return;
        const observer = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.attributeName !== 'data-theme') continue;
                const next = document.documentElement.getAttribute('data-theme');
                mapInstance.setOptions({ styles: next === 'dark' ? darkMapStyles : lightMapStyles });
            }
        });
        observer.observe(document.documentElement, { attributes: true });
        return () => observer.disconnect();
    }, [mapInstance]);

    if (!API_KEY) {
        return (
            <div
                style={{
                    width: '100%', height: '100%', minHeight: 200, position: 'relative',
                    background: 'var(--surface)', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: '0.6rem',
                    padding: '1.25rem',
                }}
            >
                <svg
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.4 }}
                    viewBox="0 0 400 200"
                    preserveAspectRatio="xMidYMid slice"
                >
                    <defs>
                        <pattern id="ms-provider-map-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="var(--border)" strokeWidth="1" />
                        </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#ms-provider-map-grid)" />
                </svg>
                <span style={{ position: 'relative', color: 'var(--gray-500)', display: 'flex' }}>
                    <IconMapPin size={26} weight={1.6} />
                </span>
                <p style={{ position: 'relative', fontSize: '0.85rem', color: 'var(--text)', fontWeight: 600, textAlign: 'center' }}>
                    {address}
                </p>
                <a
                    href={directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="press"
                    style={{
                        position: 'relative', fontSize: '0.82rem', fontWeight: 700,
                        color: 'var(--gold)', textDecoration: 'none',
                    }}
                >
                    {t('providerPage.getDirections')}
                </a>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            role="img"
            aria-label={t('providerPage.mapAlt', { name })}
            style={{
                width: '100%', height: '100%', minHeight: 200,
                borderRadius: 'var(--radius)', overflow: 'hidden',
                border: '1px solid var(--border)',
            }}
        />
    );
}
