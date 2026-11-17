-- Already applied to production as "0015b_forum_trigger_grants" (version 20261007022639).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

revoke execute on function public.forum_reply_counts() from anon, authenticated;
revoke execute on function public.forum_helpful_counts() from anon, authenticated;
