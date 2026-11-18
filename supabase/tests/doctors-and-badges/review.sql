\set ON_ERROR_STOP on
-- 0052: the side-by-side compare and the near-the-bar list. Made-up doctors.
\set RB '''01a00000-0000-7000-8000-0000000000c1'''
\set RS '''01a00000-0000-7000-8000-0000000000c2'''
\set RO '''01a00000-0000-7000-8000-0000000000c3'''
insert into public.doctors (id, display_name, name_key) values
  ('00000000-0000-4000-8000-0000000000e1', 'Dra. Rosa Ejemplo Rio', 'ROEJ'),
  ('00000000-0000-4000-8000-0000000000e2', 'Dra. Rosa Ejemplo Rios', 'ROEJ'),
  ('00000000-0000-4000-8000-0000000000e3', 'Dr. Pablo Ejemplo Luna', 'PAEJ');
insert into public.doctor_cedulas (cedula, doctor_id, kind, title, first_source) values
  ('8880001', '00000000-0000-4000-8000-0000000000e1', 'licenciatura', 'Médico Cirujano', 'baja-health-cluster-doctors'),
  ('8880002', '00000000-0000-4000-8000-0000000000e2', 'licenciatura', 'Médico Cirujano', 'baja-health-cluster-doctors');
insert into public.source_runs (id, source_slug, started_at, status) values
  (:RB, 'baja-health-cluster-doctors', now(), 'green'), (:RS, 'ai-scorer', now(), 'green'), (:RO, 'ai-scorer', now() - interval '2 days', 'green');
insert into public.source_entries (source_slug, external_id, name, label, specialties, cedulas, region, url, first_seen_run_id, last_seen_run_id) values
  ('baja-health-cluster-doctors', 'rosa', 'Rosa Ejemplo Rio', 'Member doctor', '{Pediatría}', '{}', 'sandiego-tijuana', 'https://bajahealthcluster.mx/directorio/rosa/', :RB, :RB),
  ('baja-health-cluster-doctors', 'pablo', 'Pablo Ejemplo Luna', 'Member doctor', '{}', '{}', 'sandiego-tijuana', 'https://bajahealthcluster.mx/directorio/pablo/', :RB, :RB),
  ('baja-health-cluster-doctors', 'sure', 'Pablo Ejemplo Luna', 'Member dentist', '{}', '{}', 'sandiego-tijuana', 'https://bajahealthcluster.mx/directorio/sure/', :RB, :RB),
  ('baja-health-cluster-doctors', 'nope', 'Rosa Ejemplo Rio', 'Member doctor', '{}', '{}', 'sandiego-tijuana', 'https://bajahealthcluster.mx/directorio/nope/', :RB, :RB);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence, candidates, first_run_id, last_run_id) values
  ('baja-health-cluster-doctors', 'rosa', '00000000-0000-4000-8000-0000000000e1', 'probable', 3, 0.9,
   '[{"doctor_id":"00000000-0000-4000-8000-0000000000e1","similarity":0.97},{"doctor_id":"00000000-0000-4000-8000-0000000000e2","similarity":0.93}]', :RB, :RB),
  ('baja-health-cluster-doctors', 'pablo', '00000000-0000-4000-8000-0000000000e3', 'probable', 3, 0.9, '[{"doctor_id":"00000000-0000-4000-8000-0000000000e3","similarity":1}]', :RB, :RB),
  ('baja-health-cluster-doctors', 'sure', '00000000-0000-4000-8000-0000000000e3', 'probable', 3, 1, '[{"doctor_id":"00000000-0000-4000-8000-0000000000e3","similarity":1}]', :RB, :RB),
  ('baja-health-cluster-doctors', 'nope', null, 'rejected', 3, 0.9, '[]', :RB, :RB);
-- rosa: 74, below the bar, waiting. pablo: 84, linked. sure: 97, far above. nope: 78, but a person rejected it.
insert into public.match_scores (run_id, kind, source_slug, external_id, candidate_id, score, verdict, reason, model, evidence, scored_at) values
  (:RO, 'doctor', 'baja-health-cluster-doctors', 'rosa', '00000000-0000-4000-8000-0000000000e1', 60, 'needs_human', 'Older score.', 'test', '{}', now() - interval '2 days'),
  (:RS, 'doctor', 'baja-health-cluster-doctors', 'rosa', '00000000-0000-4000-8000-0000000000e1', 74, 'needs_human', 'Two doctors share the name.', 'test', '{"record":{"name":"Rosa Ejemplo Rio"}}', now()),
  (:RS, 'doctor', 'baja-health-cluster-doctors', 'pablo', '00000000-0000-4000-8000-0000000000e3', 84, 'approve', 'Unique name.', 'test', '{}', now()),
  (:RS, 'doctor', 'baja-health-cluster-doctors', 'sure', '00000000-0000-4000-8000-0000000000e3', 97, 'approve', 'Unique name and cedula.', 'test', '{}', now()),
  (:RS, 'doctor', 'baja-health-cluster-doctors', 'nope', '00000000-0000-4000-8000-0000000000e1', 78, 'needs_human', 'Unsure.', 'test', '{}', now()),
  -- 'ced' (scorer.sql) is a cédula conflict: listed even at 40.
  (:RS, 'doctor', 'baja-health-cluster-doctors', 'ced', '00000000-0000-4000-8000-0000000000d1', 40, 'reject', 'Cedula belongs to someone else.', 'test', '{}', now());
