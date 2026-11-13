-- Stand-ins for production objects the draft references. Not production's definitions.
create extension if not exists pg_trgm;
create role anon; create role authenticated;
create schema auth; create table auth.users (id uuid primary key);
create table public.providers (id uuid primary key default gen_random_uuid(), name text, status text default 'live');
grant select (id, name, status) on public.providers to anon, authenticated;
create function public.bh_norm(t text) returns text language sql stable as $$ select lower(t) $$;
