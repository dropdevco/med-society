-- Clinic listings: a clinic is marked as one, its team is safe to run, and it
-- can show its doctors. Builds on 0020b_clinic_teams (production since
-- 10 Oct 2026, unused until now), 0042_doctor_identity and 0047_claim_verification.
--
-- WHAT CHANGES
--
--   1. Team roles mean something. Only an owner may change roles, remove an
--      owner, or invite an owner. Staff (front desk) still do everything else.
--      Before this, owns_provider() ignored role, so staff could promote
--      themselves (0020b team_set_role) and reach Med Society.
--
--   2. Linking a doctor never grants editing. practitioner_link always inserts
--      managed = false. A clinic edits a doctor's listing only when it created
--      that listing (practitioner_create) or the doctor's own owner ticks
--      "let the clinic edit my profile" (practitioner_update_link).
--
--   3. Inviting a doctor to own their listing goes through claim review.
--      invite_accept no longer makes the doctor an owner: it opens an
--      'incomplete' provider_claims row, noting the clinic in its history,
--      and the doctor finishes it at /claim/<id> (ID + cédula/NPI, reviewed by
--      hand, 0047). Invites onto the clinic's own team are unchanged.
--
--   4. providers.kind gains 'clinic'. Backfilled from Doctoralia facility
--      pages, Google listings that are not a doctor, and any clinic that
--      already has linked doctors. Owners and staff can switch it.
--
--   5. clinic_practitioner_suggestions: doctors Doctoralia says practise at a
--      clinic (exact clinic-name match). Shown only to the clinic's team, who
--      add or dismiss them. Nothing public until the clinic confirms.
--
--   6. provider_team(id): the public roster for a clinic page, and the
--      clinics for a doctor page, in one call. No contact fields.
--
--   7. patient_inquiries.practitioner_id: which doctor a patient chose
--      when writing to a clinic.
--
-- Run in: Supabase dashboard -> SQL editor (or apply_migration). Check
-- production's schema_migrations first: 0048 is used twice there.

begin;

-- ── 1. Roles ────────────────────────────────────────────────────────────────

create or replace function public.team_require_owner(p_clinic uuid)
returns void language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if not exists (select 1 from public.provider_owners
                    where provider_id = p_clinic and user_id = auth.uid() and role = 'owner') then
        raise exception 'owner_only' using errcode = '42501';
    end if;
end;
$$;
revoke all on function public.team_require_owner(uuid) from public, anon, authenticated;

create or replace function public.team_set_role(p_clinic uuid, p_user uuid, p_role text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
    perform public.team_require_owner(p_clinic);
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
declare
    v_target_owner boolean;
begin
    perform public.team_require(p_clinic);
    perform pg_advisory_xact_lock(hashtext('team:' || p_clinic::text));
    v_target_owner := exists (select 1 from public.provider_owners
                               where provider_id = p_clinic and user_id = p_user and role = 'owner');
    -- Staff may remove staff, or leave. Removing an owner takes an owner.
    if v_target_owner and p_user <> auth.uid() then
        perform public.team_require_owner(p_clinic);
    end if;
    if v_target_owner
       and (select count(*) from public.provider_owners
             where provider_id = p_clinic and role = 'owner' and user_id <> p_user) = 0 then
        raise exception 'last_owner' using errcode = '23514';
    end if;
    delete from public.provider_owners where provider_id = p_clinic and user_id = p_user;
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
    -- An owner of the clinic itself is invited only by an owner. A doctor
    -- invite (p_provider) is open to staff: it only starts a claim.
    if p_provider is null and v_role = 'owner' then
        perform public.team_require_owner(p_clinic);
    end if;

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
        'kind', case when p_provider is null then 'team' else 'practitioner' end,
        'provider_id', v_target,
        'provider_name', (select name from public.providers where id = v_target),
        'clinic_name', (select name from public.providers where id = p_clinic),
        'country', (select country from public.providers where id = p_clinic),
        'inviter_email', (select email from auth.users where id = v_uid)
    );
end;
$$;

