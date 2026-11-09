-- Already applied to production as "grant_owner_update_socials" (version 20260930020122).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

grant update (socials) on public.providers to authenticated;
