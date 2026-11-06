-- Doctor identity, organization sources and badges.
--
-- One immutable UUID per real doctor. Cédulas and every source's own ID point
-- at it; a listing (providers.id, the ID in every URL) points at it too. A
-- doctor is never asked for this UUID: lookups go by cédula or name.
--
-- Pipeline tables are written by the service role (scripts/sources) and the
-- admin_* functions below; the browser never reads them. The site reads badges
-- from providers.badges, a cache rebuilt after every run and every review.
--
-- Decisions: docs/adr/0003, 0004, 0007. Reviewed by Carlos, Nov 2026.
-- Run in: Supabase dashboard -> SQL editor (or apply_migration). Additive:
-- new tables, one new column on providers, provider_list re-created.

begin;

-- ── Organizations and sources ────────────────────────────────────────────────
create table public.organizations (
    id                 uuid primary key default gen_random_uuid(),
    slug               text not null unique check (slug ~ '^[a-z0-9-]+$'),
    name               text not null,
    kind               text not null check (kind in ('hospital','consejo','colegio','association','regulator','accreditor')),
    country            text not null default 'MX' check (country in ('MX','US')),
    website            text,
    logo_url           text,
    logo_permission_at timestamptz,          -- the logo shows publicly only when set
    provider_id        uuid references public.providers (id) on delete set null,
    created_at         timestamptz not null default now()
);

create table public.data_sources (
    slug                  text primary key,  -- same slug as scripts/sources/adapters
    organization_id       uuid references public.organizations (id),  -- null: not a badge source (Doctoralia)
    name                  text not null,
    access                text not null check (access in ('open','permission','manual','export')),
    permission_granted_on date,
    permission_scope      text,
    permission_ref        text,              -- where the signed letter is kept; never the letter
    cadence               text not null default 'weekly',
    created_at            timestamptz not null default now()
);

-- ── Runs, entries, observations ──────────────────────────────────────────────
create table public.source_runs (
    id          uuid primary key,            -- UUIDv7 from the pipeline (no default on purpose)
    source_slug text not null references public.data_sources (slug),
    started_at  timestamptz not null,
    finished_at timestamptz,
    status      text not null check (status in ('green','red')),
    reasons     text[] not null default '{}',
    counts      jsonb not null default '{}',
    targets     jsonb not null default '[]'
);
create index source_runs_source_started_idx on public.source_runs (source_slug, started_at desc);

create table public.source_entries (
    id                uuid primary key default gen_random_uuid(),
    source_slug       text not null references public.data_sources (slug),
    external_id       text not null,         -- the source's own key
    name              text not null,
    name_norm         text,                  -- bh_norm(name), by trigger
    label             text not null default '',  -- what the badge says: hospital site, or certified specialty
    specialties       text[] not null default '{}',
    cedulas           text[] not null default '{}',
    region            text,
    url               text,
    valid_from        date,
    valid_to          date,
    facts             jsonb not null default '{}',  -- e.g. consejo, certificate number
    first_seen_run_id uuid not null references public.source_runs (id),
    last_seen_run_id  uuid not null references public.source_runs (id),
    missed_runs       integer not null default 0,   -- consecutive green runs without it (ADR 0004: 2 = lapse)
    unique (source_slug, external_id)
);
create index source_entries_cedulas_idx on public.source_entries using gin (cedulas);

-- One row per entry per run. Partition by month once it passes a few million rows.
create table public.source_observations (
    run_id      uuid not null references public.source_runs (id) on delete cascade,
    entry_id    uuid not null references public.source_entries (id) on delete cascade,
    observed_at timestamptz not null,
    payload     jsonb not null,
    primary key (run_id, entry_id)
);
create index source_observations_entry_idx on public.source_observations (entry_id, observed_at desc);

