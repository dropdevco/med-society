\set ON_ERROR_STOP on
-- 0048: the AI scorer's scores, auto-links, undo by run and split. Made-up doctors.
\set RB '''01a00000-0000-7000-8000-0000000000b1'''
\set RS '''01a00000-0000-7000-8000-0000000000b2'''
\set RU '''01a00000-0000-7000-8000-0000000000b3'''
insert into public.doctors (id, display_name, name_key) values
  ('00000000-0000-4000-8000-0000000000d1', 'Dra. Lucia Prueba Mar', 'LUPR'),
  ('00000000-0000-4000-8000-0000000000d2', 'Dr. Tomas Prueba Sol', 'TOPR');
insert into public.source_runs (id, source_slug, started_at, status) values
  (:RB, 'baja-health-cluster-doctors', now(), 'green'), (:RS, 'ai-scorer', now(), 'green'), (:RU, 'ai-scorer', now(), 'green');
insert into public.source_entries (source_slug, external_id, name, label, cedulas, url, first_seen_run_id, last_seen_run_id) values
  ('baja-health-cluster-doctors', 'lucia-a', 'Lucia Prueba Mar', 'Member doctor', '{9990001}', 'https://bajahealthcluster.mx/directorio/lucia-a/', :RB, :RB),
  ('baja-health-cluster-doctors', 'lucia-b', 'Lucia Prueba Mar', 'Member dentist', '{}', 'https://bajahealthcluster.mx/directorio/lucia-b/', :RB, :RB),
  ('baja-health-cluster-doctors', 'tomas', 'Tomas Prueba Sol', 'Member doctor', '{9990002}', 'https://bajahealthcluster.mx/directorio/tomas/', :RB, :RB),
  ('baja-health-cluster-doctors', 'ced', 'Lucia Prueba Mar', 'Member doctor', '{9990003}', 'https://bajahealthcluster.mx/directorio/ced/', :RB, :RB);
insert into public.doctor_source_ids (source_slug, external_id, doctor_id, status, tier, confidence, candidates, first_run_id, last_run_id) values
  ('baja-health-cluster-doctors', 'lucia-a', '00000000-0000-4000-8000-0000000000d1', 'probable', 3, 1, '[{"doctor_id":"00000000-0000-4000-8000-0000000000d1"}]', :RB, :RB),
  ('baja-health-cluster-doctors', 'lucia-b', '00000000-0000-4000-8000-0000000000d1', 'probable', 3, 1, '[{"doctor_id":"00000000-0000-4000-8000-0000000000d1"}]', :RB, :RB),
  ('baja-health-cluster-doctors', 'tomas', '00000000-0000-4000-8000-0000000000d2', 'probable', 3, 0.9, '[{"doctor_id":"00000000-0000-4000-8000-0000000000d2"}]', :RB, :RB),
  ('baja-health-cluster-doctors', 'ced', '00000000-0000-4000-8000-0000000000d1', 'probable', 1, 0.8, '[]', :RB, :RB);

-- Shadow mode: a score is stored and shown, nothing is linked.
insert into public.match_scores (run_id, kind, source_slug, external_id, candidate_id, score, verdict, reason, model, evidence) values
  (:RS, 'doctor', 'baja-health-cluster-doctors', 'tomas', '00000000-0000-4000-8000-0000000000d2', 91, 'approve', 'Unique name and specialty.', 'test', '{}');
set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-00000000aaaa', false);  -- the admin from exercise.sql
select 'scores: the review queue shows the latest score beside the item' as check,
  (select (i->'ai_score'->>'score')::int = 91 and i->'ai_score'->>'verdict' = 'approve'
     from jsonb_array_elements(public.admin_match_queue('baja-health-cluster-doctors')->'items') i where i->>'external_id' = 'tomas') as ok;
select set_config('test.uid', '', false);  -- the scorer runs as the service role: no signed-in user
reset role;
select 'scores: a score alone changes no match' as check,
  (select status = 'probable' and decided_by is null from public.doctor_source_ids where external_id = 'tomas') as ok;
set role anon;
do $$ begin perform 1 from public.match_scores; raise exception 'anon read scores'; exception when insufficient_privilege then raise notice 'ok: scores are not public'; end $$;
reset role;

-- Auto-link (the off-by-default setting): each link records what it changed.
select 'link: a name match above the bar links' as check,
  public.scorer_auto_link(:RS, 'baja-health-cluster-doctors', 'lucia-a', '00000000-0000-4000-8000-0000000000d1', 88::smallint) as ok;
select 'link: the second record from the same run links to the same doctor' as check,
  public.scorer_auto_link(:RS, 'baja-health-cluster-doctors', 'lucia-b', '00000000-0000-4000-8000-0000000000d1', 85::smallint) as ok;
