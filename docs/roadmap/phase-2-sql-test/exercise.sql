\set ON_ERROR_STOP on
-- a run, an entry, a person linked to two duplicate listings, one confirmed affiliation
insert into public.source_runs (id, source_slug, started_at, status) values ('01a19e62-35fc-77f4-825a-d08ccf43a21b', 'hospital-angeles', now(), 'green');
insert into public.source_entries (source_slug, external_id, name, first_seen_run_id, last_seen_run_id)
  values ('hospital-angeles', 'ana-prueba-uno', 'Ana Prueba Uno', '01a19e62-35fc-77f4-825a-d08ccf43a21b', '01a19e62-35fc-77f4-825a-d08ccf43a21b');
insert into public.people (id, display_name) values ('00000000-0000-4000-8000-000000000001', 'Ana Prueba Uno');
insert into public.providers (id, name) values ('00000000-0000-4000-8000-0000000000a1', 'Dra. Ana Prueba'), ('00000000-0000-4000-8000-0000000000a2', 'Ana Prueba Uno (duplicate)'), ('00000000-0000-4000-8000-0000000000b1', 'Unrelated clinic');
insert into public.provider_people (provider_id, person_id, method) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'manual'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'manual');
insert into public.person_affiliations (person_id, organization_id, status, source_slug, created_run_id, last_confirmed_run_id, last_confirmed_at)
  select '00000000-0000-4000-8000-000000000001', id, 'confirmed', 'hospital-angeles', '01a19e62-35fc-77f4-825a-d08ccf43a21b', '01a19e62-35fc-77f4-825a-d08ccf43a21b', now() from public.organizations where slug = 'hospital-angeles';
update public.organizations set logo_url = 'https://example.test/ha.png';
select 'name_norm trigger' as check, (select name_norm from public.source_entries) = 'ana prueba uno' as ok;
select 'refresh updates both listings' as check, public.refresh_provider_badges(array['00000000-0000-4000-8000-000000000001'::uuid]) = 2 as ok;
select 'second refresh is a no-op' as check, public.refresh_provider_badges(array['00000000-0000-4000-8000-000000000001'::uuid]) = 0 as ok;
select 'duplicate listings show the same badge' as check, (select count(distinct badges) from public.providers where id in ('00000000-0000-4000-8000-0000000000a1','00000000-0000-4000-8000-0000000000a2')) = 1 as ok;
select 'unrelated listing untouched' as check, (select badges = '[]'::jsonb from public.providers where id = '00000000-0000-4000-8000-0000000000b1') as ok;
select 'logo hidden without permission' as check, (select badges->0->>'logo' is null and badges->0->>'org' = 'hospital-angeles' from public.providers where id = '00000000-0000-4000-8000-0000000000a1') as ok;
update public.organizations set logo_permission_at = now();
select public.refresh_provider_badges(array['00000000-0000-4000-8000-000000000001'::uuid]) as refreshed_after_logo_ok;
select 'logo shown once permission recorded' as check, (select badges->0->>'logo' = 'https://example.test/ha.png' from public.providers where id = '00000000-0000-4000-8000-0000000000a1') as ok;
-- one cédula can never belong to two people
insert into public.people (id, display_name) values ('00000000-0000-4000-8000-000000000002', 'Someone Else');
insert into public.person_identifiers (kind, value, person_id) values ('cedula_profesional', '12345678', '00000000-0000-4000-8000-000000000001');
do $$ begin
  insert into public.person_identifiers (kind, value, person_id) values ('cedula_profesional', '12345678', '00000000-0000-4000-8000-000000000002');
  raise exception 'duplicate cedula was accepted';
exception when unique_violation then raise notice 'ok: duplicate cedula refused';
end $$;
-- anon: can read providers.badges, cannot read pipeline tables or run the refresh
set role anon;
select 'anon reads providers.badges' as check, (select count(*) from public.providers where badges <> '[]'::jsonb) = 2 as ok;
do $$ begin perform 1 from public.people; raise exception 'anon read people'; exception when insufficient_privilege then raise notice 'ok: anon cannot read people'; end $$;
do $$ begin perform 1 from public.source_observations; raise exception 'anon read observations'; exception when insufficient_privilege then raise notice 'ok: anon cannot read observations'; end $$;
do $$ begin perform public.refresh_provider_badges(array[]::uuid[]); raise exception 'anon ran refresh'; exception when insufficient_privilege then raise notice 'ok: anon cannot run refresh'; end $$;
reset role;
