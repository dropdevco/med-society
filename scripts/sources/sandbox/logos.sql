-- Sandbox test build only: shows the logos in public/logos/orgs (git-ignored).
-- Marking permission here is what lets a tile show a logo. Production gets this
-- per organization, once its OK is recorded.
update public.organizations set logo_url = '/logos/orgs/' || slug || '.png', logo_permission_at = now()
where slug in ('hospital-angeles', 'starmedica', 'conacem', 'coepris-bc', 'padron-salud-bc', 'baja-health-cluster');
select public.refresh_listing_badges(array_agg(id)) as listings_rebuilt from public.providers where badges <> '[]'::jsonb;