select 'link: the doctor gets the cluster badge and the published cedula' as check,
  (select count(*) = 2 from public.doctor_affiliations where doctor_id = '00000000-0000-4000-8000-0000000000d1' and source_slug = 'baja-health-cluster-doctors')
  and exists (select 1 from public.doctor_cedulas where cedula = '9990001' and doctor_id = '00000000-0000-4000-8000-0000000000d1') as ok;
select 'link: the ledger holds the row as it was and the cedula it added' as check,
  (select before_match->>'status' = 'probable' and before_affiliation is null and new_cedulas = '{9990001}'
     from public.match_links where external_id = 'lucia-a') as ok;
select 'link: a cedula conflict is never auto-linked' as check,
  not public.scorer_auto_link(:RS, 'baja-health-cluster-doctors', 'ced', '00000000-0000-4000-8000-0000000000d1', 99::smallint)
  and (select status = 'probable' from public.doctor_source_ids where external_id = 'ced') as ok;
select 'link: a decided match is not linked again' as check,
  not public.scorer_auto_link(:RS, 'baja-health-cluster-doctors', 'lucia-a', '00000000-0000-4000-8000-0000000000d1', 99::smallint) as ok;
do $$ begin perform public.scorer_auto_link('01a00000-0000-7000-8000-0000000000b2', 'baja-health-cluster-doctors', 'tomas', '00000000-0000-4000-8000-0000000000d1', 90::smallint); raise exception 'linked to a non-candidate'; exception when raise_exception then raise notice 'ok: only a candidate doctor can be linked'; end $$;

-- Split: the run put two people under one UUID; lucia-b is someone else.
select 'split: one group makes one new doctor' as check,
  cardinality(public.scorer_split(:RS, '00000000-0000-4000-8000-0000000000d1', '[["baja-health-cluster-doctors/lucia-b"]]')) = 1 as ok;
select 'split: the record and its badge moved, the other stayed' as check,
  (select doctor_id <> '00000000-0000-4000-8000-0000000000d1' from public.doctor_source_ids where external_id = 'lucia-b')
  and (select doctor_id = '00000000-0000-4000-8000-0000000000d1' from public.doctor_source_ids where external_id = 'lucia-a')
  and (select count(*) = 1 from public.doctor_affiliations where doctor_id = '00000000-0000-4000-8000-0000000000d1' and source_slug = 'baja-health-cluster-doctors')
  and (select count(*) = 1 from public.doctor_affiliations a join public.match_links l on l.split_into = a.doctor_id where l.external_id = 'lucia-b') as ok;
select 'split: the new doctor is traced to the run' as check,
  (select d.created_run_id = :RS and d.display_name = 'Lucia Prueba Mar' from public.doctors d join public.match_links l on l.split_into = d.id where l.external_id = 'lucia-b') as ok;
do $$ begin perform public.scorer_split('01a00000-0000-7000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000d1', '[["baja-health-cluster-doctors/tomas"]]'); raise exception 'split a record the run never linked'; exception when raise_exception then raise notice 'ok: only records the run linked can be split'; end $$;

-- Undo by run: everything the run still holds goes back; a later decision by a person stays.
select public.scorer_auto_link(:RU, 'baja-health-cluster-doctors', 'tomas', '00000000-0000-4000-8000-0000000000d2', 90::smallint);
select 'undo: puts the run back, newest first' as check,
  (public.scorer_undo_run(:RS) = '{"undone": 1, "skipped": 0}'::jsonb) as ok;
select 'undo: the record waits for review again, with no badge and no added cedula' as check,
  (select status = 'probable' and decided_by is null from public.doctor_source_ids where external_id = 'lucia-a')
  and not exists (select 1 from public.doctor_affiliations where doctor_id = '00000000-0000-4000-8000-0000000000d1' and source_slug = 'baja-health-cluster-doctors')
  and not exists (select 1 from public.doctor_cedulas where cedula = '9990001') as ok;
select 'undo: running it twice changes nothing' as check, public.scorer_undo_run(:RS) = '{"undone": 0, "skipped": 0}'::jsonb as ok;
update public.doctor_source_ids set decided_by = '00000000-0000-4000-8000-00000000aaaa' where external_id = 'tomas';
select 'undo: a link a person has since decided on is skipped' as check,
  public.scorer_undo_run(:RU) = '{"undone": 0, "skipped": 1}'::jsonb
  and (select status = 'confirmed' from public.doctor_source_ids where external_id = 'tomas') as ok;
set role authenticated;
do $$ begin perform public.scorer_undo_run('01a00000-0000-7000-8000-0000000000b3'); raise exception 'a signed-in user ran undo'; exception when insufficient_privilege then raise notice 'ok: only the service role links, undoes or splits'; end $$;
reset role;