select public.scorer_auto_link(:RS, 'baja-health-cluster-doctors', 'pablo', '00000000-0000-4000-8000-0000000000e3', 84::smallint);

set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-00000000aaaa', false);  -- the admin from exercise.sql
select 'compare: the record beside both candidates, each with its cedulas' as check,
  (select jsonb_array_length(c->'candidates') = 2
      and c->'record'->>'name' = 'Rosa Ejemplo Rio'
      and (select bool_and(jsonb_array_length(x->'cedulas') = 1) from jsonb_array_elements(c->'candidates') x)
      and (select (x->>'similarity')::numeric = 0.93 from jsonb_array_elements(c->'candidates') x where x->>'display_name' = 'Dra. Rosa Ejemplo Rios')
   from (select public.admin_match_compare('baja-health-cluster-doctors', 'rosa') c) t) as ok;
select 'compare: the latest AI score, with the evidence the model was shown' as check,
  (select (c->'ai'->>'score')::int = 74 and c->'ai'->'evidence'->'record'->>'name' = 'Rosa Ejemplo Rio' and c->'link' = 'null'::jsonb
   from (select public.admin_match_compare('baja-health-cluster-doctors', 'rosa') c) t) as ok;
select 'compare: a scorer-linked record shows the link and its doctor first' as check,
  (select c->>'status' = 'confirmed' and (c->'link'->>'score')::int = 84 and (c->'candidates'->0->>'linked')::boolean
   from (select public.admin_match_compare('baja-health-cluster-doctors', 'pablo') c) t) as ok;
select 'compare: an unknown record is null' as check, public.admin_match_compare('baja-health-cluster-doctors', 'no-such') is null as ok;
select 'near the bar: 70 to 89 either side, the latest score only, closest to 80 first' as check,
  (select jsonb_agg(r->>'external_id') = '["pablo", "rosa"]'::jsonb
   from jsonb_array_elements(public.review_near_bar(now() - interval '1 hour')) r where r->>'source_slug' = 'baja-health-cluster-doctors'
     and r->>'external_id' in ('rosa', 'pablo', 'sure', 'nope')) as ok;
select 'near the bar: says which were linked and names the candidate' as check,
  (select bool_and(case r->>'external_id' when 'pablo' then (r->>'linked')::boolean else not (r->>'linked')::boolean end)
      and bool_and(r->>'candidate' is not null)
   from jsonb_array_elements(public.review_near_bar(now() - interval '1 hour')) r where r->>'external_id' in ('rosa', 'pablo')) as ok;
select 'near the bar: a cedula conflict is listed whatever its score' as check,
  exists (select 1 from jsonb_array_elements(public.review_near_bar(now() - interval '1 day', 70, 89)) r where (r->>'tier')::int = 1) as ok;
select set_config('test.uid', '00000000-0000-4000-8000-00000000bbbb', false);  -- signed in, not an admin
do $$ begin perform public.admin_match_compare('baja-health-cluster-doctors', 'rosa'); raise exception 'a non-admin compared'; exception when insufficient_privilege then raise notice 'ok: compare is for admins'; end $$;
do $$ begin perform public.review_near_bar(now() - interval '1 day'); raise exception 'a non-admin listed'; exception when insufficient_privilege then raise notice 'ok: the near-the-bar list is for admins'; end $$;
select set_config('test.uid', '', false);
reset role;
set role service_role;
select set_config('test.role', 'service_role', false);
select 'near the bar: the daily e-mail job (service role) can read it' as check,
  jsonb_array_length(public.review_near_bar(now() - interval '1 hour')) >= 2 as ok;
select set_config('test.role', '', false);
reset role;
set role anon;
do $$ begin perform public.review_near_bar(now() - interval '1 day'); raise exception 'anon listed'; exception when insufficient_privilege then raise notice 'ok: anon cannot list'; end $$;
reset role;
