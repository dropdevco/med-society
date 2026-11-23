-- Hotels found through Google Places (scripts/hotels/find.ts, docs/hotels.md).
--
-- google_place_id: Google lets us keep a place ID indefinitely. It is how the
--   finder updates the same row on a re-run, and how /api/place-photo serves
--   the hotel's cover photo without storing it.
-- review_count: shown beside the rating ("4.5 · 1,234 Google reviews").
-- source_run_id: the UUIDv7 of the finder run that last wrote the row, as
--   every source run must leave (scripts/sources/README.md#run-ids).
--
-- The table grant from 0054 is table-wide, so anon can read the new columns
-- without a column grant.

alter table public.hotels
    add column if not exists google_place_id text,
    add column if not exists review_count integer check (review_count is null or review_count >= 0),
    add column if not exists source_run_id uuid;

create unique index if not exists hotels_google_place_id_key
    on public.hotels (google_place_id) where google_place_id is not null;
