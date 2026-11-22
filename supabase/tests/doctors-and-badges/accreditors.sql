\set ON_ERROR_STOP on
-- 0058: GHA and JCI as facility sources, and the watch-only catalogue source. Made-up records.
select 'GHA and JCI are accreditors, each with its permission recorded' as check,
  (select count(*) = 2 from public.data_sources d join public.organizations o on o.id = d.organization_id
   where d.slug in ('gha', 'jci') and o.kind = 'accreditor' and d.access = 'permission' and d.permission_granted_on = date '2026-11-21'
     and d.entity = 'facility' and d.doctor_links = false) as ok;
select 'the watch has no organization, so it can never become a badge' as check,
  (select organization_id is null and entity = 'watch' and cadence = 'daily' from public.data_sources where slug = 'bajahealthtourism-watch') as ok;
select 'no logo shows for either until its permission is recorded' as check,
  (select bool_and(logo_permission_at is null) from public.organizations where slug in ('gha', 'jci')) as ok;
do $$ begin
    insert into public.data_sources (slug, name, access, entity) values ('bogus', 'x', 'open', 'listing');
    raise exception 'an unknown entity was accepted';
exception when check_violation then raise notice 'ok: entity is still checked';
end $$;

-- A worldwide record: stored with no region, its country in facts.
insert into public.source_runs (id, source_slug, started_at, status) values ('01a20000-0000-7000-8000-0000000000a1', 'jci', now(), 'green');
insert into public.source_entries (source_slug, external_id, name, label, specialties, cedulas, region, url, facts, first_seen_run_id, last_seen_run_id) values
  ('jci', '60000001', 'Hospital Ejemplo Bangkok', 'Hospital Program', '{}', '{}', null,
   'https://www.jointcommission.org/en-us/about-us/recognizing-excellence/find-accredited-international-organizations',
   '{"country":"Thailand","city":"Bangkok","hcoId":"60000001"}', '01a20000-0000-7000-8000-0000000000a1', '01a20000-0000-7000-8000-0000000000a1');
select 'a record outside our regions is stored, with its country' as check,
  (select region is null and facts->>'country' = 'Thailand' from public.source_entries where source_slug = 'jci' and external_id = '60000001') as ok;

-- The watch keeps records too.
insert into public.source_runs (id, source_slug, started_at, status) values ('01a20000-0000-7000-8000-0000000000a2', 'bajahealthtourism-watch', now(), 'green');
insert into public.source_entries (source_slug, external_id, name, label, specialties, cedulas, region, url, facts, first_seen_run_id, last_seen_run_id) values
  ('bajahealthtourism-watch', 'hotel:1', 'Hotel Ejemplo', 'hotel', '{}', '{}', 'sandiego-tijuana', 'https://bajahealthtourism.com.mx/hotels',
   '{"kind":"hotel","siteId":"1"}', '01a20000-0000-7000-8000-0000000000a2', '01a20000-0000-7000-8000-0000000000a2');
select 'the watch stores its records' as check,
  exists (select 1 from public.source_entries where source_slug = 'bajahealthtourism-watch' and external_id = 'hotel:1') as ok;

set role anon;
do $$ begin
    perform 1 from public.source_entries limit 1;
    raise exception 'anon read source entries';
exception when insufficient_privilege then raise notice 'ok: anon cannot read source entries';
end $$;
reset role;
