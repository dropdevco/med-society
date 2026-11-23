import { useEffect, useRef } from 'react';
import { importLibrary } from '@googlemaps/js-api-loader';
import { MAPS_API_KEY } from '../../lib/googleMaps';
import { darkMapStyles, lightMapStyles } from '../map/mapStyles';
import type { Hotel } from '../../types/hotel';

interface Props {
    hotels: Hotel[];
    center: { lat: number; lng: number };
    /** The provider the list was opened from, drawn as a distinct pin. */
    origin?: { lat: number; lng: number; name: string } | null;
}

/** A plain map of the hotels in the list. Renders nothing without a Maps key. */
export function HotelMap({ hotels, center, origin }: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const mapRef = useRef<google.maps.Map | null>(null);
    const markers = useRef<google.maps.Marker[]>([]);

    useEffect(() => {
        if (!MAPS_API_KEY || !ref.current) return;
        let live = true;
        (async () => {
            try {
                const { Map } = await importLibrary('maps');
                await importLibrary('marker');
                if (!live || !ref.current) return;
                if (!mapRef.current) {
                    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
                    mapRef.current = new Map(ref.current, {
                        center, zoom: 13, streetViewControl: false, mapTypeControl: false,
                        fullscreenControl: false, clickableIcons: false,
                        styles: dark ? darkMapStyles : lightMapStyles,
                    });
                }
                const map = mapRef.current;
                markers.current.forEach((m) => m.setMap(null));
                markers.current = hotels.map((h) => new google.maps.Marker({ map, position: { lat: h.lat, lng: h.lng }, title: h.name }));
                const bounds = new google.maps.LatLngBounds();
                hotels.forEach((h) => bounds.extend({ lat: h.lat, lng: h.lng }));
                if (origin) {
                    markers.current.push(new google.maps.Marker({
                        map, position: origin, title: origin.name,
                        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#e11d48', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
                    }));
                    bounds.extend(origin);
                }
                if (!bounds.isEmpty() && (hotels.length + (origin ? 1 : 0)) > 1) map.fitBounds(bounds, 48);
                else map.setCenter(origin ?? (hotels[0] ? { lat: hotels[0].lat, lng: hotels[0].lng } : center));
            } catch (err) {
                console.error('[HotelMap] Maps init error:', err);
            }
        })();
        return () => { live = false; };
        // center only matters for the first frame
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hotels, origin]);

    if (!MAPS_API_KEY) return null;
    // Google sets inline `position: relative` on the div it draws into, so the
    // sticky positioning lives on a wrapper it never touches.
    return (
        <div className="ms-hotels-map" role="region" aria-label="Map">
            <div ref={ref} style={{ width: '100%', height: '100%' }} />
        </div>
    );
}