-- ── 2 and 4. Linking and creating doctors; the clinic marker ────────────────

alter table public.providers drop constraint if exists providers_kind_check;
alter table public.providers add constraint providers_kind_check
    check (kind is null or kind in ('stay', 'clinic'));

create or replace function public.practitioner_link(p_clinic uuid, p_practitioner uuid)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
    v_status text;
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

    -- A doctor who runs their own listing says yes first.
    v_status := case when exists (select 1 from public.provider_owners
                                   where provider_id = p_practitioner and role = 'owner')
                     then 'pending' else 'active' end;

    -- Never managed: linking shows the doctor on the roster, nothing more.
    insert into public.clinic_practitioners (clinic_id, practitioner_id, status, managed, added_by)
    values (p_clinic, p_practitioner, v_status, false, auth.uid())
    on conflict (clinic_id, practitioner_id) do nothing;

    delete from public.clinic_practitioner_suggestions
     where clinic_id = p_clinic and practitioner_id = p_practitioner;
    update public.providers set kind = 'clinic' where id = p_clinic and kind is null;

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
    v_uid    uuid := auth.uid();
    v_c      public.providers%rowtype;
    v_spec   text[];
    v_id     uuid;
    v_doctor uuid;
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
                 'neurology', 'otolaryngology', 'orthopedics', 'gastroenterology');
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

    -- A new listing is a new person until review says otherwise (0042).
    insert into public.doctors (display_name) values (btrim(p_name)) returning id into v_doctor;
    insert into public.doctor_listings (provider_id, doctor_id, method) values (v_id, v_doctor, 'new_listing');

    insert into public.clinic_practitioners (clinic_id, practitioner_id, status, managed, added_by)
    values (p_clinic, v_id, 'active', true, v_uid);
    update public.providers set kind = 'clinic' where id = p_clinic and kind is null;

    return jsonb_build_object('provider_id', v_id);
end;
$$;

-- Owners and staff say what their listing is. 'stay' stays an admin decision.
create or replace function public.set_listing_kind(p_id uuid, p_kind text)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
    perform public.team_require(p_id);
    if p_kind is not null and p_kind <> 'clinic' then
        raise exception 'bad_kind' using errcode = '22023';
    end if;
    if (select kind from public.providers where id = p_id) = 'stay' then
        raise exception 'kind_locked' using errcode = '42501';
    end if;
    update public.providers set kind = p_kind, updated_at = now(), updated_by = auth.uid() where id = p_id;
end;
$$;

-- Today no link exists (0 rows on 16 Nov 2026). Anything linked rather than
-- created by the clinic loses editing, to match rule 2.
update public.clinic_practitioners l set managed = false
 where l.managed
   and exists (select 1 from public.providers p where p.id = l.practitioner_id and p.source <> 'self');

-- Backfill. Null keeps meaning "a doctor, or we don't know".
update public.providers p set kind = 'clinic'
  from public.doctoralia_doctors d
 where d.provider_id = p.id and d.entity_type = 'facility' and p.kind is null;

update public.providers p set kind = 'clinic'
 where p.kind is null and p.source = 'google'
   and not exists (select 1 from public.doctor_listings dl where dl.provider_id = p.id)
   and p.name !~* '^\s*(dr|dra|doctor|doctora)\M\.?';

update public.providers p set kind = 'clinic'
 where p.kind is null and exists (select 1 from public.clinic_practitioners l where l.clinic_id = p.id);

-- ── 3. Doctor invites become claims ─────────────────────────────────────────

