import { useCallback, useEffect, useState } from 'react';
import { listAllHotels, saveHotel, type HotelInput } from '../../lib/hotelRead';
import { HOTEL_AMENITIES, type Hotel, type HotelAmenity, type HotelStatus } from '../../types/hotel';
import { regionOf } from '../../utils/region';
import { Card } from './charts';

/**
 * Curated hotels (migration 0054, docs/hotels.md). New hotels start as drafts;
 * nothing is public until it is published here. The database refuses every
 * write from anyone who is not an admin, whatever this form allows.
 */

const AMENITY_LABEL: Record<HotelAmenity, string> = {
    clinic_shuttle: 'Clinic shuttle', airport_shuttle: 'Airport shuttle', border_shuttle: 'Border shuttle',
    accessible: 'Accessible', kitchenette: 'Kitchenette', quiet_recovery: 'Quiet for recovery',
    nurse_on_call: 'Nurse on call', bilingual_staff: 'English-speaking staff', parking: 'Parking',
};

/**
 * "32.5272, -117.0222", or a Google Maps link (…/@32.52,-117.02,15z or
 * …!3d32.52!4d-117.02). The `!3d!4d` pair is the place itself and wins over
 * `@`, which is only where the map was looking.
 */
function parseCoords(text: string): { lat: number; lng: number } | null {
    const t = text.trim();
    const m = t.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
        ?? t.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
        ?? t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const lat = Number(m[1]); const lng = Number(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat, lng };
}

interface Draft {
    name: string; city: string; country: 'MX' | 'US'; address: string; coords: string;
    phone: string; website: string; booking_url: string; photo_url: string;
    price_band: string; rating: string; descEn: string; descEs: string;
    amenities: HotelAmenity[]; status: HotelStatus;
}

const EMPTY: Draft = {
    name: '', city: 'Tijuana', country: 'MX', address: '', coords: '', phone: '', website: '', booking_url: '', photo_url: '',
    price_band: '', rating: '', descEn: '', descEs: '', amenities: [], status: 'pending',
};

const toDraft = (h: Hotel): Draft => ({
    name: h.name, city: h.city, country: h.country === 'US' ? 'US' : 'MX', address: h.address ?? '', coords: `${h.lat}, ${h.lng}`,
    phone: h.phone ?? '', website: h.website ?? '', booking_url: h.booking_url ?? '', photo_url: h.photo_url ?? '',
    price_band: h.price_band?.toString() ?? '', rating: h.rating?.toString() ?? '',
    descEn: h.description.en ?? '', descEs: h.description.es ?? '', amenities: h.amenities, status: h.status,
});

const orNull = (s: string) => (s.trim() ? s.trim() : null);