-- ── Doctors ──────────────────────────────────────────────────────────────────
create table public.doctors (
    id             uuid primary key default gen_random_uuid(),  -- immutable; internal; never asked of a doctor
    display_name   text not null,
    given_names    text,
    surname1       text,
    surname2       text,
    name_norm      text,                 -- bh_norm(display_name), by trigger
    name_key       text,                 -- blocking key, NOT unique, never shown
    status         text not null default 'active' check (status in ('active','merged')),
    merged_into    uuid references public.doctors (id),
    created_run_id uuid references public.source_runs (id),
    created_at     timestamptz not null default now(),
    check ((status = 'merged') = (merged_into is not null))
);
create index doctors_name_key_idx  on public.doctors (name_key) where status = 'active';
create index doctors_name_trgm_idx on public.doctors using gin (name_norm gin_trgm_ops);

create table public.doctor_cedulas (
    cedula       text primary key check (cedula ~ '^[0-9]{6,9}$'),  -- one doctor per cédula
    doctor_id    uuid not null references public.doctors (id),
    kind         text not null default 'unknown' check (kind in ('licenciatura','especialidad','unknown')),
    title        text,
    first_source text not null,
    verified_by  text check (verified_by in ('sep_constancia','sep_lookup','source_published')),
    verified_on  date,
    run_id       uuid references public.source_runs (id),
    created_at   timestamptz not null default now()
);
create index doctor_cedulas_doctor_idx on public.doctor_cedulas (doctor_id);
create unique index doctor_cedulas_one_base on public.doctor_cedulas (doctor_id) where kind = 'licenciatura';

-- Every source's own ID for a doctor, and the match decision. One decision per
-- source record: later runs reuse it and only move last_run_id.
create table public.doctor_source_ids (
    source_slug  text not null references public.data_sources (slug),
    external_id  text not null,
    doctor_id    uuid references public.doctors (id),
    status       text not null check (status in ('confirmed','probable','rejected','unmatched')),
    tier         smallint check (tier between 1 and 4),
    confidence   real,
    candidates   jsonb not null default '[]',
    first_run_id uuid references public.source_runs (id),
    last_run_id  uuid references public.source_runs (id),
    decided_by   uuid references auth.users (id),
    decided_at   timestamptz,
    primary key (source_slug, external_id),
    check (status not in ('confirmed','probable') or doctor_id is not null)
);
create index doctor_source_ids_doctor_idx on public.doctor_source_ids (doctor_id);
create index doctor_source_ids_review_idx on public.doctor_source_ids (source_slug, confidence desc) where status = 'probable';

-- Which listings are this doctor. Clinic listings reach doctors through clinic_practitioners.
create table public.doctor_listings (
    provider_id uuid primary key references public.providers (id) on delete cascade,
    doctor_id   uuid not null references public.doctors (id),
    method      text not null check (method in ('doctoralia_link','cedula','review','claim','new_listing')),
    run_id      uuid references public.source_runs (id),
    created_at  timestamptz not null default now()
);
create index doctor_listings_doctor_idx on public.doctor_listings (doctor_id);

create table public.doctor_merges (
    id          bigint generated always as identity primary key,
    from_doctor uuid not null references public.doctors (id),
    into_doctor uuid not null references public.doctors (id),
    moved       jsonb not null,              -- what moved, so a merge can be undone
    reason      text not null,
    decided_by  uuid references auth.users (id),
    decided_at  timestamptz not null default now(),
    undone_at   timestamptz,
    check (from_doctor <> into_doctor)
);

-- What each source says about a credential, side by side (sources can disagree).
create table public.doctor_credential_status (
    doctor_id   uuid not null references public.doctors (id),
    credential  text not null,
    source_slug text not null references public.data_sources (slug),
    status      text not null check (status in ('vigente','vencida','unknown')),
    valid_to    date,
    observed_at timestamptz not null,
    run_id      uuid references public.source_runs (id),
    primary key (doctor_id, credential, source_slug)
);

