-- Already applied to production as "clinic_teams" (version 20261010212109).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

create table if not exists public.clinic_practitioners (
    clinic_id       uuid not null references public.providers (id) on delete cascade,
    practitioner_id uuid not null references public.providers (id) on delete cascade,
    status          text not null default 'active' check (status in ('active', 'pending')),
    managed         boolean not null default false,
    sort            integer not null default 0,
    added_by        uuid references auth.users (id) on delete set null,
    created_at      timestamptz not null default now(),
    primary key (clinic_id, practitioner_id),
    check (clinic_id <> practitioner_id)
);
create index if not exists clinic_practitioners_practitioner_idx on public.clinic_practitioners (practitioner_id);

create table if not exists public.provider_invites (
    id          uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.providers (id) on delete cascade,
    clinic_id   uuid not null references public.providers (id) on delete cascade,
    email       text not null check (char_length(email) between 3 and 160 and email like '%@%'),
    role        text not null check (role in ('owner', 'staff')),
    token_hash  text not null unique,
    invited_by  uuid references auth.users (id) on delete set null,
    created_at  timestamptz not null default now(),
    expires_at  timestamptz not null default now() + interval '14 days',
    accepted_at timestamptz,
    accepted_by uuid references auth.users (id) on delete set null,
    revoked_at  timestamptz
);
create index if not exists provider_invites_clinic_idx on public.provider_invites (clinic_id, created_at desc);
create unique index if not exists provider_invites_open_key
    on public.provider_invites (provider_id, lower(email))
    where accepted_at is null and revoked_at is null;

create or replace function public.manages_provider(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.provider_owners
        where provider_id = target and user_id = auth.uid()
    ) or exists (
        select 1
        from public.clinic_practitioners l
        join public.provider_owners o on o.provider_id = l.clinic_id
        where l.practitioner_id = target
          and l.status = 'active' and l.managed
          and o.user_id = auth.uid()
    );
$$;

