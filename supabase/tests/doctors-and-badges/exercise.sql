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
select 'a source with no doctor links shows the information page' as check,
  (select count(*) = 1 from public.providers p, jsonb_array_elements(p.badges) b
   where p.id = '00000000-0000-4000-8000-0000000000a1' and b->>'org' = 'conacem' and b->>'url' is null and b->>'info_url' = 'https://conacem.org.mx/quienes-somos') as ok;
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
reset role;
set role authenticated;
do $$ begin perform 1 from public.doctors; raise exception 'user read doctors'; exception when insufficient_privilege then raise notice 'ok: signed-in users cannot read doctors'; end $$;
do $$ begin update public.providers set badges = '[]'; raise exception 'user wrote badges'; exception when insufficient_privilege then raise notice 'ok: signed-in users cannot write badges'; end $$;
reset role;

-- ── Clinics (migration 0044, docs/adr/0008). Made-up centers. ────────────────
\set R4 '''01a00000-0000-7000-8000-000000000004'''
\set R5 '''01a00000-0000-7000-8000-000000000005'''
\set R6 '''01a00000-0000-7000-8000-000000000006'''
\set R7 '''01a00000-0000-7000-8000-000000000007'''
\set R8 '''01a00000-0000-7000-8000-000000000008'''
insert into public.providers (id, name, region) values
  ('00000000-0000-4000-8000-0000000000c1', 'Casa Prueba Recovery', 'sandiego-tijuana'),
  ('00000000-0000-4000-8000-0000000000c2', 'Casa Vencida Recovery', 'sandiego-tijuana'),
  ('00000000-0000-4000-8000-0000000000c3', 'Casa Prueba Recovery', 'elpaso-juarez');
insert into public.source_runs (id, source_slug, started_at, status) values
  (:R4, 'coepris-bc', now(), 'green'), (:R5, 'padron-salud-bc', now(), 'green'), (:R6, 'baja-health-cluster', now(), 'green'), (:R7, 'hospital-angeles', now(), 'green');

select 'six organizations, CONACEM the only one with no doctor links' as check,
  (select count(*) = 6 from public.data_sources where organization_id is not null)
  and (select array_agg(slug) = '{conacem}' from public.data_sources where organization_id is not null and not doctor_links) as ok;
select 'three sources describe facilities' as check, (select count(*) = 3 from public.data_sources where entity = 'facility') as ok;
select 'name candidates stay in the region' as check,
  (select count(*) = 1 and min(similarity) = 1 from public.facility_name_candidates('Casa Prueba Recovery', 'sandiego-tijuana')) as ok;
select 'something unlike any listing finds nothing' as check,
  (select count(*) = 0 from public.facility_name_candidates('Zzz Qqq Www', 'sandiego-tijuana')) as ok;

insert into public.source_entries (source_slug, external_id, name, label, url, valid_from, valid_to, facts, first_seen_run_id, last_seen_run_id) values
  ('coepris-bc', '20260000001', 'Casa Prueba Recovery', 'REPSSABI', 'https://bajahealthtourism.com/catalogo/casa-prueba', '2026-09-03', '2028-09-03', '{"register":"20260000001"}', :R4, :R4),
  ('coepris-bc', '20200000002', 'Casa Vencida Recovery', 'REPSSABI', 'https://example.test/v', '2018-01-01', '2020-01-01', '{"register":"20200000002"}', :R4, :R4),
  ('padron-salud-bc', 'casa-prueba', 'Casa Prueba Recovery', 'Padrón Estatal de Salud', 'https://bajahealthtourism.com/catalogo/casa-prueba', null, '2028-09-03', '{"register":"20260000001"}', :R5, :R5),
  ('baja-health-cluster', 'casa-prueba', 'Casa Prueba Recovery', 'Recovery centers', 'https://bajahealthcluster.mx/institucion/casa-prueba/', null, null, '{}', :R6, :R6),
  ('baja-health-cluster', 'otra', 'Otra Casa', 'Recovery centers', 'https://bajahealthcluster.mx/institucion/otra/', null, null, '{}', :R6, :R6);