-- A badge: doctor × organization × label ("Hospital Angeles Tijuana", or a certified specialty).
create table public.doctor_affiliations (
    doctor_id             uuid not null references public.doctors (id),
    organization_id       uuid not null references public.organizations (id),
    label                 text not null default '',
    status                text not null check (status in ('confirmed','lapsed')),
    source_slug           text not null references public.data_sources (slug),
    evidence_entry_id     uuid references public.source_entries (id) on delete set null,
    created_run_id        uuid not null references public.source_runs (id),
    last_confirmed_run_id uuid not null references public.source_runs (id),
    last_confirmed_at     timestamptz not null,
    valid_from            date,
    valid_to              date,
    facts                 jsonb not null default '{}',
    url                   text,
    primary key (doctor_id, organization_id, label)
);

-- ── Name normalisation with the onboarding matcher's function (0005) ─────────
create function public.sources_name_norm_trg() returns trigger
language plpgsql set search_path = public as $$
begin
    if tg_table_name = 'doctors' then new.name_norm := public.bh_norm(new.display_name);
    else new.name_norm := public.bh_norm(new.name);
    end if;
    return new;
end $$;
create trigger doctors_name_norm before insert or update of display_name on public.doctors
    for each row execute function public.sources_name_norm_trg();
create trigger source_entries_name_norm before insert or update of name on public.source_entries
    for each row execute function public.sources_name_norm_trg();

-- ── The badges cache the site reads ─────────────────────────────────────────
alter table public.providers add column badges jsonb not null default '[]';  -- metadata-only, no rewrite
grant select (badges) on public.providers to anon, authenticated;  -- 0032 grants anon per column

-- provider_list as defined in production on 5 Nov 2026, plus badges.
create or replace view public.provider_list with (security_invoker = true) as
select id, name, specialty, country, city, region, address, lat, lng, "postalCode", rating, "reviewCount",
       promoted, tier, verified, licensed, "featuredRank", "priceFromMxn", insurances, languages,
       languages_confirmed, source, "imageUrl", "googlePlaceId",
       coalesce((select array_agg(distinct v.n) filter (where v.n is not null and v.n <> ''::text)
                 from jsonb_array_elements(p.services) s(value),
                      lateral (values (s.value ->> 'name'::text), (s.value ->> 'nameEn'::text)) v(n)), '{}'::text[]) as service_names,
       badges
from public.providers p
where status = 'live'::text;

-- Rebuild badges for the listings of the given doctors. Expired certifications
-- drop out on their own; a logo shows only once its permission is recorded.
create function public.refresh_provider_badges(p_doctors uuid[])
returns integer language sql security definer set search_path = public as $$
    with targets as (
        select distinct provider_id from public.doctor_listings where doctor_id = any (p_doctors)
    ), computed as (
        select t.provider_id,
               coalesce(jsonb_agg(jsonb_build_object(
                   'org',          o.slug,
                   'name',         o.name,
                   'kind',         o.kind,
                   'label',        a.label,
                   'logo',         case when o.logo_permission_at is not null then o.logo_url end,
                   'url',          coalesce(a.url, o.website),
                   'confirmed_at', a.last_confirmed_at,
                   'valid_from',   a.valid_from,
                   'valid_to',     a.valid_to,
                   'facts',        a.facts
               ) order by case o.kind when 'hospital' then 0 when 'consejo' then 1 when 'colegio' then 2 else 3 end, o.name, a.label)
               filter (where o.id is not null), '[]'::jsonb) as badges
        from targets t
        join public.doctor_listings l on l.provider_id = t.provider_id
        left join public.doctor_affiliations a on a.doctor_id = l.doctor_id and a.status = 'confirmed'
             and (a.valid_to is null or a.valid_to >= current_date)
        left join public.organizations o on o.id = a.organization_id
        group by t.provider_id
    ), updated as (
        update public.providers p set badges = c.badges
        from computed c
        where p.id = c.provider_id and p.badges is distinct from c.badges
        returning 1
    )
    select count(*)::integer from updated;
$$;