create or replace function public.speaks_as_provider(target uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
    select exists (
        select 1 from public.provider_owners
        where provider_id = target and user_id = auth.uid() and role = 'owner'
    );
$$;

create or replace function public.is_clinician()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
    select exists (select 1 from public.provider_owners where user_id = auth.uid() and role = 'owner');
$$;

revoke all on function public.manages_provider(uuid) from public, anon;
revoke all on function public.speaks_as_provider(uuid) from public, anon;
grant execute on function public.manages_provider(uuid) to authenticated;
grant execute on function public.speaks_as_provider(uuid) to authenticated;

drop policy if exists "owners update own listing" on public.providers;
create policy "owners update own listing" on public.providers
    for update to authenticated
    using (public.manages_provider(id))
    with check (public.manages_provider(id));

drop policy if exists "owners read own listing" on public.providers;
create policy "owners read own listing" on public.providers
    for select to authenticated using (public.manages_provider(id));

drop policy if exists "owners write clinic photos" on public.provider_photos;
create policy "owners write clinic photos" on public.provider_photos
    for all to authenticated
    using (public.manages_provider(provider_id))
    with check (public.manages_provider(provider_id));

drop policy if exists "owners write clinic photo files" on storage.objects;
create policy "owners write clinic photo files" on storage.objects
    for all to authenticated
    using (
        bucket_id = 'clinic-photos'
        and public.manages_provider(((storage.foldername(name))[1])::uuid)
    )
    with check (
        bucket_id = 'clinic-photos'
        and public.manages_provider(((storage.foldername(name))[1])::uuid)
    );

do $$
begin
    if to_regclass('public.provider_details') is not null then
        execute 'drop policy if exists "owners read own details" on public.provider_details';
        execute 'create policy "owners read own details" on public.provider_details
                    for select to authenticated using (public.manages_provider(provider_id))';
    end if;
end $$;

drop policy if exists "post threads" on public.forum_threads;
create policy "post threads" on public.forum_threads
    for insert to authenticated
    with check (
        author_id = auth.uid()
        and (provider_id is null or public.speaks_as_provider(provider_id))
        and (forum = 'patients' or (forum = 'society' and provider_id is not null))
    );

drop policy if exists "post replies" on public.forum_replies;
create policy "post replies" on public.forum_replies
    for insert to authenticated
    with check (
        author_id = auth.uid()
        and (provider_id is null or public.speaks_as_provider(provider_id))
        and exists (
            select 1 from public.forum_threads t
            where t.id = forum_replies.thread_id
              and not t.hidden
              and (
                  forum_replies.provider_id is not null
                  or (t.forum = 'patients' and t.author_id = auth.uid())
              )
        )
    );

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
    select distinct o.user_id from public.provider_owners o where o.role = 'owner'
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
    where o.role = 'owner'
      and u.email is not null
      and u.email_confirmed_at is not null
      and case p_kind when 'prompts' then np.prompts else np.digest end
    group by u.id, u.email, np.token;
end;
$$;

alter table public.clinic_practitioners enable row level security;
alter table public.provider_invites enable row level security;

drop policy if exists "public reads active links" on public.clinic_practitioners;
create policy "public reads active links" on public.clinic_practitioners
    for select to anon, authenticated using (status = 'active');

drop policy if exists "teams read own links" on public.clinic_practitioners;
create policy "teams read own links" on public.clinic_practitioners
    for select to authenticated
    using (public.owns_provider(clinic_id) or public.owns_provider(practitioner_id));

revoke all on public.clinic_practitioners from anon, authenticated;
grant select on public.clinic_practitioners to anon, authenticated;
revoke all on public.provider_invites from anon, authenticated;

create or replace function public.team_require(p_clinic uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if not public.owns_provider(p_clinic) then
        raise exception 'not_on_team' using errcode = '42501';
    end if;
end;
$$;
revoke all on function public.team_require(uuid) from public, anon, authenticated;

create or replace function public.invite_hash(p_token text)
returns text language sql immutable set search_path = extensions, pg_temp
as $$
    select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;
revoke all on function public.invite_hash(text) from public, anon, authenticated;

create or replace function public.team_overview(p_clinic uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
begin
    perform public.team_require(p_clinic);

    return jsonb_build_object(
        'members', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'user_id', o.user_id, 'email', u.email, 'role', o.role,
                       'created_at', o.created_at, 'is_me', o.user_id = v_uid)
                   order by o.role, o.created_at)
            from public.provider_owners o
            join auth.users u on u.id = o.user_id
            where o.provider_id = p_clinic), '[]'::jsonb),
        'invites', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', i.id, 'email', i.email, 'role', i.role,
                       'provider_id', i.provider_id, 'created_at', i.created_at,
                       'expires_at', i.expires_at, 'expired', i.expires_at < now())
                   order by i.created_at desc)
            from public.provider_invites i
            where i.clinic_id = p_clinic and i.accepted_at is null and i.revoked_at is null), '[]'::jsonb),
        'practitioners', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', p.id, 'name', p.name, 'specialty', p.specialty,
                       'imageUrl', p."imageUrl", 'listing_status', p.status,
                       'link_status', l.status, 'managed', l.managed,
                       'claimed', exists (select 1 from public.provider_owners o
                                          where o.provider_id = p.id and o.role = 'owner'))
                   order by l.sort, p.name)
            from public.clinic_practitioners l
            join public.providers p on p.id = l.practitioner_id
            where l.clinic_id = p_clinic), '[]'::jsonb),
        'clinics', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'name', c.name, 'city', c.city,
                       'link_status', l.status, 'managed', l.managed)
                   order by c.name)
            from public.clinic_practitioners l
            join public.providers c on c.id = l.clinic_id
            where l.practitioner_id = p_clinic), '[]'::jsonb)
    );
end;
$$;

create or replace function public.team_invite(
    p_clinic   uuid,
    p_email    text,
    p_role     text default 'staff',
    p_provider uuid default null
)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions, pg_temp
as $$
declare
    v_uid    uuid := auth.uid();
    v_email  text := lower(btrim(coalesce(p_email, '')));
    v_target uuid := coalesce(p_provider, p_clinic);
    v_role   text := case when p_provider is null then p_role else 'owner' end;
    v_token  text;
    v_id     uuid;