insert into public.facility_source_ids (source_slug, external_id, provider_id, status, tier, confidence, first_run_id, last_run_id) values
  ('coepris-bc', '20260000001', '00000000-0000-4000-8000-0000000000c1', 'probable', 3, 1, :R4, :R4),
  ('coepris-bc', '20200000002', '00000000-0000-4000-8000-0000000000c2', 'probable', 3, 1, :R4, :R4),
  ('baja-health-cluster', 'casa-prueba', '00000000-0000-4000-8000-0000000000c1', 'probable', 3, 1, :R6, :R6),
  ('baja-health-cluster', 'otra', '00000000-0000-4000-8000-0000000000c1', 'probable', 3, 0.5, :R6, :R6);
select 'a name match gives no badge' as check, (select badges = '[]'::jsonb from public.providers where id = '00000000-0000-4000-8000-0000000000c1') as ok;

set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-00000000bbbb', false);
do $$ begin perform public.admin_facility_queue(); raise exception 'non-admin read the clinic queue'; exception when insufficient_privilege then raise notice 'ok: non-admin cannot read the clinic queue'; end $$;
do $$ begin perform public.admin_facility_decide('coepris-bc', '20260000001', 'confirm'); raise exception 'non-admin decided'; exception when insufficient_privilege then raise notice 'ok: non-admin cannot decide a clinic'; end $$;
select set_config('test.uid', '00000000-0000-4000-8000-00000000aaaa', false);
select 'admin sees the 4 clinics waiting' as check, (select (q->>'total')::int = 4 from public.admin_facility_queue() q) as ok;
select public.admin_facility_decide('coepris-bc', '20260000001', 'confirm');
select public.admin_facility_decide('coepris-bc', '20200000002', 'confirm');
select public.admin_facility_decide('baja-health-cluster', 'casa-prueba', 'confirm');
select public.admin_facility_decide('baja-health-cluster', 'otra', 'reject');
select 'the queue is empty after deciding' as check, (select (q->>'total')::int = 0 from public.admin_facility_queue() q) as ok;
do $$ begin perform public.admin_facility_decide('coepris-bc', '20260000001', 'maybe'); raise exception 'odd decision taken'; exception when raise_exception then raise notice 'ok: only confirm or reject'; end $$;
reset role;

select 'confirming makes the badge, with register, expiry and page' as check,
  (select count(*) = 1 from public.providers p, jsonb_array_elements(p.badges) b
   where p.id = '00000000-0000-4000-8000-0000000000c1' and b->>'org' = 'coepris-bc' and b->>'kind' = 'regulator' and b->>'label' = 'REPSSABI'
     and b->'facts'->>'register' = '20260000001' and b->>'valid_to' = '2028-09-03' and b->>'url' = 'https://bajahealthtourism.com/catalogo/casa-prueba') as ok;
select 'a rejected match gives no badge and stays rejected' as check,
  (select status = 'rejected' from public.facility_source_ids where external_id = 'otra')
  and (select jsonb_array_length(badges) = 2 from public.providers where id = '00000000-0000-4000-8000-0000000000c1') as ok;
select 'an expired registration never shows' as check, (select badges = '[]'::jsonb from public.providers where id = '00000000-0000-4000-8000-0000000000c2') as ok;
select 'the same-named listing in another region is untouched' as check, (select badges = '[]'::jsonb from public.providers where id = '00000000-0000-4000-8000-0000000000c3') as ok;

-- The Padrón confirmed by register number, as the loader does, then synced.
insert into public.facility_source_ids (source_slug, external_id, provider_id, status, tier, confidence, first_run_id, last_run_id)
  values ('padron-salud-bc', 'casa-prueba', '00000000-0000-4000-8000-0000000000c1', 'confirmed', 1, 1, :R5, :R5);
select 'sync renews the confirmed record' as check, (public.sync_facility_badges('padron-salud-bc', :R5, true)->>'renewed')::int = 1 as ok;
select 'sync twice changes nothing' as check,
  (public.sync_facility_badges('padron-salud-bc', :R5, true)->>'renewed')::int = 1
  and (select count(*) = 1 from public.listing_affiliations where source_slug = 'padron-salud-bc') as ok;
