-- Organization logos: all six organizations authorized logo use, recorded 6 Nov 2026
-- (docs/sources/README.md). Needs 0039 to 0041, and the files in public/logos/orgs.
-- Safe to run twice.

update public.organizations
set logo_url = '/logos/orgs/' || slug || '.png',
    logo_permission_at = timestamptz '2026-11-06 00:00:00+00'
where slug in ('hospital-angeles', 'starmedica', 'conacem', 'coepris-bc', 'padron-salud-bc', 'baja-health-cluster');

-- Badges cache the logo, so any already built need rebuilding.
select public.refresh_listing_badges(coalesce(array_agg(id), '{}'::uuid[]))
from public.providers
where badges <> '[]'::jsonb;

-- Rollback:
--     update public.organizations set logo_url = null, logo_permission_at = null;
--     then rebuild badges with the select above.
