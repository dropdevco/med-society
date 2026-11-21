-- 0058: two worldwide accreditors as sources (GHA, JCI), and a watch-only source for
-- the Baja California Health Tourism catalogue.
--
-- GHA and JCI are facility sources like COEPRIS (docs/adr/0008): their records are
-- stored whole, worldwide, and a record in one of our regions is matched to a listing
-- for a person to confirm. Written permission for both, as reported on 21 Nov 2026
-- (docs/sources/README.md). Neither shows a logo until its logo permission is recorded.
--
-- The watch ('bajahealthtourism-watch') keeps a few fields of each catalogue record so
-- the pipeline can flag new doctors, hospitals, clinics and hotels. It is never matched
-- and never becomes a badge, so it has no organization.
--
-- No table changes beyond widening data_sources.entity to allow 'watch'.
--
-- Rollback:
--   delete from public.source_observations where entry_id in (select id from public.source_entries where source_slug in ('gha','jci','bajahealthtourism-watch'));
--   delete from public.facility_source_ids where source_slug in ('gha','jci');
--   delete from public.listing_affiliations where source_slug in ('gha','jci');
--   delete from public.source_entries where source_slug in ('gha','jci','bajahealthtourism-watch');
--   delete from public.source_runs where source_slug in ('gha','jci','bajahealthtourism-watch');
--   delete from public.data_sources where slug in ('gha','jci','bajahealthtourism-watch');
--   delete from public.organizations where slug in ('gha','jci');
--   alter table public.data_sources drop constraint data_sources_entity_check,
--       add constraint data_sources_entity_check check (entity in ('doctor','facility'));

alter table public.data_sources
    drop constraint data_sources_entity_check,
    add constraint data_sources_entity_check check (entity in ('doctor','facility','watch'));

insert into public.organizations (slug, name, kind, country, website, info_url) values
    ('gha', 'Global Healthcare Accreditation', 'accreditor', 'US', 'https://www.globalhealthcareaccreditation.com',
     'https://www.globalhealthcareaccreditation.com/accredited-and-certified-organizations-healthcare-providers-and-hotels'),
    ('jci', 'Joint Commission International', 'accreditor', 'US', 'https://www.jointcommission.org',
     'https://www.jointcommission.org/en-us/about-us/recognizing-excellence/find-accredited-international-organizations');

-- doctor_links = false: neither list has a page per organization, only the list itself.
insert into public.data_sources (slug, organization_id, name, access, permission_granted_on, permission_scope, permission_ref, doctor_links, entity)
select o.slug, o.id, x.name, 'permission', date '2026-11-21', x.scope,
       'Written permission as reported by Emilio, 21 Nov 2026; letter to be filed in the team vault', false, 'facility'
from public.organizations o
join (values
    ('gha', 'Global Healthcare Accreditation, accredited and certified organizations', 'Scrape, store and display; an API may follow'),
    ('jci', 'Joint Commission International, accredited organizations', 'Scrape, store and display; an API may follow')
) as x (slug, name, scope) on x.slug = o.slug;

insert into public.data_sources (slug, organization_id, name, access, doctor_links, cadence, entity) values
    ('bajahealthtourism-watch', null, 'Baja California Health Tourism catalogue (watch only: flags new records)', 'open', false, 'daily', 'watch');