-- Candidate doctors for a name, for the pipeline's matcher. Blocking key first,
-- trigram index for the rest; never a full scan.
create function public.doctor_name_candidates(p_name text, p_name_key text, p_limit integer default 5)
returns table (doctor_id uuid, display_name text, similarity real, regions text[], listings uuid[], specialties text[])
language sql stable security definer set search_path = public as $$
    with n as (select public.bh_norm(p_name) as norm)
    select d.id, d.display_name, similarity(d.name_norm, n.norm),
           coalesce(array_agg(distinct p.region) filter (where p.region is not null), '{}'),
           coalesce(array_agg(distinct l.provider_id) filter (where l.provider_id is not null), '{}'),
           coalesce((select array_agg(distinct s) from public.doctor_listings l2
                     join public.providers p2 on p2.id = l2.provider_id, unnest(p2.specialty) s
                     where l2.doctor_id = d.id), '{}')
    from public.doctors d cross join n
    left join public.doctor_listings l on l.doctor_id = d.id
    left join public.providers p on p.id = l.provider_id
    where d.status = 'active'
      and (d.name_key = p_name_key or d.name_norm % n.norm)
      and similarity(d.name_norm, n.norm) >= 0.6
    group by d.id, d.display_name, d.name_norm, n.norm
    order by 3 desc
    limit p_limit;
$$;

-- After a green run: renew or create badges for every confirmed match the run
-- saw, lapse those missing for two green runs (not for lookup sources), and
-- rebuild the cache for every doctor touched.
create function public.sync_source_badges(p_source text, p_run uuid, p_lapse boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_org uuid;
    v_when timestamptz;
    v_touched uuid[];
    v_lapsed integer := 0;
    v_renewed integer := 0;
begin
    select organization_id into v_org from public.data_sources where slug = p_source;
    select started_at into v_when from public.source_runs where id = p_run;
    if v_org is null or v_when is null then
        raise exception 'unknown source or run: %, %', p_source, p_run;
    end if;

    with up as (
        insert into public.doctor_affiliations as a
            (doctor_id, organization_id, label, status, source_slug, evidence_entry_id,
             created_run_id, last_confirmed_run_id, last_confirmed_at, valid_from, valid_to, facts, url)
        select m.doctor_id, v_org, e.label, 'confirmed', p_source, e.id, p_run, p_run, v_when,
               e.valid_from, e.valid_to, e.facts, e.url
        from public.doctor_source_ids m
        join public.source_entries e on e.source_slug = m.source_slug and e.external_id = m.external_id
        where m.source_slug = p_source and m.status = 'confirmed' and e.last_seen_run_id = p_run
        on conflict (doctor_id, organization_id, label) do update
            set status = 'confirmed', evidence_entry_id = excluded.evidence_entry_id,
                last_confirmed_run_id = excluded.last_confirmed_run_id, last_confirmed_at = excluded.last_confirmed_at,
                valid_from = excluded.valid_from, valid_to = excluded.valid_to, facts = excluded.facts, url = excluded.url
        returning a.doctor_id
    )
    select array_agg(distinct doctor_id), count(*) into v_touched, v_renewed from up;

    if p_lapse then
        with gone as (
            update public.doctor_affiliations a set status = 'lapsed'
            from public.source_entries e
            where a.evidence_entry_id = e.id and a.source_slug = p_source
              and a.status = 'confirmed' and e.missed_runs >= 2
            returning a.doctor_id
        )
        select coalesce(v_touched, '{}') || coalesce(array_agg(distinct doctor_id), '{}'), count(*)
        into v_touched, v_lapsed from gone;
    end if;

    perform public.refresh_provider_badges(coalesce(v_touched, '{}'));
    return jsonb_build_object('renewed', v_renewed, 'lapsed', v_lapsed);
end $$;

-- ── Review queue, for /admin ─────────────────────────────────────────────────
create function public.admin_sources_overview()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
    perform public._admin_guard();
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'slug', s.slug, 'name', s.name, 'access', s.access, 'permission_granted_on', s.permission_granted_on,
            'last_run', (select jsonb_build_object('id', r.id, 'started_at', r.started_at, 'status', r.status, 'reasons', r.reasons, 'counts', r.counts)
                         from public.source_runs r where r.source_slug = s.slug order by r.started_at desc limit 1),
            'matches', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                        from (select status, count(*) n from public.doctor_source_ids m where m.source_slug = s.slug group by 1) x),
            'badges', (select count(*) from public.doctor_affiliations a where a.source_slug = s.slug and a.status = 'confirmed')
        ) order by s.slug)
        from public.data_sources s where s.organization_id is not null), '[]'::jsonb);
