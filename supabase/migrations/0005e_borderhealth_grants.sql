-- Already applied to production as "0005e_borderhealth_grants" (version 20260926075359).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

revoke execute on function public.bh_claim_provider(uuid, uuid, text) from anon;
revoke execute on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) from anon;
revoke execute on function public.providers_norm_trg() from anon, authenticated;
alter function public.bh_phone(text) set search_path = pg_temp;