begin
    perform public.team_require(p_clinic);

    if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(v_email) > 160 then
        raise exception 'bad_email' using errcode = '22023';
    end if;
    if v_role not in ('owner', 'staff') then
        raise exception 'bad_role' using errcode = '22023';
    end if;

    if p_provider is not null then
        if not exists (select 1 from public.clinic_practitioners
                        where clinic_id = p_clinic and practitioner_id = p_provider
                          and status = 'active') then
            raise exception 'not_linked' using errcode = '42501';
        end if;
        if exists (select 1 from public.provider_owners
                    where provider_id = p_provider and role = 'owner') then
            raise exception 'already_claimed' using errcode = '23505';
        end if;
    end if;

    if exists (select 1 from public.provider_owners o join auth.users u on u.id = o.user_id
                where o.provider_id = v_target and lower(u.email) = v_email) then
        raise exception 'already_member' using errcode = '23505';
    end if;

    if (select count(*) from public.provider_invites
         where clinic_id = p_clinic and created_at > now() - interval '1 day') >= 40 then
        raise exception 'too_many_invites' using errcode = '54000';
    end if;

    update public.provider_invites
       set revoked_at = now()
     where provider_id = v_target and lower(email) = v_email
       and accepted_at is null and revoked_at is null;

    v_token := encode(extensions.gen_random_bytes(24), 'hex');

    insert into public.provider_invites (provider_id, clinic_id, email, role, token_hash, invited_by)
    values (v_target, p_clinic, v_email, v_role, public.invite_hash(v_token), v_uid)
    returning id into v_id;

    return jsonb_build_object(
        'invite_id', v_id,
        'token', v_token,
        'email', v_email,
        'role', v_role,
        'provider_id', v_target,
        'provider_name', (select name from public.providers where id = v_target),
        'clinic_name', (select name from public.providers where id = p_clinic),
        'country', (select country from public.providers where id = p_clinic),
        'inviter_email', (select email from auth.users where id = v_uid)
    );
end;
$$;

