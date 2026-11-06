\set ON_ERROR_STOP on
-- Made-up doctors. Each check prints t; refused actions print a NOTICE.
\set R1 '''01a00000-0000-7000-8000-000000000001'''
\set R2 '''01a00000-0000-7000-8000-000000000002'''
\set R3 '''01a00000-0000-7000-8000-000000000003'''
insert into public.providers (id, name, region, specialty) values
  ('00000000-0000-4000-8000-0000000000a1', 'Dr. Mario Prueba Uno', 'elpaso-juarez', '{pediatrics}'),
  ('00000000-0000-4000-8000-0000000000a2', 'Mario Prueba Uno', 'elpaso-juarez', '{pediatrics}'),
  ('00000000-0000-4000-8000-0000000000b1', 'Clínica Sin Relación', 'elpaso-juarez', '{}');
insert into public.doctors (id, display_name, name_key) values
  ('00000000-0000-4000-8000-000000000001', 'Dr. Mario Prueba Uno', 'MAPR'),
  ('00000000-0000-4000-8000-000000000002', 'Dra. Ana Lopez Ruiz', 'ANLO');
insert into public.doctor_cedulas (cedula, doctor_id, first_source) values ('1234567', '00000000-0000-4000-8000-000000000001', 'doctoralia');
insert into public.doctor_listings (provider_id, doctor_id, method) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000001', 'doctoralia_link'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-000000000001', 'doctoralia_link');

insert into public.source_runs (id, source_slug, started_at, status) values (:R1, 'starmedica', now(), 'green'), (:R2, 'conacem', now(), 'green');
-- Star Médica: a cédula match the pipeline confirmed as tier 1.
insert into public.source_entries (source_slug, external_id, name, label, cedulas, url, first_seen_run_id, last_seen_run_id)
  values ('starmedica', 'sm1', 'Mario Prueba Uno', 'Star Médica Ciudad Juárez', '{1234567}', 'https://www.starmedica.com/x', :R1, :R1);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence, first_run_id, last_run_id)
  values ('starmedica', 'sm1', '00000000-0000-4000-8000-000000000001', 'confirmed', 1, 1, :R1, :R1);
select 'sync creates the badge' as check, (public.sync_source_badges('starmedica', :R1, true)->>'renewed')::int = 1 as ok;
select 'both duplicate listings show it, the unrelated one does not' as check,
  (select count(*) from public.providers where badges <> '[]'::jsonb) = 2 as ok;
select 'badge reaches provider_list with label and link' as check,
  (select badges->0->>'label' = 'Star Médica Ciudad Juárez' and badges->0->>'url' = 'https://www.starmedica.com/x' and badges->0->>'logo' is null
   from public.provider_list where id = '00000000-0000-4000-8000-0000000000a1') as ok;

-- CONACEM: name-only, so it waits in the queue until a reviewer decides.
insert into public.source_entries (source_slug, external_id, name, label, url, valid_from, valid_to, facts, first_seen_run_id, last_seen_run_id) values
  ('conacem', '900001', 'Mario Prueba Uno', 'Pediatría', 'https://conacem.org.mx/buscador', '2024-01-01', '2029-01-01', '{"consejo":"Consejo de Prueba","certificate":"4842"}', :R2, :R2),
  ('conacem', '900002', 'Ana Lopez Ruiz', 'Cirugía General', 'https://conacem.org.mx/buscador', '2015-01-01', '2020-01-01', '{}', :R2, :R2);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence, first_run_id, last_run_id) values
  ('conacem', '900001', '00000000-0000-4000-8000-000000000001', 'probable', 3, 1, :R2, :R2),
  ('conacem', '900002', '00000000-0000-4000-8000-000000000002', 'probable', 3, 0.7, :R2, :R2);
select 'probable matches give no badge' as check, (select jsonb_array_length(badges) from public.providers where id = '00000000-0000-4000-8000-0000000000a1') = 1 as ok;

insert into auth.users values ('00000000-0000-4000-8000-00000000aaaa'), ('00000000-0000-4000-8000-00000000bbbb');
insert into public.app_admins values ('00000000-0000-4000-8000-00000000aaaa');

-- A signed-in non-admin is refused; an admin sees and decides the queue.
set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-00000000bbbb', false);
do $$ begin perform public.admin_match_queue(); raise exception 'non-admin read the queue'; exception when insufficient_privilege then raise notice 'ok: non-admin cannot read the queue'; end $$;
select set_config('test.uid', '00000000-0000-4000-8000-00000000aaaa', false);
select 'admin sees 2 in the queue, 1 exact' as check, (select (q->>'total')::int = 2 and (q->>'exact')::int = 1 from public.admin_match_queue('conacem') q) as ok;
select 'bulk confirm takes exact matches only' as check, public.admin_match_confirm_exact('conacem') = 1 as ok;
reset role;
select 'decision recorded with reviewer and time' as check,
  (select decided_by = '00000000-0000-4000-8000-00000000aaaa' and decided_at is not null from public.doctor_source_ids where external_id = '900001') as ok;
select 'certification badge carries validity and consejo' as check,
  (select count(*) = 1 from public.providers p, jsonb_array_elements(p.badges) b
   where p.id = '00000000-0000-4000-8000-0000000000a1' and b->>'label' = 'Pediatría' and b->>'valid_to' = '2029-01-01' and b->'facts'->>'consejo' = 'Consejo de Prueba') as ok;

-- An expired certification never shows, even when confirmed.
insert into public.doctor_listings (provider_id, doctor_id, method) values ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-000000000002', 'review');
set role authenticated;
select public.admin_match_decide('conacem', '900002', 'confirm');
reset role;
select 'expired certification stays off the card' as check, (select badges = '[]'::jsonb from public.providers where id = '00000000-0000-4000-8000-0000000000b1') as ok;

