-- Store each listing's service names instead of rebuilding them on every read.
--
-- WHY. public.provider_list (the view the directory loads, 0021) built
-- `service_names` with a correlated subquery over providers.services for every
-- row it returned, AND for every row it merely skipped to honour OFFSET. The
-- site pages the view 1000 rows at a time, so page k paid for ~1000*(k+1) row
-- rebuilds: a full San Diego load (8,551 rows) is ~45 page-costs of database
-- CPU. Under bursts of concurrent loads the anon role's 3 s statement_timeout
-- cancelled some of them, and the API answered 500 (about one request in five
-- over 24 h on 2026-11-09; first seen in feedback report of 2026-11-05).
--
-- WHAT. `providers.service_names` holds the same text[] the subquery produced,
-- kept current by a BEFORE INSERT / UPDATE OF services trigger, so every writer
-- (owner dashboard, scrapers, scripts, SQL editor) stays correct. The view
-- just reads the column. Nothing else about the view changes: same columns,
-- same order, same types, same security_invoker, same grants, same rows.
--
-- NOT CHANGED: statement_timeout (raising it would only hide a slow query).
--
-- GRANTS. provider_list is security_invoker and anon/authenticated read
-- providers by COLUMN grants only (0032), so the new column needs its own
-- SELECT grant or the whole view would fail for the site. It is derived from
-- `services`, which those roles can already read. No UPDATE grant: nobody
-- sets it by hand, the trigger does.
--
-- LOCKING. ADD COLUMN with a constant default is a catalog-only change on
-- Postgres 11+, so the table is not rewritten. The backfill touches ~12.6k rows
-- in one statement. Expect well under a few seconds; run off-peak if in doubt.
--
-- ROLLBACK (data loss: none, the column is derived). In this order:
--   create or replace view public.provider_list with (security_invoker = true) as
--   select id, name, specialty, country, city, region, address, lat, lng,
--          "postalCode", rating, "reviewCount", promoted, tier, verified, licensed,
--          "featuredRank", "priceFromMxn", insurances, languages, languages_confirmed,
--          source, "imageUrl", "googlePlaceId",
--          coalesce((select array_agg(distinct v.n) filter (where v.n is not null and v.n <> '')
--                    from jsonb_array_elements(p.services) s(value),
--                         lateral (values (s.value ->> 'name'), (s.value ->> 'nameEn')) v(n)),
--                   '{}'::text[]) as service_names
--   from public.providers p where status = 'live';
--   drop trigger providers_service_names on public.providers;
--   drop function public.providers_service_names_trg();
--   alter table public.providers drop column service_names;  -- drops its grant too
--   drop function public.provider_service_names(jsonb);
-- (That is the definition in production on 2026-11-09, read with pg_get_viewdef.)
--
-- Run in: Supabase dashboard -> SQL editor. Runs as one transaction: if the
-- self-check at the bottom fails, nothing is applied.

-- 1. The expression, once. Same result as the old subquery: distinct,
--    non-empty Spanish and English names, sorted, '{}' when there are none.
--    Anything that is not a JSON array yields '{}' instead of raising.
create or replace function public.provider_service_names(svc jsonb)
returns text[]
language sql
immutable
parallel safe
set search_path = pg_temp
as $$
    select case
        when jsonb_typeof(svc) = 'array' then coalesce((
            select array_agg(distinct v.n) filter (where v.n is not null and v.n <> '')
            from jsonb_array_elements(svc) s(value),
                 lateral (values (s.value ->> 'name'), (s.value ->> 'nameEn')) v(n)
        ), '{}'::text[])
        else '{}'::text[]
    end;
$$;

-- 2. The column.
alter table public.providers
    add column if not exists service_names text[] not null default '{}'::text[];

-- 3. Keep it current. UPDATE OF services: edits to other columns do not pay for it.
create or replace function public.providers_service_names_trg()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    new.service_names := public.provider_service_names(new.services);
    return new;
end;
$$;

drop trigger if exists providers_service_names on public.providers;
create trigger providers_service_names
    before insert or update of services on public.providers
    for each row execute function public.providers_service_names_trg();

-- 4. Backfill. Assigns the column directly; the trigger above fires only for
--    changes to `services`, and confirm_languages_on_change (0003) only acts when
--    `languages` changes, so no other side effects.
update public.providers
   set service_names = public.provider_service_names(services)
 where service_names is distinct from public.provider_service_names(services);

-- 5. Browser roles may read it (see GRANTS above).
grant select (service_names) on public.providers to anon, authenticated;

-- 6. The view now reads the stored column. Everything else is as before.
create or replace view public.provider_list
with (security_invoker = true) as
select
    id, name, specialty, country, city, region, address, lat, lng,
    "postalCode", rating, "reviewCount", promoted, tier, verified, licensed,
    "featuredRank", "priceFromMxn", insurances, languages, languages_confirmed,
    source, "imageUrl", "googlePlaceId",
    service_names
from public.providers p
where status = 'live';

-- 7. Self-check: no row may disagree with the expression, and the view must
--    still return every live listing. Raises (and so rolls everything back) if not.
do $$
declare bad int; live_rows int; view_rows int;
begin
    select count(*) into bad
      from public.providers
     where service_names is distinct from public.provider_service_names(services);
    if bad > 0 then
        raise exception 'service_names mismatch on % rows', bad;
    end if;

    select count(*) into live_rows from public.providers where status = 'live';
    select count(*) into view_rows from public.provider_list;
    if live_rows <> view_rows then
        raise exception 'provider_list returns % rows, expected %', view_rows, live_rows;
    end if;
end;
$$;