function toInput(d: Draft): HotelInput | string {
    if (d.name.trim().length < 2) return 'Name is required.';
    if (!d.city.trim()) return 'City is required.';
    const at = parseCoords(d.coords);
    if (!at) return 'Coordinates: paste "lat, lng" or a Google Maps link.';
    if (!regionOf(at.lng)) return 'Coordinates are outside both regions.';
    for (const [label, v] of [['Booking link', d.booking_url], ['Photo URL', d.photo_url]] as const) {
        if (v.trim() && !/^https:\/\//i.test(v.trim())) return `${label} must start with https://`;
    }
    if (d.website.trim() && !/^https?:\/\//i.test(d.website.trim())) return 'Website must start with http:// or https://';
    const rating = d.rating.trim() ? Number(d.rating) : null;
    if (rating !== null && !(rating >= 0 && rating <= 5)) return 'Rating is 0 to 5.';
    const description: Hotel['description'] = {};
    if (d.descEn.trim()) description.en = d.descEn.trim();
    if (d.descEs.trim()) description.es = d.descEs.trim();
    return {
        name: d.name.trim(), city: d.city.trim(), address: orNull(d.address), country: d.country,
        lat: at.lat, lng: at.lng, phone: orNull(d.phone), website: orNull(d.website),
        booking_url: orNull(d.booking_url), photo_url: orNull(d.photo_url),
        price_band: d.price_band ? Number(d.price_band) : null, rating,
        description, amenities: d.amenities, status: d.status,
    };
}

export function HotelsPanel() {
    const [hotels, setHotels] = useState<Hotel[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | 'new' | null>(null);

    const load = useCallback(() => {
        listAllHotels().then((h) => { setHotels(h); setError(null); }).catch((e: Error) => setError(e.message));
    }, []);
    useEffect(() => { load(); }, [load]);

    if (error) return <p className="adm-err" role="alert">Could not load hotels: {error}. Is migration 0054 applied?</p>;
    if (!hotels) return <p className="adm-empty">Loading hotels…</p>;

    const setStatus = async (h: Hotel, status: HotelStatus) => {
        try { await saveHotel({ ...toInputOf(h), status }, h.id); load(); } catch (e) { setError((e as Error).message); }
    };

    return (
        <div className="adm-stack">
            <div className="adm-tools">
                <button type="button" className="adm-btn" onClick={() => setEditing('new')} disabled={editing === 'new'}>Add a hotel</button>
                <span className="adm-empty">
                    {hotels.filter((h) => h.status === 'live').length} live · {hotels.filter((h) => h.status === 'pending').length} drafts · {hotels.filter((h) => h.status === 'hidden').length} hidden
                </span>
            </div>

            {editing === 'new' && (
                <HotelForm initial={EMPTY} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
            )}

            <Card title="Hotels" wide>
                {hotels.length === 0 ? <p className="adm-empty">No hotels yet.</p> : hotels.map((h) => (
                    <div className="adm-line" key={h.id}>
                        <b>{h.name} · {h.city} · {h.status}</b>
                        <span>
                            {h.price_band ? '$'.repeat(h.price_band) : 'no price band'} · {h.amenities.length} amenities
                            {' · '}{h.booking_url ? 'Booking.com link' : h.website ? 'website only' : 'no link'}
                            {' · updated '}{h.updated_at.slice(0, 10)}
                        </span>
                        <span className="adm-tools" style={{ margin: '6px 0 0' }}>
                            <button type="button" className="adm-link" onClick={() => setEditing(editing === h.id ? null : h.id)}>{editing === h.id ? 'Close' : 'Edit'}</button>
                            {h.status !== 'live' && <button type="button" className="adm-link" onClick={() => void setStatus(h, 'live')}>Publish</button>}
                            {h.status !== 'hidden' && <button type="button" className="adm-link" onClick={() => void setStatus(h, 'hidden')}>Hide</button>}
                        </span>
                        {editing === h.id && (
                            <HotelForm initial={toDraft(h)} id={h.id} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
                        )}
                    </div>
                ))}
            </Card>
        </div>
    );
}

function toInputOf(h: Hotel): HotelInput {
    return {
        name: h.name, description: h.description, address: h.address, city: h.city, country: h.country,
        lat: h.lat, lng: h.lng, phone: h.phone, website: h.website, booking_url: h.booking_url,
        price_band: h.price_band, rating: h.rating, amenities: h.amenities, photo_url: h.photo_url, status: h.status,
    };
}

function HotelForm({ initial, id, onCancel, onSaved }: { initial: Draft; id?: string; onCancel: () => void; onSaved: () => void }) {
    const [d, setD] = useState<Draft>(initial);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const set = <K extends keyof Draft>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
        setD((p) => ({ ...p, [k]: e.target.value }));
    const coords = parseCoords(d.coords);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        const input = toInput(d);
        if (typeof input === 'string') { setProblem(input); return; }
        setBusy(true); setProblem(null);
        try { await saveHotel(input, id); onSaved(); } catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
    };

    const field = (label: string, k: keyof Draft, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
        <label className="adm-sel">{label}<input className="adm-input" value={d[k] as string} onChange={set(k)} {...props} /></label>
    );

    return (
        <form className="adm-card adm-hotel-form" onSubmit={submit} style={{ marginTop: 10 }}>
            <div className="adm-qgrid">
                {field('Name', 'name', { required: true })}
                {field('City', 'city', { required: true })}
                <label className="adm-sel">Side of the border
                    <select value={d.country} onChange={set('country')}>
                        <option value="MX">Mexico (near the clinics)</option><option value="US">United States (cross for the day)</option>
                    </select>
                </label>
                {field('Address', 'address')}
                <label className="adm-sel">
                    Coordinates or Google Maps link
                    <input className="adm-input" value={d.coords} onChange={set('coords')} placeholder="32.5272, -117.0222" required />
                    <span>{coords ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)} · ${regionOf(coords.lng)}` : d.coords ? 'not recognised' : ''}</span>
                </label>
                {field('Booking.com link', 'booking_url', { type: 'url', placeholder: 'https://www.booking.com/hotel/mx/…' })}
                {field('Hotel website', 'website', { type: 'url' })}
                {field('Phone', 'phone', { type: 'tel' })}
                {field('Photo URL (https, rights cleared)', 'photo_url', { type: 'url' })}
                <label className="adm-sel">Price band
                    <select value={d.price_band} onChange={set('price_band')}>
                        <option value="">–</option><option value="1">$ budget</option><option value="2">$$ moderate</option>
                        <option value="3">$$$ upscale</option><option value="4">$$$$ luxury</option>
                    </select>
                </label>
                {field('Rating, 0–5 (halve a Booking.com score out of 10)', 'rating', { inputMode: 'decimal' })}
                <label className="adm-sel">Status
                    <select value={d.status} onChange={set('status')}>
                        <option value="pending">Draft</option><option value="live">Live</option><option value="hidden">Hidden</option>
                    </select>
                </label>
            </div>
            <div className="adm-qgrid" style={{ marginTop: 14 }}>
                <label className="adm-sel">Description (English)<textarea rows={3} value={d.descEn} onChange={set('descEn')} /></label>
                <label className="adm-sel">Descripción (español)<textarea rows={3} value={d.descEs} onChange={set('descEs')} /></label>
            </div>
            <fieldset className="adm-chips" style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
                <legend className="adm-sel" style={{ marginBottom: 6 }}>Amenities (only what the hotel states)</legend>
                {HOTEL_AMENITIES.map((a) => (
                    <label key={a} className="adm-check adm-chip">
                        <input type="checkbox" checked={d.amenities.includes(a)}
                            onChange={(e) => setD((p) => ({ ...p, amenities: e.target.checked ? [...p.amenities, a] : p.amenities.filter((x) => x !== a) }))} />
                        {AMENITY_LABEL[a]}
                    </label>
                ))}
            </fieldset>
            {problem && <p className="adm-err" role="alert">{problem}</p>}
            <div className="adm-tools" style={{ marginTop: 14 }}>
                <button type="submit" className="adm-btn" disabled={busy}>{busy ? 'Saving…' : id ? 'Save changes' : 'Add hotel'}</button>
                <button type="button" className="adm-link" onClick={onCancel} style={{ marginTop: 0 }}>Cancel</button>
            </div>
        </form>
    );
}