create or replace function public.team_revoke_invite(p_invite uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
    v_clinic uuid;
begin
    select clinic_id into v_clinic from public.provider_invites where id = p_invite;
    if v_clinic is null then
        raise exception 'invite_not_found' using errcode = 'P0002';
    end if;
    perform public.team_require(v_clinic);
    update public.provider_invites set revoked_at = now()
     where id = p_invite and accepted_at is null and revoked_at is null;
end;
$$;

create or replace function public.invite_preview(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
    v public.provider_invites%rowtype;
begin
    select * into v from public.provider_invites where token_hash = public.invite_hash(p_token);
    if v.id is null then
        return jsonb_build_object('state', 'invalid');
    end if;
    return jsonb_build_object(
        'state', case
            when v.accepted_at is not null then 'used'
            when v.revoked_at is not null then 'revoked'
            when v.expires_at < now() then 'expired'
            else 'valid' end,
        'email', v.email,
        'role', v.role,
        'kind', case when v.provider_id = v.clinic_id then 'team' else 'practitioner' end,
        'provider_id', v.provider_id,
        'provider_name', (select name from public.providers where id = v.provider_id),
        'clinic_name', (select name from public.providers where id = v.clinic_id)
    );
end;
$$;

create or replace function public.invite_accept(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
    v_uid       uuid := auth.uid();
    v_email     text;
    v_confirmed boolean;
    v           public.provider_invites%rowtype;
begin
    if v_uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;

    select * into v from public.provider_invites
     where token_hash = public.invite_hash(p_token)
     for update;
    if v.id is null or v.revoked_at is not null then
        raise exception 'invite_invalid' using errcode = 'P0002';
    end if;
    if v.accepted_at is not null then
        if v.accepted_by = v_uid then
            return jsonb_build_object('status', 'accepted', 'provider_id', v.provider_id);
        end if;
        raise exception 'invite_used' using errcode = 'P0002';
    end if;
    if v.expires_at < now() then
        raise exception 'invite_expired' using errcode = 'P0002';
    end if;

    select lower(email), email_confirmed_at is not null
      into v_email, v_confirmed
      from auth.users where id = v_uid;
    if not v_confirmed or v_email is distinct from lower(v.email) then
        raise exception 'email_mismatch' using errcode = '42501';
    end if;

    if v.role = 'owner' and v.provider_id <> v.clinic_id
       and exists (select 1 from public.provider_owners
                    where provider_id = v.provider_id and role = 'owner' and user_id <> v_uid) then
        raise exception 'already_claimed' using errcode = '23505';
    end if;

    insert into public.provider_owners (provider_id, user_id, role)
    values (v.provider_id, v_uid, v.role)
    on conflict (provider_id, user_id) do update
        set role = case when excluded.role = 'owner' then 'owner' else provider_owners.role end;

    update public.provider_invites
       set accepted_at = now(), accepted_by = v_uid
     where id = v.id;

    return jsonb_build_object('status', 'accepted', 'provider_id', v.provider_id);
end;
$$;

create or replace function public.team_set_role(p_clinic uuid, p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
    perform public.team_require(p_clinic);
    if p_role not in ('owner', 'staff') then
        raise exception 'bad_role' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('team:' || p_clinic::text));
    if p_role = 'staff'
       and (select count(*) from public.provider_owners
             where provider_id = p_clinic and role = 'owner' and user_id <> p_user) = 0 then
        raise exception 'last_owner' using errcode = '23514';
    end if;
    update public.provider_owners set role = p_role
     where provider_id = p_clinic and user_id = p_user;
end;
$$;

create or replace function public.team_remove_member(p_clinic uuid, p_user uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
    perform public.team_require(p_clinic);
    perform pg_advisory_xact_lock(hashtext('team:' || p_clinic::text));
    if exists (select 1 from public.provider_owners
                where provider_id = p_clinic and user_id = p_user and role = 'owner')
       and (select count(*) from public.provider_owners
             where provider_id = p_clinic and role = 'owner' and user_id <> p_user) = 0 then
        raise exception 'last_owner' using errcode = '23514';
    end if;
    delete from public.provider_owners where provider_id = p_clinic and user_id = p_user;
end;
$$;

create or replace function public.practitioner_link(p_clinic uuid, p_practitioner uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
    v_owned   boolean;
    v_managed boolean;
    v_status  text;
begin
    perform public.team_require(p_clinic);
    if p_clinic = p_practitioner then
        raise exception 'same_listing' using errcode = '22023';
    end if;
    if not exists (select 1 from public.providers where id = p_practitioner and status = 'live') then
        raise exception 'listing_not_found' using errcode = 'P0002';
    end if;
    if (select count(*) from public.clinic_practitioners where clinic_id = p_clinic) >= 100 then
        raise exception 'too_many_practitioners' using errcode = '54000';
    end if;

    v_owned := exists (select 1 from public.provider_owners
                        where provider_id = p_practitioner and role = 'owner');
    v_managed := not v_owned and not exists (
        select 1 from public.clinic_practitioners
         where practitioner_id = p_practitioner and managed and clinic_id <> p_clinic);
    v_status := case when v_owned then 'pending' else 'active' end;

    insert into public.clinic_practitioners (clinic_id, practitioner_id, status, managed, added_by)
    values (p_clinic, p_practitioner, v_status, v_managed, auth.uid())
    on conflict (clinic_id, practitioner_id) do nothing;

    return (select jsonb_build_object('status', status, 'managed', managed)
              from public.clinic_practitioners
             where clinic_id = p_clinic and practitioner_id = p_practitioner);
end;
$$;

create or replace function public.practitioner_create(
    p_clinic    uuid,
    p_name      text,
    p_specialty text[]
)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions, pg_temp
as $$
declare
    v_uid  uuid := auth.uid();
    v_c    public.providers%rowtype;
    v_spec text[];
    v_id   uuid;
begin
    perform public.team_require(p_clinic);

    select * into v_c from public.providers where id = p_clinic;
    if v_c.status <> 'live' then
        raise exception 'clinic_not_live' using errcode = '42501';
    end if;
    if coalesce(length(btrim(p_name)), 0) < 3 or length(p_name) > 160 then
        raise exception 'bad_name' using errcode = '22023';
    end if;
    if (select count(*) from public.clinic_practitioners where clinic_id = p_clinic) >= 100 then
        raise exception 'too_many_practitioners' using errcode = '54000';
    end if;

    select l.practitioner_id into v_id
      from public.clinic_practitioners l
      join public.providers p on p.id = l.practitioner_id
     where l.clinic_id = p_clinic and p.name_norm = public.bh_norm(p_name)
     limit 1;
    if v_id is not null then
        return jsonb_build_object('provider_id', v_id, 'repeat', true);
    end if;

    select coalesce(array_agg(distinct k), '{}') into v_spec
      from unnest(coalesce(p_specialty, '{}')) k
     where k in ('dentist', 'orthodontist', 'plastic_surgery', 'aesthetician', 'obgyn',
                 'physical_therapy', 'massage', 'optometry', 'general', 'pediatrics',
                 'cardiology', 'urgent_care', 'mental_health', 'pharmacy', 'telehealth',
                 'neurology', 'otolaryngology', 'orthopedics');
    if coalesce(array_length(v_spec, 1), 0) = 0 then
        v_spec := coalesce(v_c.specialty[1:1], array['general']);
    end if;
    v_spec := v_spec[1:5];

    insert into public.providers (
        name, specialty, country, city, address, "postalCode", lat, lng,
        phone, languages, source, status, updated_at, updated_by
    ) values (
        btrim(p_name), v_spec, v_c.country, v_c.city, v_c.address, v_c."postalCode",
        v_c.lat, v_c.lng, v_c.phone, coalesce(v_c.languages, '{}'),
        'self', 'live', now(), v_uid
    ) returning id into v_id;

    insert into public.clinic_practitioners (clinic_id, practitioner_id, status, managed, added_by)
    values (p_clinic, v_id, 'active', true, v_uid);

    return jsonb_build_object('provider_id', v_id);
end;
$$;

create or replace function public.practitioner_unlink(p_clinic uuid, p_practitioner uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if not (public.owns_provider(p_clinic) or public.owns_provider(p_practitioner)) then
        raise exception 'not_on_team' using errcode = '42501';
    end if;
    delete from public.clinic_practitioners
     where clinic_id = p_clinic and practitioner_id = p_practitioner;
    update public.provider_invites set revoked_at = now()
     where clinic_id = p_clinic and provider_id = p_practitioner
       and accepted_at is null and revoked_at is null;
end;
$$;

create or replace function public.practitioner_update_link(
    p_clinic       uuid,
    p_practitioner uuid,
    p_accept       boolean default null,
    p_managed      boolean default null
)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
    v_is_doctor boolean := public.owns_provider(p_practitioner);
    v_is_clinic boolean := public.owns_provider(p_clinic);
begin
    if auth.uid() is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if not (v_is_doctor or v_is_clinic) then
        raise exception 'not_on_team' using errcode = '42501';
    end if;
    if p_accept is not null and not v_is_doctor then
        raise exception 'not_on_team' using errcode = '42501';
    end if;
    if p_managed is true and not v_is_doctor then
        raise exception 'not_on_team' using errcode = '42501';
    end if;

    if p_accept is false then
        delete from public.clinic_practitioners
         where clinic_id = p_clinic and practitioner_id = p_practitioner and status = 'pending';
        return;
    end if;

    update public.clinic_practitioners
       set status  = case when p_accept then 'active' else status end,
           managed = coalesce(p_managed, managed)
     where clinic_id = p_clinic and practitioner_id = p_practitioner;
end;
$$;

revoke all on function public.team_overview(uuid) from public, anon;
revoke all on function public.team_invite(uuid, text, text, uuid) from public, anon;
revoke all on function public.team_revoke_invite(uuid) from public, anon;
revoke all on function public.invite_preview(text) from public;
revoke all on function public.invite_accept(text) from public, anon;
revoke all on function public.team_set_role(uuid, uuid, text) from public, anon;
revoke all on function public.team_remove_member(uuid, uuid) from public, anon;
revoke all on function public.practitioner_link(uuid, uuid) from public, anon;
revoke all on function public.practitioner_create(uuid, text, text[]) from public, anon;
revoke all on function public.practitioner_unlink(uuid, uuid) from public, anon;
revoke all on function public.practitioner_update_link(uuid, uuid, boolean, boolean) from public, anon;

grant execute on function public.team_overview(uuid) to authenticated;
grant execute on function public.team_invite(uuid, text, text, uuid) to authenticated;
grant execute on function public.team_revoke_invite(uuid) to authenticated;
grant execute on function public.invite_preview(text) to anon, authenticated;
grant execute on function public.invite_accept(text) to authenticated;
grant execute on function public.team_set_role(uuid, uuid, text) to authenticated;
grant execute on function public.team_remove_member(uuid, uuid) to authenticated;
grant execute on function public.practitioner_link(uuid, uuid) to authenticated;
grant execute on function public.practitioner_create(uuid, text, text[]) to authenticated;
grant execute on function public.practitioner_unlink(uuid, uuid) to authenticated;
grant execute on function public.practitioner_update_link(uuid, uuid, boolean, boolean) to authenticated;