end $$;

create function public.admin_match_queue(p_source text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
    perform public._admin_guard();
    return jsonb_build_object(
        'total', (select count(*) from public.doctor_source_ids m
                  where m.status = 'probable' and (p_source is null or m.source_slug = p_source)),
        'exact', (select count(*) from public.doctor_source_ids m
                  where m.status = 'probable' and m.confidence >= 0.99 and (p_source is null or m.source_slug = p_source)),
        'items', coalesce((
            select jsonb_agg(row_to_json(q)) from (
                select m.source_slug, m.external_id, m.tier, m.confidence, m.candidates,
                       e.name, e.label, e.specialties, e.cedulas, e.region, e.url, e.valid_to, e.facts
                from public.doctor_source_ids m
                join public.source_entries e on e.source_slug = m.source_slug and e.external_id = m.external_id
                where m.status = 'probable' and (p_source is null or m.source_slug = p_source)
                order by m.confidence desc, e.name
                limit least(p_limit, 200) offset p_offset
            ) q), '[]'::jsonb));
end $$;

-- Confirm or reject one match. Confirming records the reviewer, keeps any
-- cédulas the source showed, links the doctor's badges and rebuilds the cache.
create function public._decide_match(p_source text, p_external text, p_decision text, p_doctor uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
    v_doctor uuid;
    v_org uuid;
    v_entry public.source_entries;
begin
    if p_decision not in ('confirm','reject') then
        raise exception 'decision must be confirm or reject';
    end if;
    select coalesce(p_doctor, m.doctor_id) into v_doctor from public.doctor_source_ids m
    where m.source_slug = p_source and m.external_id = p_external;
    if not found then raise exception 'no such match'; end if;

    update public.doctor_source_ids
       set status = case p_decision when 'confirm' then 'confirmed' else 'rejected' end,
           doctor_id = case p_decision when 'confirm' then v_doctor else doctor_id end,
           decided_by = auth.uid(), decided_at = now()
     where source_slug = p_source and external_id = p_external;
    if p_decision = 'reject' then return; end if;

    select * into v_entry from public.source_entries where source_slug = p_source and external_id = p_external;
    select organization_id into v_org from public.data_sources where slug = p_source;

    insert into public.doctor_cedulas (cedula, doctor_id, first_source, verified_by, run_id)
    select c, v_doctor, p_source, 'source_published', v_entry.last_seen_run_id
    from unnest(v_entry.cedulas) c
    on conflict (cedula) do nothing;

    insert into public.doctor_affiliations as a
        (doctor_id, organization_id, label, status, source_slug, evidence_entry_id,
         created_run_id, last_confirmed_run_id, last_confirmed_at, valid_from, valid_to, facts, url)
    select v_doctor, v_org, v_entry.label, 'confirmed', p_source, v_entry.id,
           v_entry.last_seen_run_id, v_entry.last_seen_run_id, r.started_at,
           v_entry.valid_from, v_entry.valid_to, v_entry.facts, v_entry.url
    from public.source_runs r where r.id = v_entry.last_seen_run_id
    on conflict (doctor_id, organization_id, label) do update
        set status = 'confirmed', last_confirmed_run_id = excluded.last_confirmed_run_id,
            last_confirmed_at = excluded.last_confirmed_at, valid_to = excluded.valid_to;

    perform public.refresh_provider_badges(array[v_doctor]);
end $$;

create function public.admin_match_decide(p_source text, p_external text, p_decision text, p_doctor uuid default null)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
    perform public._admin_guard();
    perform public._decide_match(p_source, p_external, p_decision, p_doctor);
end $$;

-- A reviewer's single decision over every exact-name match of one source.
create function public.admin_match_confirm_exact(p_source text)
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
    r record;
    n integer := 0;
begin
    perform public._admin_guard();
    for r in select external_id from public.doctor_source_ids
             where source_slug = p_source and status = 'probable' and confidence >= 0.99 loop
        perform public._decide_match(p_source, r.external_id, 'confirm', null);
        n := n + 1;
    end loop;
    return n;
end $$;

-- Onboarding: a signed-in doctor types a cédula; the answer is only the listing(s)
-- to claim. No names, no other cédulas, no doctor ID.
create function public.listings_for_cedula(p_cedula text)
returns table (provider_id uuid)
language sql stable security definer set search_path = public as $$
    select l.provider_id
    from public.doctor_cedulas c
    join public.doctors d on d.id = c.doctor_id and d.status = 'active'
    join public.doctor_listings l on l.doctor_id = d.id
    where c.cedula = regexp_replace(p_cedula, '\D', '', 'g')
      and auth.uid() is not null;
$$;

-- ── Lock down (pattern of 0033) ──────────────────────────────────────────────
do $$
declare t text;
begin
    foreach t in array array['organizations','data_sources','source_runs','source_entries','source_observations',
                             'doctors','doctor_cedulas','doctor_source_ids','doctor_listings','doctor_merges',
                             'doctor_credential_status','doctor_affiliations'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
        execute format('grant all on public.%I to service_role', t);
    end loop;
end $$;

revoke all on function public.refresh_provider_badges(uuid[]) from public, anon, authenticated;
revoke all on function public.doctor_name_candidates(text, text, integer) from public, anon, authenticated;
revoke all on function public.sync_source_badges(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public._decide_match(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.refresh_provider_badges(uuid[]) to service_role;
grant execute on function public.doctor_name_candidates(text, text, integer) to service_role;
grant execute on function public.sync_source_badges(text, uuid, boolean) to service_role;

revoke all on function public.admin_sources_overview() from public, anon;
revoke all on function public.admin_match_queue(text, integer, integer) from public, anon;
revoke all on function public.admin_match_decide(text, text, text, uuid) from public, anon;
revoke all on function public.admin_match_confirm_exact(text) from public, anon;
grant execute on function public.admin_sources_overview() to authenticated;
grant execute on function public.admin_match_queue(text, integer, integer) to authenticated;
grant execute on function public.admin_match_decide(text, text, text, uuid) to authenticated;
grant execute on function public.admin_match_confirm_exact(text) to authenticated;

revoke all on function public.listings_for_cedula(text) from public, anon;
grant execute on function public.listings_for_cedula(text) to authenticated;

-- ── Seed: the organizations and sources with permission ──────────────────────
insert into public.organizations (slug, name, kind, website) values
    ('hospital-angeles', 'Hospital Ángeles', 'hospital', 'https://hospitalangeles.com'),
    ('starmedica', 'Star Médica', 'hospital', 'https://www.starmedica.com'),
    ('conacem', 'CONACEM', 'consejo', 'https://conacem.org.mx');

insert into public.data_sources (slug, organization_id, name, access, permission_granted_on, permission_scope, permission_ref)
select o.slug, o.id, x.name, 'permission', x.granted, x.scope, 'Signed letter in the team vault'
from public.organizations o
join (values
    ('hospital-angeles', 'Hospital Ángeles doctor directory', date '2026-10-30', 'Scrape, store and display, on condition it is kept up to date'),
    ('starmedica', 'Star Médica doctor directory', date '2026-11-04', 'Scrape, store and display'),
    ('conacem', 'CONACEM certified specialists', date '2026-11-04', 'Display, obtained by whatever means works')
) as x (slug, name, granted, scope) on x.slug = o.slug;

insert into public.data_sources (slug, name, access) values ('doctoralia', 'Doctoralia import (identity backfill only)', 'manual');

commit;