create or replace function public.invite_accept(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
    v_uid       uuid := auth.uid();
    v_email     text;
    v_confirmed boolean;
    v           public.provider_invites%rowtype;
    v_clinic    text;
    v_claim     uuid;
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
    if v.accepted_at is not null and v.accepted_by is distinct from v_uid then
        raise exception 'invite_used' using errcode = 'P0002';
    end if;
    if v.accepted_at is null and v.expires_at < now() then
        raise exception 'invite_expired' using errcode = 'P0002';
    end if;

    select lower(email), email_confirmed_at is not null
      into v_email, v_confirmed
      from auth.users where id = v_uid;
    if not v_confirmed or v_email is distinct from lower(v.email) then
        raise exception 'email_mismatch' using errcode = '42501';
    end if;

    -- A doctor's own listing: start a claim, grant nothing.
    if v.provider_id <> v.clinic_id then
        if exists (select 1 from public.provider_owners
                    where provider_id = v.provider_id and role = 'owner' and user_id <> v_uid) then
            raise exception 'already_claimed' using errcode = '23505';
        end if;
        if v.accepted_at is null then
            select name into v_clinic from public.providers where id = v.clinic_id;
            insert into public.provider_claims (provider_id, user_id, status, history)
            values (v.provider_id, v_uid, 'incomplete',
                    public._claim_history('[]', 'claimant', 'invited_by_clinic', 'incomplete', left(v_clinic, 160)))
            on conflict (provider_id, user_id) do update
                set history = public._claim_history(provider_claims.history, 'claimant', 'invited_by_clinic',
                                                    provider_claims.status, left(v_clinic, 160))
            returning id into v_claim;
            update public.provider_invites set accepted_at = now(), accepted_by = v_uid where id = v.id;
        end if;
        return jsonb_build_object('status', 'claim', 'provider_id', v.provider_id, 'invite_id', v.id);
    end if;

    if v.accepted_at is null then
        insert into public.provider_owners (provider_id, user_id, role)
        values (v.provider_id, v_uid, v.role)
        on conflict (provider_id, user_id) do update
            set role = case when excluded.role = 'owner' then 'owner' else provider_owners.role end;
        update public.provider_invites set accepted_at = now(), accepted_by = v_uid where id = v.id;
    end if;

    return jsonb_build_object('status', 'accepted', 'provider_id', v.provider_id);
end;
$$;

-- ── 5. Suggestions ──────────────────────────────────────────────────────────

create table if not exists public.clinic_practitioner_suggestions (
    clinic_id       uuid not null references public.providers (id) on delete cascade,
    practitioner_id uuid not null references public.providers (id) on delete cascade,
    source          text not null check (source in ('doctoralia')),
    evidence        jsonb not null default '{}',
    status          text not null default 'open' check (status in ('open', 'dismissed')),
    created_at      timestamptz not null default now(),
    decided_by      uuid references auth.users (id) on delete set null,
    decided_at      timestamptz,
    primary key (clinic_id, practitioner_id),
    check (clinic_id <> practitioner_id)
);
alter table public.clinic_practitioner_suggestions enable row level security;
revoke all on public.clinic_practitioner_suggestions from anon, authenticated;
grant all on public.clinic_practitioner_suggestions to service_role;

-- Doctoralia doctor pages name the clinic at each address. Exact match on
-- the facility's own Doctoralia name only; fuzzy matching would put wrong
-- doctors in front of a clinic.
insert into public.clinic_practitioner_suggestions (clinic_id, practitioner_id, source, evidence)
select distinct on (f.provider_id, d.provider_id)
       f.provider_id, d.provider_id, 'doctoralia',
       jsonb_build_object('clinic_name', a.clinic_name, 'street', a.street, 'city', a.city)
  from public.doctoralia_addresses a
  join public.doctoralia_doctors d on d.doctoralia_id = a.doctoralia_id
                                  and d.entity_type = 'doctor' and d.provider_id is not null
  join public.doctoralia_doctors f on f.entity_type = 'facility' and f.provider_id is not null
                                  and lower(btrim(f.name)) = lower(btrim(a.clinic_name))
  join public.providers pc on pc.id = f.provider_id and pc.status = 'live'
  join public.providers pd on pd.id = d.provider_id and pd.status = 'live'
 where a.clinic_name is not null and f.provider_id <> d.provider_id
   and not exists (select 1 from public.clinic_practitioners l
                    where l.clinic_id = f.provider_id and l.practitioner_id = d.provider_id)
on conflict (clinic_id, practitioner_id) do nothing;

create or replace function public.practitioner_suggestion_dismiss(p_clinic uuid, p_practitioner uuid)
returns void language plpgsql volatile security definer set search_path = public, pg_temp
as $$
begin
    perform public.team_require(p_clinic);
    update public.clinic_practitioner_suggestions
       set status = 'dismissed', decided_by = auth.uid(), decided_at = now()
     where clinic_id = p_clinic and practitioner_id = p_practitioner;
end;
$$;

create or replace function public.team_overview(p_clinic uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
begin
    perform public.team_require(p_clinic);

    return jsonb_build_object(
        'my_role', (select role from public.provider_owners where provider_id = p_clinic and user_id = v_uid),
        'kind', (select kind from public.providers where id = p_clinic),
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
        'suggestions', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', p.id, 'name', p.name, 'specialty', p.specialty,
                       'imageUrl', p."imageUrl", 'city', p.city,
                       'source', s.source, 'evidence', s.evidence,
                       'claimed', exists (select 1 from public.provider_owners o
                                          where o.provider_id = p.id and o.role = 'owner'))
                   order by p.name)
            from public.clinic_practitioner_suggestions s
            join public.providers p on p.id = s.practitioner_id and p.status = 'live'
            where s.clinic_id = p_clinic and s.status = 'open'
              and not exists (select 1 from public.clinic_practitioners l
                               where l.clinic_id = s.clinic_id and l.practitioner_id = s.practitioner_id)), '[]'::jsonb),
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