-- Reject keeps the record out of the queue.
insert into public.source_entries (source_slug, external_id, name, first_seen_run_id, last_seen_run_id) values ('conacem', '900003', 'Otro Doctor Parecido', :R2, :R2);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence) values ('conacem', '900003', '00000000-0000-4000-8000-000000000002', 'probable', 3, 0.61);
set role authenticated;
select public.admin_match_decide('conacem', '900003', 'reject');
select 'rejected match leaves the queue' as check, (select (q->>'total')::int = 0 from public.admin_match_queue('conacem') q) as ok;
reset role;

-- A cédula shown by a source is kept when a reviewer confirms the match.
insert into public.source_entries (source_slug, external_id, name, label, cedulas, first_seen_run_id, last_seen_run_id) values ('starmedica', 'sm2', 'Ana Lopez Ruiz', 'Star Médica Ciudad Juárez', '{7654321}', :R1, :R1);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence) values ('starmedica', 'sm2', '00000000-0000-4000-8000-000000000002', 'probable', 3, 0.9);
set role authenticated;
select public.admin_match_decide('starmedica', 'sm2', 'confirm');
reset role;
select 'reviewed match keeps the source''s cédula' as check, (select doctor_id = '00000000-0000-4000-8000-000000000002' from public.doctor_cedulas where cedula = '7654321') as ok;

-- Two missed green runs lapse the badge; a run that saw the doctor renews it.
insert into public.source_runs (id, source_slug, started_at, status) values (:R3, 'starmedica', now(), 'green');
update public.source_entries set last_seen_run_id = :R3 where external_id = 'sm1';
select 'next run renews, no duplicate badge' as check, (public.sync_source_badges('starmedica', :R3, true)->>'renewed')::int = 1
   and (select count(*) from public.doctor_affiliations where source_slug = 'starmedica' and doctor_id = '00000000-0000-4000-8000-000000000001') = 1 as ok;
update public.source_entries set missed_runs = 1 where external_id = 'sm1';
select 'one miss keeps the badge' as check, (public.sync_source_badges('starmedica', :R3, true)->>'lapsed')::int = 0 as ok;
update public.source_entries set missed_runs = 2, last_seen_run_id = :R1 where external_id = 'sm1';
select 'two misses lapse it' as check, (public.sync_source_badges('starmedica', :R3, true)->>'lapsed')::int = 1 as ok;
select 'lapsed badge leaves the card, other badges stay' as check,
  (select jsonb_array_length(badges) = 1 and badges->0->>'label' = 'Pediatría' from public.providers where id = '00000000-0000-4000-8000-0000000000a1') as ok;

-- Logo appears only with permission recorded.
update public.organizations set logo_url = 'https://example.test/c.png' where slug = 'conacem';
select public.refresh_provider_badges(array['00000000-0000-4000-8000-000000000001'::uuid]);
select 'no logo without permission' as check, (select badges->0->>'logo' is null from public.providers where id = '00000000-0000-4000-8000-0000000000a1') as ok;
update public.organizations set logo_permission_at = now() where slug = 'conacem';
select public.refresh_provider_badges(array['00000000-0000-4000-8000-000000000001'::uuid]);
select 'logo once permission is recorded' as check, (select badges->0->>'logo' = 'https://example.test/c.png' from public.providers where id = '00000000-0000-4000-8000-0000000000a1') as ok;

-- Matcher: candidates by name.
select 'candidates: exact name scores 1 with its listings' as check,
  (select similarity = 1 and array_length(listings, 1) = 2 and regions = '{elpaso-juarez}' from public.doctor_name_candidates('Mario Prueba Uno', 'MAPR') limit 1) as ok;
select 'candidates: an unrelated name finds nobody' as check, (select count(*) from public.doctor_name_candidates('Zacarias Quintero Vega', 'ZAQU')) = 0 as ok;

set role anon;
select 'anon reads badges through provider_list' as check, (select count(*) from public.provider_list where badges <> '[]'::jsonb) = 3 as ok;
do $$ begin perform 1 from public.doctors; raise exception 'anon read doctors'; exception when insufficient_privilege then raise notice 'ok: anon cannot read doctors'; end $$;
do $$ begin perform 1 from public.doctor_cedulas; raise exception 'anon read cedulas'; exception when insufficient_privilege then raise notice 'ok: anon cannot read cédulas'; end $$;
do $$ begin perform public.refresh_provider_badges(array[]::uuid[]); raise exception 'anon ran refresh'; exception when insufficient_privilege then raise notice 'ok: anon cannot run refresh'; end $$;
do $$ begin perform public.doctor_name_candidates('x', 'x'); raise exception 'anon ran candidates'; exception when insufficient_privilege then raise notice 'ok: anon cannot search doctors'; end $$;
do $$ begin perform public.listings_for_cedula('1234567'); raise exception 'anon ran lookup'; exception when insufficient_privilege then raise notice 'ok: anon cannot run the cédula lookup'; end $$;
reset role;
set role authenticated;
do $$ begin perform 1 from public.doctors; raise exception 'user read doctors'; exception when insufficient_privilege then raise notice 'ok: signed-in users cannot read doctors'; end $$;
do $$ begin update public.providers set badges = '[]'; raise exception 'user wrote badges'; exception when insufficient_privilege then raise notice 'ok: signed-in users cannot write badges'; end $$;
select 'onboarding lookup finds the listings' as check, (select count(*) from public.listings_for_cedula('123 4567')) = 2 as ok;
reset role;
