-- Two border regions, and a lean list for the directory.
--
-- 1. `providers.region` — which border region a provider belongs to, derived
--    from its coordinates so every insert path (Doctoralia, Google sweeps,
--    self-serve) is tagged without code changes. West of -110° is
--    San Diego–Tijuana; everything else is El Paso–Ciudad Juárez. Mirrors
--    src/utils/region.ts `regionOf`. Rows without coordinates stay null and are
--    not shown in either region's list (they cannot be put on the map anyway).
--
-- 2. `provider_list` — what the directory needs for cards, the map, search and
--    filter counts, and nothing else. The site used to download `select *` for
--    all ~11k live providers (~17 MB of JSON per visit); the list is ~400 B a
--    row and is fetched one region at a time. `services` is reduced to its
--    names (Spanish + English) because the list only searches them; prices
--    stay on `priceFromMxn` and the full menu loads with the provider.

alter table public.providers
    add column if not exists region text
    generated always as (
        case
            when lng is null then null
            when lng < -110 then 'sandiego-tijuana'
            else 'elpaso-juarez'
        end
    ) stored;

create index if not exists providers_region_live_idx
    on public.providers (region) where status = 'live';

create or replace view public.provider_list
with (security_invoker = true) as
select
    p.id,
    p.name,
    p.specialty,
    p.country,
    p.city,
    p.region,
    p.address,
    p.lat,
    p.lng,
    p."postalCode",
    p.rating,
    p."reviewCount",
    p.promoted,
    p.tier,
    p.verified,
    p.licensed,
    p."featuredRank",
    p."priceFromMxn",
    p.insurances,
    p.languages,
    p.languages_confirmed,
    p.source,
    p."imageUrl",
    p."googlePlaceId",
    coalesce(
        (select array_agg(distinct n) filter (where n is not null and n <> '')
           from jsonb_array_elements(p.services) s,
                lateral (values (s->>'name'), (s->>'nameEn')) v(n)),
        '{}'
    ) as service_names
from public.providers p
where p.status = 'live';

grant select on public.provider_list to anon, authenticated;
