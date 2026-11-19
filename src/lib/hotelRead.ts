import { supabase } from './supabase';
import type { Hotel, NearbyHotel } from '../types/hotel';
import type { RegionId } from '../utils/region';

/**
 * Reads of public.hotels (migrations 0054 and 0056). Row-level security
 * decides what a caller sees: visitors get published hotels, admins get every
 * row. The column list needs 0056 applied (google_place_id, review_count).
 */

const COLUMNS =
    'id, name, description, address, city, country, lat, lng, region, phone, website, booking_url, '
    + 'price_band, rating, review_count, google_place_id, amenities, photo_url, status, source, created_at, updated_at';

/** Published hotels in a region, best rated first, the most reviewed first among equals. */
export async function listHotels(region: RegionId): Promise<Hotel[]> {
    if (!supabase) return [];
    const { data, error } = await supabase
        .from('hotels')
        .select(COLUMNS)
        .eq('region', region)
        .eq('status', 'live')
        .order('rating', { ascending: false, nullsFirst: false })
        .order('review_count', { ascending: false, nullsFirst: false })
        .order('name');
    if (error) throw error;
    return (data as unknown as Hotel[] | null) ?? [];
}

/** The closest published hotels to a point, nearest first. */
export async function hotelsNear(lat: number, lng: number, limit = 3, maxKm = 8): Promise<NearbyHotel[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.rpc('hotels_near', { p_lat: lat, p_lng: lng, p_limit: limit, p_max_km: maxKm });
    if (error) throw error;
    return ((data as { hotel: Hotel; distance_km: number }[] | null) ?? [])
        .map((r) => ({ ...r.hotel, distanceKm: r.distance_km }));
}

/** Every hotel, drafts and hidden ones included. Only an admin gets anything but live rows. */
export async function listAllHotels(): Promise<Hotel[]> {
    if (!supabase) return [];
    const { data, error } = await supabase.from('hotels').select(COLUMNS).order('updated_at', { ascending: false });
    if (error) throw error;
    return (data as unknown as Hotel[] | null) ?? [];
}

/** What the admin form writes. The Google fields belong to scripts/hotels/find.ts and are never sent from here. */
export type HotelInput = Omit<Hotel, 'id' | 'region' | 'created_at' | 'updated_at' | 'source' | 'review_count' | 'google_place_id'>;

/** Insert (no id) or update (id) a hotel. The database refuses anyone who is not an admin. */
export async function saveHotel(input: HotelInput, id?: string): Promise<Hotel> {
    if (!supabase) throw new Error('Supabase is not configured');
    const query = id
        ? supabase.from('hotels').update(input).eq('id', id)
        : supabase.from('hotels').insert(input);
    const { data, error } = await query.select(COLUMNS).single();
    if (error) throw error;
    return data as unknown as Hotel;
}
