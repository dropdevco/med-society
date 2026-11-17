-- Runs after migration 0045. Checks the six logos are on, and that it only touched those six.
select 'all six organizations have a logo and a permission date' as check,
  (select count(*) = 6 from public.organizations
   where logo_url = '/logos/orgs/' || slug || '.png' and logo_permission_at is not null
     and slug in ('hospital-angeles', 'starmedica', 'conacem', 'coepris-bc', 'padron-salud-bc', 'baja-health-cluster')) as ok;
select 'no other organization gets a logo' as check,
  (select count(*) = 0 from public.organizations
   where logo_permission_at is not null
     and slug not in ('hospital-angeles', 'starmedica', 'conacem', 'coepris-bc', 'padron-salud-bc', 'baja-health-cluster')) as ok;
select 'badges already built now carry the logo' as check,
  (select count(*) > 0 and bool_and(b->>'logo' = '/logos/orgs/' || (b->>'org') || '.png')
   from public.providers p, jsonb_array_elements(p.badges) b
   where b->>'org' in ('hospital-angeles', 'starmedica', 'conacem', 'coepris-bc', 'padron-salud-bc', 'baja-health-cluster')) as ok;
