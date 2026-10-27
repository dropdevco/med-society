-- The admin per-question breakdown dropped any answer longer than 120
-- characters, which silently lost free-text answers (textarea questions allow
-- 600). Raise the cap to match. Patches the function in place so the large
-- body from 0026 is not duplicated here; safe to re-run.
do $$
declare d text;
begin
    select pg_get_functiondef('public.admin_forms_overview()'::regprocedure) into d;
    d := replace(d, 'length(v) <= 120', 'length(v) <= 600');
    execute d;
end $$;
