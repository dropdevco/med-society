-- Two fixes to admin_billing_overview, patched in place as 0034 and 0035 do.
--
--   * Tier drift reported every listing whose plans had all ended: with no active
--     plan the max() is null, which fell through to 'promoted' and never reached
--     the 'basic' default.
--   * The event log did not say who ended a plan.
--
-- Safe to re-run.

do $$
declare
    d text;
    was text;
begin
    select pg_get_functiondef('public.admin_billing_overview()'::regprocedure) into d;
    if position('ev.resolved_by' in d) = 0 then
        was := d;
        d := replace(d,
$old$when 2 then 'featured' else 'promoted' end
                      from public.provider_subscriptions s where s.provider_id = p.id and public.sub_grants_access(s)), 'basic')$old$,
$new$when 2 then 'featured' when 1 then 'promoted' end
                      from public.provider_subscriptions s where s.provider_id = p.id and public.sub_grants_access(s)), 'basic')$new$);
        if d = was then raise exception 'admin_billing_overview: tier drift not found'; end if;

        was := d;
        d := replace(d,
$old$ev.match_method, ev.detail, p.name as provider_name$old$,
$new$ev.match_method, ev.detail, ev.resolved_by, p.name as provider_name$new$);
        if d = was then raise exception 'admin_billing_overview: recent events not found'; end if;
        execute d;
    end if;
end $$;
