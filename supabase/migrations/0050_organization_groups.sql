-- Organizations are the groups doctors belong to (decided 16 Nov 2026: reuse
-- organizations and doctor_affiliations, docs/adr/0003 and 0007, rather than a
-- second groups table). This adds the two group types the plan names, makes Baja
-- Health Cluster a cluster, and registers its doctor directory as a source of its
-- own: the existing `baja-health-cluster` source reads recovery centers (facility
-- badges); `baja-health-cluster-doctors` reads doctors (doctor badges). Both feed
-- the same organization, so "doctors at Baja Health Cluster" is one filter.
-- Needs 0042 to 0046. Run in: Supabase dashboard -> SQL editor (or apply_migration).

alter table public.organizations drop constraint organizations_kind_check;
alter table public.organizations add constraint organizations_kind_check
    check (kind in ('hospital','consejo','colegio','association','cluster','wellness_center','regulator','accreditor'));

update public.organizations set kind = 'cluster' where slug = 'baja-health-cluster';

insert into public.data_sources (slug, organization_id, name, access, entity)
select 'baja-health-cluster-doctors', o.id, 'Baja Health Cluster doctor and dentist directory', 'open', 'doctor'
from public.organizations o where o.slug = 'baja-health-cluster';

-- Badges cache the organization's kind; rebuild the ones already built.
select public.refresh_listing_badges(coalesce(array_agg(id), '{}'::uuid[]))
from public.providers
where badges <> '[]'::jsonb;

-- Rollback:
--     delete from public.data_sources where slug = 'baja-health-cluster-doctors';  -- only while nothing points at it
--     update public.organizations set kind = 'association' where slug = 'baja-health-cluster';
--     alter table public.organizations drop constraint organizations_kind_check;
--     alter table public.organizations add constraint organizations_kind_check
--         check (kind in ('hospital','consejo','colegio','association','regulator','accreditor'));
--     then rebuild badges with the select above.