select 'a clinic carries all three, registers before the cluster' as check,
  (select array_agg(b->>'org' order by ord) = '{coepris-bc,padron-salud-bc,baja-health-cluster}'
   from public.providers p, jsonb_array_elements(p.badges) with ordinality x(b, ord) where p.id = '00000000-0000-4000-8000-0000000000c1') as ok;
select 'each clinic badge says what the organization is' as check,
  (select bool_and(b->>'info_url' like 'https://%') from public.providers p, jsonb_array_elements(p.badges) b where p.id = '00000000-0000-4000-8000-0000000000c1') as ok;

-- All six on one listing: the doctor's three kinds and a clinic's, without one wiping the other.
-- The Star Médica badge lapsed in the test above, so the doctor is seen again first.
update public.source_entries set missed_runs = 0, last_seen_run_id = :R3 where source_slug = 'starmedica';
select public.sync_source_badges('starmedica', :R3, true);
insert into public.source_entries (source_slug, external_id, name, label, url, first_seen_run_id, last_seen_run_id)
  values ('hospital-angeles', 'mario-prueba', 'Mario Prueba Uno', 'Hospital Angeles Ciudad Juárez', 'https://hospitalangeles.com/medico/mario-prueba', :R7, :R7);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence, first_run_id, last_run_id)
  values ('hospital-angeles', 'mario-prueba', '00000000-0000-4000-8000-000000000001', 'confirmed', 3, 1, :R7, :R7);
select public.sync_source_badges('hospital-angeles', :R7, true);
insert into public.listing_affiliations (provider_id, organization_id, label, status, source_slug, created_run_id, last_confirmed_run_id, last_confirmed_at, url)
  select '00000000-0000-4000-8000-0000000000a1', o.id, x.label, 'confirmed', o.slug, r.id, r.id, now(), x.url
  from (values ('coepris-bc', 'REPSSABI', 'https://example.test/1'), ('padron-salud-bc', 'Padrón Estatal de Salud', 'https://example.test/2'), ('baja-health-cluster', 'Recovery centers', 'https://example.test/3')) x (slug, label, url)
  join public.organizations o on o.slug = x.slug join public.source_runs r on r.source_slug = x.slug;
select public.refresh_listing_badges(array['00000000-0000-4000-8000-0000000000a1'::uuid]);
select 'one listing can show all six' as check,
  (select count(distinct b->>'org') = 6 from public.providers p, jsonb_array_elements(p.badges) b where p.id = '00000000-0000-4000-8000-0000000000a1') as ok;
select public.refresh_provider_badges(array['00000000-0000-4000-8000-000000000001'::uuid]);
select 'rebuilding from the doctor keeps the clinic badges' as check,
  (select count(distinct b->>'org') = 6 from public.providers p, jsonb_array_elements(p.badges) b where p.id = '00000000-0000-4000-8000-0000000000a1') as ok;
select 'each of the six has the right link' as check,
  (select count(*) = 6 from (select distinct b->>'org' as org, b->>'url' as url, b->>'info_url' as info
     from public.providers p, jsonb_array_elements(p.badges) b where p.id = '00000000-0000-4000-8000-0000000000a1') x
   where (org = 'conacem' and url is null and info = 'https://conacem.org.mx/quienes-somos') or (org <> 'conacem' and url like 'https://%')) as ok;

-- Two missed green runs lapse a clinic's badge, as for doctors.
update public.source_entries set missed_runs = 1 where source_slug = 'padron-salud-bc';
select 'one missed run changes nothing' as check, (public.sync_facility_badges('padron-salud-bc', :R5, true)->>'lapsed')::int = 0 as ok;
update public.source_entries set missed_runs = 2 where source_slug = 'padron-salud-bc';
insert into public.source_runs (id, source_slug, started_at, status) values (:R8, 'padron-salud-bc', now(), 'green');
select 'two missed runs lapse it' as check, (public.sync_facility_badges('padron-salud-bc', :R8, true)->>'lapsed')::int = 1 as ok;
select 'the lapsed badge leaves the listing, the others stay' as check,
  (select count(*) = 2 and bool_and(b->>'org' <> 'padron-salud-bc') from public.providers p, jsonb_array_elements(p.badges) b where p.id = '00000000-0000-4000-8000-0000000000c1') as ok;

