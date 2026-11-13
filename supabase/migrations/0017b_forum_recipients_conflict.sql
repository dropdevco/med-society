-- Already applied to production as "0017b_forum_recipients_conflict" (version 20261007031137).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

create or replace function public.forum_clinician_recipients(p_kind text)
returns table (user_id uuid, email text, lang text, token uuid, specialties text[])
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
    if p_kind not in ('prompts', 'digest') then
        raise exception 'unknown kind %', p_kind;
    end if;
    insert into public.notification_prefs (user_id)
    select distinct o.user_id from public.provider_owners o
    on conflict (user_id) do nothing;
    return query
    select u.id,
           u.email::text,
           case when bool_or(p.country = 'MX') then 'es' else 'en' end,
           np.token,
           coalesce(array_agg(distinct s) filter (where s is not null), '{}')
    from public.provider_owners o
    join auth.users u on u.id = o.user_id
    join public.notification_prefs np on np.user_id = u.id
    join public.providers p on p.id = o.provider_id
    left join lateral unnest(p.specialty) s on true
    where u.email is not null
      and u.email_confirmed_at is not null
      and case p_kind when 'prompts' then np.prompts else np.digest end
    group by u.id, u.email, np.token;
end;
$$;

create or replace function public.forum_user_contact(p_user uuid)
returns table (email text, token uuid)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
    insert into public.notification_prefs (user_id) values (p_user)
    on conflict (user_id) do nothing;
    return query
    select u.email::text, np.token
    from auth.users u
    join public.notification_prefs np on np.user_id = u.id
    where u.id = p_user
      and u.email is not null
      and u.email_confirmed_at is not null
      and np.answers;
end;
$$;

revoke all on function public.forum_clinician_recipients(text) from public, anon, authenticated;
revoke all on function public.forum_user_contact(uuid) from public, anon, authenticated;
grant execute on function public.forum_clinician_recipients(text) to service_role;
grant execute on function public.forum_user_contact(uuid) to service_role;
