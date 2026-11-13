-- Clinic name search through the trigram index, like the doctor search.
--
-- WHY. facility_name_candidates (0044) ran bh_norm() and similarity() over every
-- live listing for each register record, with no index. In the sandbox that took
-- a moment; on production the first COEPRIS load hit the 8 s statement timeout
-- (13 Nov 2026). providers.name_norm already holds bh_norm(name), kept current by
-- the providers_norm trigger (0005) and covered by providers_name_norm_trgm, so
-- the `%` operator can use the index. Same results: name_norm = bh_norm(name) and
-- the 0.5 floor is unchanged; `%` (pg_trgm's 0.3 default) only narrows the scan.
-- Needs 0044. Run in: Supabase dashboard -> SQL editor (or apply_migration).

create or replace function public.facility_name_candidates(p_name text, p_region text, p_limit integer default 5)
returns table (provider_id uuid, name text, similarity real, region text)
language sql stable security definer set search_path = public, extensions as $$
    with n as (select public.bh_norm(p_name) as norm)
    select p.id, p.name, extensions.similarity(p.name_norm, n.norm), p.region
    from public.providers p, n
    where p.status = 'live' and (p_region is null or p.region = p_region)
      and p.name_norm % n.norm
      and extensions.similarity(p.name_norm, n.norm) >= 0.5
    order by 3 desc, p.name
    limit p_limit;
$$;

revoke all on function public.facility_name_candidates(text, text, integer) from public, anon, authenticated;
grant execute on function public.facility_name_candidates(text, text, integer) to service_role;

-- Rollback: re-run the facility_name_candidates definition from 0044.
