-- The owner's brief (archetype, ranked priorities, proof blocks) is editable
-- from the dashboard: widen the whitelist of update_my_site (0036) to include it.

create or replace function public.update_my_site(target uuid, patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    k text;
    result jsonb;
begin
    if not public.owns_provider(target) then
        raise exception 'not_owner' using errcode = '42501';
    end if;
    if patch is null or jsonb_typeof(patch) <> 'object' then
        raise exception 'bad_patch' using errcode = '22023';
    end if;
    if pg_column_size(patch) > 60000 then
        raise exception 'too_large' using errcode = '54000';
    end if;
    for k in select jsonb_object_keys(patch) loop
        if k <> all (array['brand', 'images', 'headline', 'lead', 'about', 'brief', 'blocks']) then
            raise exception 'field_not_allowed: %', k using errcode = '22023';
        end if;
    end loop;

    update public.doctor_sites
       set content = content || patch, updated_at = now()
     where provider_id = target
    returning content into result;

    if result is null then
        raise exception 'no_site' using errcode = 'P0002';
    end if;
    return result;
end;
$$;

revoke all on function public.update_my_site(uuid, jsonb) from public, anon;
grant execute on function public.update_my_site(uuid, jsonb) to authenticated;
