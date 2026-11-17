-- Doctor identity: one immutable UUID per real doctor.
--
-- Tables only, plus the trigger that keeps name_norm current. Cédulas and every
-- source's own ID point at the UUID; a listing (providers.id, the ID in every
-- URL) points at it too. A doctor is never asked for this UUID: lookups go by
-- cédula or name. The browser cannot read any of these tables.
--
-- Decisions: docs/adr/0003, 0007. UUID, cédula table and source-ID table agreed
-- by Carlos, Nov 2026. organizations, data_sources and source_runs are here
-- because the identity tables point at them.
-- Run in: Supabase dashboard -> SQL editor (or apply_migration). Additive: new
-- tables only. Before applying, check production's schema_migrations and the
-- open PRs for this number.

begin;

-- ── Organizations and sources ────────────────────────────────────────────────
create table public.organizations (
    id                 uuid primary key default gen_random_uuid(),
    slug               text not null unique check (slug ~ '^[a-z0-9-]+$'),
    name               text not null,
    kind               text not null check (kind in ('hospital','consejo','colegio','association','regulator','accreditor')),
    country            text not null default 'MX' check (country in ('MX','US')),
    website            text,
    info_url           text,                 -- what the organization is; shown when a source cannot link to the doctor
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
    doctor_links          boolean not null default true,  -- false: the site has no page or link for one doctor
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
create index doctors_name_trgm_idx on public.doctors using gin (name_norm extensions.gin_trgm_ops);

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

-- ── Lock down (pattern of 0033; new tables need it explicitly) ──────────────
do $$
declare t text;
begin
    foreach t in array array['organizations', 'data_sources', 'source_runs', 'doctors', 'doctor_cedulas', 'doctor_source_ids', 'doctor_listings', 'doctor_merges'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
        execute format('grant all on public.%I to service_role', t);
    end loop;
end $$;

commit;

-- Rollback, only while nothing depends on these tables (undo 0043 onward first):
--
--   Undo one backfill, by its run ID:
--     delete from public.doctor_listings   where run_id = :run;
--     delete from public.doctor_source_ids where first_run_id = :run;
--     delete from public.doctor_cedulas    where run_id = :run;
--     delete from public.doctors           where created_run_id = :run;
--
--   Remove everything:
--     begin;
--     drop table public.doctor_merges, public.doctor_listings, public.doctor_source_ids,
--                public.doctor_cedulas, public.doctors, public.source_runs,
--                public.data_sources, public.organizations;
--     drop function public.sources_name_norm_trg();
--     commit;
