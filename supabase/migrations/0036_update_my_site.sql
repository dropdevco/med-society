-- Owners edit their own website from the dashboard "Website" tab.
--
-- doctor_sites has no UPDATE grant for clients (what a site says about plan and
-- subdomain is ours). This one function lets the owner of the listing merge a
-- whitelist of content fields into their own row, nothing else. Photos upload to
-- the existing clinic-photos bucket under <provider_id>/site/, which the bucket
-- policy from 0003 already restricts to the owner.

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
    if pg_column_size(patch) > 40000 then
        raise exception 'too_large' using errcode = '54000';
    end if;
    for k in select jsonb_object_keys(patch) loop
        if k <> all (array['brand', 'images', 'headline', 'lead', 'about']) then
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
