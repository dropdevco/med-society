\set ON_ERROR_STOP on
-- 0057 in a throwaway Postgres: the ready-made directory copy. Made-up providers.

-- Stand-ins for what production already has: the roles, a providers table with a
-- contact column anon may not read, and provider_list without it.
do $$ begin
    if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;
create table public.providers (
    id uuid primary key, name text not null, region text, status text not null default 'live',
    phone text, rating numeric, badges jsonb not null default '[]'
);
create view public.provider_list as
    select id, name, region, rating, badges from public.providers p where status = 'live';
grant select on public.provider_list to anon, authenticated;

insert into public.providers (id, name, region, status, phone, rating) values
  ('00000000-0000-4000-8000-000000000001', 'Dra. Uno Ejemplo',    'sandiego-tijuana', 'live',  '+52 664 000 0001', 4.5),
  ('10000000-0000-4000-8000-000000000002', 'Dr. Dos Ejemplo',     'sandiego-tijuana', 'live',  '+52 664 000 0002', null),
  ('30000000-0000-4000-8000-000000000003', 'Dr. Tres Ejemplo',    'sandiego-tijuana', 'live',  null, 5),
  ('f0000000-0000-4000-8000-000000000004', 'Dra. Cuatro Ejemplo', 'sandiego-tijuana', 'live',  null, 3.9),
  ('50000000-0000-4000-8000-000000000005', 'Borrador Ejemplo',    'sandiego-tijuana', 'draft', null, null),
  ('a0000000-0000-4000-8000-000000000006', 'Dr. Seis Ejemplo',    'elpaso-juarez',    'live',  null, 4.1);

\i /migrations/0057_directory_snapshot.sql

select 'every region has all 8 parts' as check,
  (select count(*) = 16 and count(distinct region) = 2 from public.directory_snapshot) as ok;
select 'a part holds the ids whose first hex digit is its own, in id order' as check,
  (select rows->0->>'id' = '00000000-0000-4000-8000-000000000001' and rows->1->>'id' = '10000000-0000-4000-8000-000000000002' and row_count = 2
   from public.directory_snapshot where region = 'sandiego-tijuana' and part = 0) as ok;
select 'the last part takes f, and a part with no listings is an empty array' as check,
  (select (select rows->0->>'id' from public.directory_snapshot where region = 'sandiego-tijuana' and part = 7) = 'f0000000-0000-4000-8000-000000000004'
      and (select rows = '[]'::jsonb and row_count = 0 from public.directory_snapshot where region = 'sandiego-tijuana' and part = 2)) as ok;
select 'only live listings, the same rows provider_list gives anon' as check,
  (select jsonb_agg(r order by r->>'id') from public.directory_snapshot, jsonb_array_elements(rows) r where region = 'sandiego-tijuana')
  = (select jsonb_agg(to_jsonb(v) order by v.id) from public.provider_list v where region = 'sandiego-tijuana') as ok;
select 'no contact field reaches the copy' as check,
  not exists (select 1 from public.directory_snapshot, jsonb_array_elements(rows) r where r ? 'phone') as ok;

create temp table before_run as select region, part, built_at, checked_at from public.directory_snapshot;
select pg_sleep(0.05);
select 'nothing changed: no part is rewritten' as check, public.refresh_directory_snapshot() = 0 as ok;
select 'nothing changed: built_at stays, checked_at moves' as check,
  (select bool_and(d.built_at = b.built_at and d.checked_at > b.checked_at)
   from public.directory_snapshot d join before_run b using (region, part)) as ok;

update public.providers set name = 'Dr. Tres Ejemplo Renombrado' where id = '30000000-0000-4000-8000-000000000003';
select pg_sleep(0.05);
select 'one listing renamed: only its part is rewritten' as check, public.refresh_directory_snapshot() = 1 as ok;
select 'the renamed listing shows in its part' as check,
  (select rows->0->>'name' = 'Dr. Tres Ejemplo Renombrado' and built_at > (select built_at from before_run where region = 'sandiego-tijuana' and part = 1)
   from public.directory_snapshot where region = 'sandiego-tijuana' and part = 1) as ok;

update public.providers set status = 'live' where id = '50000000-0000-4000-8000-000000000005';
select 'a listing going live rewrites its part' as check, public.refresh_directory_snapshot() = 1 as ok;
select 'a listing going live appears' as check,
  (select row_count = 1 from public.directory_snapshot where region = 'sandiego-tijuana' and part = 2) as ok;

update public.providers set status = 'draft' where region = 'elpaso-juarez';
select public.refresh_directory_snapshot();
select 'a region with no live listings left is removed' as check,
  not exists (select 1 from public.directory_snapshot where region = 'elpaso-juarez') as ok;

set role anon;
select 'anon reads the copy' as check, (select count(*) = 8 from public.directory_snapshot) as ok;
do $$ begin
    insert into public.directory_snapshot (region, part, rows, row_count) values ('x', 0, '[]', 0);
    raise exception 'anon wrote to the copy';
exception when insufficient_privilege then raise notice 'ok: anon cannot write the copy';
end $$;
do $$ begin
    perform public.refresh_directory_snapshot();
    raise exception 'anon ran the refresh';
exception when insufficient_privilege then raise notice 'ok: anon cannot run the refresh';
end $$;
reset role;
set role authenticated;
do $$ begin
    perform public.refresh_directory_snapshot();
    raise exception 'a signed-in user ran the refresh';
exception when insufficient_privilege then raise notice 'ok: signed-in users cannot run the refresh';
end $$;
reset role;

-- The rollback in the migration header.
drop function public.refresh_directory_snapshot();
drop table public.directory_snapshot;
select 'rollback leaves nothing behind' as check,
  to_regclass('public.directory_snapshot') is null and to_regprocedure('public.refresh_directory_snapshot()') is null as ok;