-- ── 6. Public roster ────────────────────────────────────────────────────────
-- Same columns provider_list already shows anyone, for live listings joined
-- by an active link. Never contact fields.
create or replace function public.provider_team(p_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'practitioners', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', p.id, 'name', p.name, 'specialty', p.specialty, 'imageUrl', p."imageUrl",
                       'city', p.city, 'rating', p.rating, 'reviewCount', p."reviewCount",
                       'badges', p.badges, 'serviceNames', p.service_names)
                   order by l.sort, p.name)
              from public.clinic_practitioners l
              join public.providers p on p.id = l.practitioner_id and p.status = 'live'
             where l.clinic_id = p_id and l.status = 'active'), '[]'::jsonb),
        'clinics', coalesce((
            select jsonb_agg(jsonb_build_object(
                       'id', c.id, 'name', c.name, 'city', c.city, 'imageUrl', c."imageUrl",
                       'specialty', c.specialty, 'rating', c.rating, 'reviewCount', c."reviewCount")
                   order by c.name)
              from public.clinic_practitioners l
              join public.providers c on c.id = l.clinic_id and c.status = 'live'
             where l.practitioner_id = p_id and l.status = 'active'), '[]'::jsonb)
    )
    where exists (select 1 from public.providers where id = p_id and status = 'live');
$$;

-- ── 7. Which doctor an enquiry is for ───────────────────────────────────────
alter table public.patient_inquiries add column if not exists practitioner_id uuid;  -- no FK, like provider_id

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.set_listing_kind(uuid, text) from public, anon;
revoke all on function public.practitioner_suggestion_dismiss(uuid, uuid) from public, anon;
revoke all on function public.provider_team(uuid) from public;
grant execute on function public.set_listing_kind(uuid, text) to authenticated;
grant execute on function public.practitioner_suggestion_dismiss(uuid, uuid) to authenticated;
grant execute on function public.provider_team(uuid) to anon, authenticated;

commit;

-- Rollback (by hand):
-- update public.providers set kind = null where kind = 'clinic';
-- alter table public.providers drop constraint providers_kind_check;
-- alter table public.providers add constraint providers_kind_check check (kind is null or kind = 'stay');
-- drop function public.provider_team(uuid);
-- drop function public.set_listing_kind(uuid, text);
-- drop function public.practitioner_suggestion_dismiss(uuid, uuid);
-- drop table public.clinic_practitioner_suggestions;
-- alter table public.patient_inquiries drop column practitioner_id;
-- then re-run the 0020b definitions of team_set_role, team_remove_member,
-- team_invite, practitioner_link, practitioner_create, invite_accept, team_overview.
