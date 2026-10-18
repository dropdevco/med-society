-- Withdraw write privileges nobody uses from the browser roles.
--
-- Supabase gives anon/authenticated every privilege on new public tables and
-- relies on RLS to say no. For providers that left INSERT, DELETE, TRUNCATE,
-- REFERENCES and TRIGGER granted to both roles. RLS stops row writes (there is
-- no insert/delete policy), but TRUNCATE is not subject to RLS at all, and a
-- grant you do not need is one policy mistake away from being a hole.
--
-- What the browser legitimately does to these tables, and keeps:
--   providers         SELECT (columns, see 0032) and owner UPDATE (column grants
--                     from 0003/0008); listings are created through the
--                     bh_submit_listing / self-listing RPCs (SECURITY DEFINER)
--   provider_details  SELECT only (written by the scraper scripts, service role)
--   provider_list     SELECT only (a view)
-- service_role is untouched.

revoke insert, delete, truncate, references, trigger on public.providers         from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.provider_details from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.provider_list    from anon, authenticated;

-- anon never edits a listing (0003 already withdrew table UPDATE; be explicit).
revoke update on public.providers from anon;
