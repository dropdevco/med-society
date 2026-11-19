-- Hotels near the clinics: the first piece of the medical-trip pipeline.
-- See docs/hotels.md.
--
-- Hotels are curated by hand by an admin and get their own table, not rows in
-- providers. They are lodging, not care: kept apart, they never reach search,
-- leads, claims, the doctor-analytics sync or provider_list. Recovery houses
-- (post-surgery care) stay in providers with kind = 'stay' (0040).
--
-- Booking happens off-site: "Check rates" opens booking_url (a Booking.com
-- listing) with our affiliate id added in the client (src/utils/hotelLinks.ts).
-- A hotel is a business, so phone and website are public, unlike provider
-- contact data (0032).

create table if not exists public.hotels (
    id          uuid primary key default gen_random_uuid(),
    name        text not null check (length(btrim(name)) between 2 and 160),
    -- {"en": "...", "es": "..."}; either may be missing.
    description jsonb not null default '{}'::jsonb
                check (jsonb_typeof(description) = 'object'),
    address     text,
    city        text not null,
    country     text not null default 'MX' check (country in ('MX', 'US')),
    lat         double precision not null check (lat between -90 and 90),
    lng         double precision not null check (lng between -180 and 180),
    -- Same rule as providers.region (0021) and src/utils/region.ts regionOf.
    region      text generated always as (
                    case when lng < -110 then 'sandiego-tijuana' else 'elpaso-juarez' end
                ) stored,
    phone       text,
    website     text check (website is null or website ~* '^https?://'),
    booking_url text check (booking_url is null or booking_url ~* '^https://'),
    price_band  smallint check (price_band between 1 and 4),
    rating      numeric(2, 1) check (rating between 0 and 5),
    amenities   text[] not null default '{}' check (amenities <@ array[
                    'clinic_shuttle', 'airport_shuttle', 'border_shuttle', 'accessible',
                    'kitchenette', 'quiet_recovery', 'nurse_on_call', 'bilingual_staff', 'parking'
                ]::text[]),
    photo_url   text check (photo_url is null or photo_url ~* '^https://'),
    -- Nothing is public until an admin publishes it.
    status      text not null default 'pending' check (status in ('live', 'pending', 'hidden')),
    source      text not null default 'manual',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists hotels_region_live_idx on public.hotels (region) where status = 'live';

create or replace function public.hotels_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists hotels_touch on public.hotels;
create trigger hotels_touch before update on public.hotels
    for each row execute function public.hotels_touch();

-- Visitors read published hotels; admins read and write everything.
alter table public.hotels enable row level security;
revoke all on public.hotels from anon, authenticated;
grant select on public.hotels to anon, authenticated;
grant insert, update, delete on public.hotels to authenticated;
grant all on public.hotels to service_role;

drop policy if exists "public reads live hotels" on public.hotels;
create policy "public reads live hotels" on public.hotels
    for select to anon, authenticated using (status = 'live');

drop policy if exists "admins read all hotels" on public.hotels;
create policy "admins read all hotels" on public.hotels
    for select to authenticated using (public.is_app_admin());

drop policy if exists "admins write hotels" on public.hotels;
create policy "admins write hotels" on public.hotels
    for all to authenticated using (public.is_app_admin()) with check (public.is_app_admin());

-- The closest published hotels to a point (a provider), nearest first.
-- Haversine in plain SQL: no PostGIS needed for a few hundred rows.
-- SECURITY INVOKER, so the policies above decide what a caller sees.
create or replace function public.hotels_near(
    p_lat double precision,
    p_lng double precision,
    p_limit integer default 3,
    p_max_km double precision default 8
)
returns table (hotel jsonb, distance_km double precision)
language sql stable security invoker
set search_path = public
as $$
    select to_jsonb(h) as hotel, d.km as distance_km
    from public.hotels h
    cross join lateral (
        select 2 * 6371 * asin(sqrt(
            power(sin(radians(h.lat - p_lat) / 2), 2)
            + cos(radians(p_lat)) * cos(radians(h.lat)) * power(sin(radians(h.lng - p_lng) / 2), 2)
        )) as km
    ) d
    where h.status = 'live'
      -- Cheap box first (about 1° ≈ 111 km), then the exact distance.
      and h.lat between p_lat - p_max_km / 111.0 and p_lat + p_max_km / 111.0
      and d.km <= p_max_km
    order by d.km
    limit least(greatest(coalesce(p_limit, 3), 1), 20);
$$;

revoke all on function public.hotels_near(double precision, double precision, integer, double precision) from public;
grant execute on function public.hotels_near(double precision, double precision, integer, double precision) to anon, authenticated;
