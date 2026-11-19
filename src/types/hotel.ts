import type { RegionId } from '../utils/region';

/** The closed list in migration 0054 (`hotels.amenities` check). Keep both in step. */
export const HOTEL_AMENITIES = [
    'clinic_shuttle',
    'airport_shuttle',
    'border_shuttle',
    'accessible',
    'kitchenette',
    'quiet_recovery',
    'nurse_on_call',
    'bilingual_staff',
    'parking',
] as const;
export type HotelAmenity = (typeof HOTEL_AMENITIES)[number];

export type HotelStatus = 'live' | 'pending' | 'hidden';

/** A curated hotel near the clinics (public.hotels, migration 0054). */
export interface Hotel {
    id: string;
    name: string;
    description: { en?: string; es?: string };
    address: string | null;
    city: string;
    country: 'MX' | 'US';
    lat: number;
    lng: number;
    region: RegionId;
    phone: string | null;
    website: string | null;
    /** The hotel's Booking.com page; the affiliate id is added by `bookingHref`. */
    booking_url: string | null;
    /** 1 = budget … 4 = luxury. */
    price_band: number | null;
    rating: number | null;
    amenities: HotelAmenity[];
    photo_url: string | null;
    status: HotelStatus;
    source: string;
    created_at: string;
    updated_at: string;
}

/** A hotel with its distance from the provider it was looked up for. */
export interface NearbyHotel extends Hotel {
    distanceKm: number;
}