select 'the sources overview counts clinic badges' as check,
  (select (x->>'badges')::int = 3 from (select public.admin_sources_overview() as all_sources) y, jsonb_array_elements(y.all_sources) x where x->>'slug' = 'coepris-bc') as ok
  from (select set_config('test.uid', '00000000-0000-4000-8000-00000000aaaa', false)) z;

set role anon;
select 'anon reads clinic badges through provider_list' as check, (select count(*) = 1 from public.provider_list where id = '00000000-0000-4000-8000-0000000000c1' and jsonb_array_length(badges) = 2) as ok;
do $$ begin perform 1 from public.facility_source_ids; raise exception 'anon read matches'; exception when insufficient_privilege then raise notice 'ok: anon cannot read clinic matches'; end $$;
do $$ begin perform 1 from public.listing_affiliations; raise exception 'anon read affiliations'; exception when insufficient_privilege then raise notice 'ok: anon cannot read clinic affiliations'; end $$;
do $$ begin perform public.refresh_listing_badges(array[]::uuid[]); raise exception 'anon ran refresh'; exception when insufficient_privilege then raise notice 'ok: anon cannot rebuild listings'; end $$;
do $$ begin perform public.facility_name_candidates('x', 'x'); raise exception 'anon ran candidates'; exception when insufficient_privilege then raise notice 'ok: anon cannot search clinics'; end $$;
do $$ begin perform public.sync_facility_badges('coepris-bc', '01a00000-0000-7000-8000-000000000004', false); raise exception 'anon ran sync'; exception when insufficient_privilege then raise notice 'ok: anon cannot sync clinics'; end $$;
reset role;

-- ── Backfill: a record whose name disagrees waits for a person (made-up) ─────
\set R9 '''01a00000-0000-7000-8000-000000000009'''
reset role;
select set_config('test.uid', '00000000-0000-4000-8000-00000000aaaa', false);
insert into public.source_runs (id, source_slug, started_at, status) values (:R9, 'doctoralia', now(), 'green');
insert into public.providers (id, name, region, specialty) values ('00000000-0000-4000-8000-0000000000d1', 'Dra. Otra Persona', 'elpaso-juarez', '{}');
insert into public.doctoralia_doctors (doctoralia_id, entity_type, name, cedulas, provider_id) values ('held1', 'doctor', 'Dra. Otra Persona', '{7650001}', '00000000-0000-4000-8000-0000000000d1');
insert into public.source_entries (source_slug, external_id, name, cedulas, first_seen_run_id, last_seen_run_id) values ('doctoralia', 'held1', 'Dra. Otra Persona', '{7650001}', :R9, :R9);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence, first_run_id, last_run_id) values ('doctoralia', 'held1', '00000000-0000-4000-8000-000000000001', 'probable', 1, 0.2, :R9, :R9);
select 'a held-back record is in the review queue' as check, (select count(*) = 1 from jsonb_array_elements(public.admin_match_queue('doctoralia')->'items') x where x->>'external_id' = 'held1') as ok;
select 'while waiting its listing has no doctor' as check, (select count(*) = 0 from public.doctor_listings where provider_id = '00000000-0000-4000-8000-0000000000d1') as ok;
select public.admin_match_decide('doctoralia', 'held1', 'confirm', null);
select 'confirming links the listing, tagged as a review' as check, (select method = 'review' and doctor_id = '00000000-0000-4000-8000-000000000001' from public.doctor_listings where provider_id = '00000000-0000-4000-8000-0000000000d1') as ok;
select 'confirming keeps its cédula' as check, (select doctor_id = '00000000-0000-4000-8000-000000000001' from public.doctor_cedulas where cedula = '7650001') as ok;
select 'confirming creates no badge for Doctoralia' as check, (select count(*) = 0 from public.doctor_affiliations where source_slug = 'doctoralia') as ok;
insert into public.doctoralia_doctors (doctoralia_id, entity_type, name, cedulas, provider_id) values ('held2', 'doctor', 'Dr. Tercero', '{}', null);
insert into public.source_entries (source_slug, external_id, name, first_seen_run_id, last_seen_run_id) values ('doctoralia', 'held2', 'Dr. Tercero', :R9, :R9);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence, first_run_id, last_run_id) values ('doctoralia', 'held2', '00000000-0000-4000-8000-000000000001', 'probable', 1, 0.2, :R9, :R9);
select public.admin_match_decide('doctoralia', 'held2', 'reject', null);
select 'rejecting links nothing' as check, (select status = 'rejected' from public.doctor_source_ids where external_id = 'held2') as ok;

