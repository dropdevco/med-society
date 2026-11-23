-- Hotels on the US side (El Paso, San Diego), for patients who cross for the
-- day instead of sleeping in Mexico. The side is the existing `country`
-- column ('MX' or 'US', already checked). `region` is unchanged: it is
-- generated from longitude, so San Diego falls in sandiego-tijuana and El Paso
-- in elpaso-juarez, next to the Mexican hotels of the same region.
--
-- hotels_near gets an optional country filter. Without it, a Zona Río clinic's
-- 8 km radius would reach San Ysidro and mix US hotels into the Mexican list.
-- Callers that pass four arguments keep working (the filter is then off).

drop function if exists public.hotels_near(double precision, double precision, integer, double precision);

create or replace function public.hotels_near(
    p_lat double precision,
    p_lng double precision,
    p_limit integer default 3,
    p_max_km double precision default 8,
    p_country text default null
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
      and (p_country is null or h.country = p_country)
      -- Cheap box first (about 1° ≈ 111 km of latitude), then the exact distance.
      and h.lat between p_lat - p_max_km / 111.0 and p_lat + p_max_km / 111.0
      and h.lng between p_lng - p_max_km / (111.0 * greatest(cos(radians(p_lat)), 0.2))
                    and p_lng + p_max_km / (111.0 * greatest(cos(radians(p_lat)), 0.2))
      and d.km <= p_max_km
    order by d.km
    limit least(greatest(coalesce(p_limit, 3), 1), 20);
$$;

revoke all on function public.hotels_near(double precision, double precision, integer, double precision, text) from public;
grant execute on function public.hotels_near(double precision, double precision, integer, double precision, text) to anon, authenticated;

create index if not exists hotels_region_country_live_idx
    on public.hotels (region, country) where status = 'live';
