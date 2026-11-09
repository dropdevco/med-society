-- Stand-ins for production objects these migrations reference. Not production's definitions.
-- Production keeps these in an extensions schema; matching that catches search_path mistakes.
create schema extensions;
create extension if not exists pg_trgm schema extensions;
create extension if not exists unaccent schema extensions;
alter database postgres set search_path = "$user", public, extensions;
set search_path = "$user", public, extensions;
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema extensions to anon, authenticated, service_role;
create schema auth;
create table auth.users (id uuid primary key);
create table public.doctoralia_doctors (doctoralia_id text primary key, entity_type text, name text, cedulas text[], provider_id uuid);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.providers (
    id uuid primary key default gen_random_uuid(), name text, specialty text[] default '{}', country text default 'MX', city text, region text,
    address text, lat numeric, lng numeric, "postalCode" text, rating numeric, "reviewCount" integer, promoted boolean default false,
    tier text default 'basic', verified boolean default false, licensed boolean default false, "featuredRank" integer, "priceFromMxn" numeric,
    insurances text[], languages text[], languages_confirmed boolean default false, source text default 'doctoralia', "imageUrl" text,
    "googlePlaceId" text, services jsonb default '[]', status text default 'live');
grant select (id, name, specialty, country, city, region, address, lat, lng, "postalCode", rating, "reviewCount", promoted, tier, verified, licensed,
    "featuredRank", "priceFromMxn", insurances, languages, languages_confirmed, source, "imageUrl", "googlePlaceId", services, status)
    on public.providers to anon, authenticated;
grant all on public.providers to service_role;
create view public.provider_list with (security_invoker = true) as
    select id, name, specialty, country, city, region, address, lat, lng, "postalCode", rating, "reviewCount", promoted, tier, verified, licensed,
           "featuredRank", "priceFromMxn", insurances, languages, languages_confirmed, source, "imageUrl", "googlePlaceId",
           coalesce((select array_agg(distinct v.n) filter (where v.n is not null and v.n <> ''::text)
                     from jsonb_array_elements(p.services) s(value), lateral (values (s.value ->> 'name'::text), (s.value ->> 'nameEn'::text)) v(n)), '{}'::text[]) as service_names
    from public.providers p where status = 'live'::text;
grant select on public.provider_list to anon, authenticated;
-- Production's bh_norm, verbatim (5 Nov 2026).
create function public.bh_norm(t text) returns text language sql stable set search_path = public, extensions, pg_temp as $$
    select btrim(regexp_replace(
        regexp_replace(
            regexp_replace(lower(extensions.unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g'),
            '\m(dr|dra|doctor|doctora|lic|mtro|mtra|clinica|clinicas|consultorio|centro|medico|medica|medicos|hospital|salud|grupo|especialidades|dental|dentista|odontologia|de|del|la|el|los|las|y|en|sa|cv|s|a|c|v|clinic|clinics|medical|center|centre|family|health|care|group|services|the|of|at|and|pllc|llc|pa|md|dds|inc)\M',
            ' ', 'g'),
        '\s+', ' ', 'g'));
$$;
create table public.app_admins (user_id uuid primary key);
create function public.is_app_admin() returns boolean language sql stable security definer set search_path = public, auth as $$
    select exists (select 1 from public.app_admins where user_id = auth.uid()) $$;
create function public._admin_guard() returns void language plpgsql stable security definer set search_path = public, auth as $$
begin if not public.is_app_admin() then raise exception 'not authorized' using errcode = '42501'; end if; end $$;
grant all on public.doctoralia_doctors to service_role;