-- ── Doctor identity rules ────────────────────────────────────────────────────
do $$ begin insert into public.doctor_cedulas (cedula, doctor_id, first_source) values ('1234567', '00000000-0000-4000-8000-000000000002', 'x'); raise exception 'cédula on two doctors'; exception when unique_violation then raise notice 'ok: one cédula, one doctor'; end $$;
do $$ begin insert into public.doctor_cedulas (cedula, doctor_id, first_source) values ('12a4567', '00000000-0000-4000-8000-000000000002', 'x'); raise exception 'bad cédula saved'; exception when check_violation then raise notice 'ok: a cédula must be 6 to 9 digits'; end $$;
do $$ begin update public.doctors set status = 'merged' where id = '00000000-0000-4000-8000-000000000002'; raise exception 'merged with no target'; exception when check_violation then raise notice 'ok: a merged doctor must say into whom'; end $$;
do $$ begin insert into public.doctor_source_ids (source_slug, external_id, status) values ('starmedica', 'no-doc', 'confirmed'); raise exception 'confirmed with no doctor'; exception when check_violation then raise notice 'ok: a confirmed match needs a doctor'; end $$;
select 'the removed cédula lookup is gone' as check, to_regproc('public.listings_for_cedula') is null as ok;
select 'the unused credential table is gone' as check, to_regclass('public.doctor_credential_status') is null as ok;
select 'every new table has row level security' as check,
  (select bool_and(c.relrowsecurity) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname in ('organizations','data_sources','source_runs','source_entries','source_observations','doctors','doctor_cedulas','doctor_source_ids','doctor_listings','doctor_merges','doctor_affiliations','facility_source_ids','listing_affiliations')) as ok;
select 'no new table is readable by anon or signed-in users' as check,
  (select count(*) = 0 from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon','authenticated')
     and table_name in ('organizations','data_sources','source_runs','source_entries','source_observations','doctors','doctor_cedulas','doctor_source_ids','doctor_listings','doctor_merges','doctor_affiliations','facility_source_ids','listing_affiliations')) as ok;
select 'provider_list exposes no doctor ID' as check, (select count(*) = 0 from information_schema.columns where table_name = 'provider_list' and column_name ilike '%doctor%') as ok;
select 'no badge carries a doctor ID' as check, (select count(*) = 0 from public.providers p, jsonb_array_elements(p.badges) b where b ? 'doctor_id') as ok;

-- ── Decisions are final ──────────────────────────────────────────────────────
do $$ begin perform public.admin_match_decide('doctoralia', 'held1', 'reject', null); raise exception 'undid a decision'; exception when raise_exception then if sqlerrm = 'undid a decision' then raise; end if; raise notice 'ok: a confirmed match cannot be rejected'; end $$;
do $$ begin perform public.admin_match_decide('doctoralia', 'held2', 'confirm', null); raise exception 'undid a decision'; exception when raise_exception then if sqlerrm = 'undid a decision' then raise; end if; raise notice 'ok: a rejected match cannot be confirmed'; end $$;
do $$ begin perform public.admin_match_decide('doctoralia', 'no-such', 'confirm', null); raise exception 'unknown accepted'; exception when raise_exception then if sqlerrm = 'unknown accepted' then raise; end if; raise notice 'ok: an unknown record is refused'; end $$;
do $$ begin perform public.admin_match_decide('doctoralia', 'held1', 'maybe', null); raise exception 'bad decision accepted'; exception when raise_exception then if sqlerrm = 'bad decision accepted' then raise; end if; raise notice 'ok: only confirm or reject'; end $$;
select 'a rejected match stayed rejected' as check, (select status = 'rejected' from public.doctor_source_ids where external_id = 'held2') as ok;
