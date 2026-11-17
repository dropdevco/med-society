-- Tables the sandbox needs beyond the migration test's stand-ins.
-- Production grants service_role on the view; the stand-in only grants anon and authenticated.
grant select on public.provider_list to service_role;

-- Stand-in for provider_public (0032): same shape, without the throttle.
create function public.provider_public(p_id uuid) returns jsonb language sql stable as $$
    select to_jsonb(p) from public.providers p where p.id = p_id and p.status = 'live'
$$;
grant execute on function public.provider_public(uuid) to service_role;
