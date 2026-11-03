# Phase 2 proposal: database tables for organization badges

Status: **DRAFT for review. Not applied. Do not run.** · Author: Emilio (with Claude) · 3 Nov 2026
Branch: `feat/hospital-angeles-directory` · Decisions: [ADR 0003](../adr/0003-affiliation-data-model.md), [0004](../adr/0004-matching-and-freshness.md), [0007](../adr/0007-people-and-person-badges.md) · Roadmap: [verification-and-badges.md](verification-and-badges.md)

## Summary

Hospital Ángeles gave written permission (30 Oct) to read, store and display its doctor directory if we keep it current. The pipeline that reads it is built and tested on the branch (no database writes yet). This document proposes the tables it needs so a doctor's badges can show on medsociety.one: **one new set of pipeline-owned tables, one new column on `providers`, and a re-created `provider_list` view.** Nothing in billing, auth, forums, leads or contact data changes. Emilio applies it only after Carlos approves the design and the migration number.

## What already exists on the branch

| Piece | State |
|---|---|
| `scripts/sources/` pipeline, Hospital Ángeles adapter | Built. Live runs: 151 Tijuana + 243 Ciudad Juárez = 394 doctors, green, locally and in Docker |
| Run IDs | Every run has a UUIDv7 `run_id`; every record carries it plus `observedAt` |
| Weekly timer + local health dashboard | Built (`docker compose up -d scheduler dashboard`, `http://localhost:5180`). Not left running |
| Database writes (`--commit`) | **Not built.** Waits for this proposal |
| ADRs 0001–0007, sources register, roadmap | Written, status Proposed |

## What was checked in production (3 Nov 2026, read-only)

| Fact | Value |
|---|---|
| Postgres | 17.6 (no built-in `uuidv7()`, so the pipeline generates run IDs) |
| Extensions | `pg_trgm 1.6`, `unaccent 1.1`, `pgcrypto 1.3`, `uuid-ossp 1.1`, `vector 0.8.0` |
| Last migration | `20261019220646 admin_answers_long` (repo file `0034_admin_answers_long.sql`), so the next free number is **0035** |
| Live listings | 12,613 |
| `clinic_practitioners` | Exists (`clinic_id, practitioner_id, status, managed, sort, added_by, created_at`), **0 rows** |
| `doctoralia_doctors` | Has `name, cedulas text[], provider_id, match_method, review_status`; of the first 1,000 rows linked to a listing, 691 carry cédulas |
| `providers` columns used | `id uuid, name, name_norm, city, city_norm, region, specialty text[], status, source, verified, licensed, "doctoraliaId", "googlePlaceId"` |
| Functions used | `bh_norm(t text) → text` (STABLE), `_admin_guard`, `is_app_admin`, `provider_public`, `my_providers` exist |
| `provider_public()` | Returns `to_jsonb(p) - 'updated_by' - 'phone_norm' - 'name_norm' - 'city_norm'`, so a new `badges` column flows through unchanged |
| `provider_list` columns | `id, name, specialty, country, city, region, address, lat, lng, postalCode, rating, reviewCount, promoted, tier, verified, licensed, featuredRank, priceFromMxn, insurances, languages, languages_confirmed, source, imageUrl, googlePlaceId, service_names` |
| Triggers on `providers` | `providers_norm`, `languages_confirmed_on_change`, `providers_notify_new_listing` (see question 3) |
| Name collisions | None of the proposed table names exist |

## The model in one paragraph

Badges belong to **people**, not listings, because a listing can be a clinic and duplicates exist ([ADR 0007](../adr/0007-people-and-person-badges.md)). Each weekly **run** (`source_runs`, UUIDv7) records an **observation** of every **source entry** it sees (e.g. Hospital Ángeles slug `ana-prueba-uno`). Each entry is **matched to a person once** (`entry_matches`): a cédula match confirms, a name match waits for review. A person has **identifiers** (cédulas, Doctoralia ID) and **affiliations** (person × organization). A doctor's **listing** links to its person (`provider_people`). After each run the pipeline rebuilds a small **badges cache** on the person's listings (`providers.badges`), which `provider_list` and `provider_public` expose to the site.

## Draft SQL

Proposed file name: `supabase/migrations/0035_sources_people_affiliations.sql` (number to confirm). Written in the style of 0026/0032/0033.

```sql
-- Sources, people and affiliations for organization badges (docs/adr/0003, 0004, 0007).
-- Pipeline-owned tables: written only by the service role (scripts/sources) and
-- admin_* functions; never readable by anon directly. The site reads badges
-- through providers.badges (a cache) via provider_list and provider_public.
-- Run in: Supabase dashboard -> SQL editor (or apply_migration), in one transaction.

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
    logo_permission_at timestamptz,          -- logo shows publicly only when set (plan task J4)
    provider_id        uuid references public.providers (id) on delete set null,  -- when the org is itself a listing
    created_at         timestamptz not null default now()
);

create table public.data_sources (
    slug                  text primary key,  -- same slug as scripts/sources/adapters
    organization_id       uuid not null references public.organizations (id),
    name                  text not null,
    access                text not null check (access in ('open','permission','manual','export')),
    permission_granted_on date,
    permission_scope      text,
    permission_ref        text,              -- where the signed letter is kept; never the letter itself
    cadence               text not null default 'weekly',
    created_at            timestamptz not null default now()
);

-- ── Runs, entries, observations ──────────────────────────────────────────────
create table public.source_runs (
    id          uuid primary key,            -- UUIDv7 generated by the pipeline (no default on purpose)
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
    external_id       text not null,         -- the source's own key (slug, register number)
    name              text not null,
    name_norm         text,                  -- bh_norm(name), kept by trigger below
    specialties       text[] not null default '{}',
    cedulas           text[] not null default '{}',
    region            text,
    url               text,
    first_seen_run_id uuid not null references public.source_runs (id),
    last_seen_run_id  uuid not null references public.source_runs (id),
    missed_runs       integer not null default 0,   -- consecutive green runs without it (ADR 0004: 2 = lapse)
    unique (source_slug, external_id)
);
create index source_entries_cedulas_idx on public.source_entries using gin (cedulas);
create index source_entries_name_trgm_idx on public.source_entries using gin (name_norm gin_trgm_ops);

-- One row per entry per run: "was this doctor listed on that date, and what did the source say".
-- About 394 rows a week for Hospital Ángeles. Partition by month once it passes a few million rows.
create table public.source_observations (
    run_id      uuid not null references public.source_runs (id) on delete cascade,
    entry_id    uuid not null references public.source_entries (id) on delete cascade,
    observed_at timestamptz not null,
    payload     jsonb not null,              -- the entry as published that day
    primary key (run_id, entry_id)
);
create index source_observations_entry_idx on public.source_observations (entry_id, observed_at desc);

-- ── People ───────────────────────────────────────────────────────────────────
create table public.people (
    id                uuid primary key default gen_random_uuid(),   -- our own ID; never from a source
    display_name      text not null,
    name_norm         text,
    created_run_id    uuid references public.source_runs (id),
    created_at        timestamptz not null default now()
);
create index people_name_trgm_idx on public.people using gin (name_norm gin_trgm_ops);

-- One identifier belongs to one person: a cédula can never be on two people. No CURP, ever.
create table public.person_identifiers (
    kind        text not null check (kind in ('cedula_profesional','cedula_especialidad','doctoralia_id','consejo_certificate','us_state_license')),
    value       text not null,
    person_id   uuid not null references public.people (id) on delete cascade,
    source_slug text references public.data_sources (slug),
    run_id      uuid references public.source_runs (id),
    created_at  timestamptz not null default now(),
    primary key (kind, value)
);
create index person_identifiers_person_idx on public.person_identifiers (person_id);

-- A source entry is matched to a person once; later runs reuse the decision.
create table public.entry_matches (
    entry_id    uuid primary key references public.source_entries (id) on delete cascade,
    person_id   uuid references public.people (id) on delete set null,
    status      text not null check (status in ('pending_review','confirmed','rejected','no_match')),
    method      text not null check (method in ('cedula','name_review','manual','new_person')),
    score       real,
    candidates  jsonb not null default '[]',  -- what the matcher proposed, for the review queue
    run_id      uuid not null references public.source_runs (id),   -- run that proposed it
    decided_by  uuid references auth.users (id),
    decided_at  timestamptz
);
create index entry_matches_status_idx on public.entry_matches (status);

-- A doctor's listing(s) -> the person. Clinic listings reach their doctors through clinic_practitioners.
create table public.provider_people (
    provider_id uuid not null references public.providers (id) on delete cascade,
    person_id   uuid not null references public.people (id) on delete cascade,
    method      text not null check (method in ('doctoralia_link','name_review','manual','new_listing')),
    run_id      uuid references public.source_runs (id),
    decided_by  uuid references auth.users (id),
    created_at  timestamptz not null default now(),
    primary key (provider_id, person_id)
);
create index provider_people_person_idx on public.provider_people (person_id);

create table public.person_affiliations (
    person_id             uuid not null references public.people (id) on delete cascade,
    organization_id       uuid not null references public.organizations (id),
    status                text not null check (status in ('confirmed','lapsed','rejected')),
    source_slug           text not null references public.data_sources (slug),
    evidence_entry_id     uuid references public.source_entries (id) on delete set null,
    created_run_id        uuid not null references public.source_runs (id),
    last_confirmed_run_id uuid not null references public.source_runs (id),
    last_confirmed_at     timestamptz not null,
    valid_to              date,
    primary key (person_id, organization_id)
);

-- ── Name normalisation, same function the onboarding matcher uses (0005) ────
create or replace function public.sources_name_norm_trg() returns trigger
language plpgsql set search_path = public as $$
begin
    if tg_table_name = 'people' then new.name_norm := public.bh_norm(new.display_name);
    else new.name_norm := public.bh_norm(new.name);
    end if;
    return new;
end $$;
create trigger source_entries_name_norm before insert or update of name on public.source_entries
    for each row execute function public.sources_name_norm_trg();
create trigger people_name_norm before insert or update of display_name on public.people
    for each row execute function public.sources_name_norm_trg();

-- ── Lock down: pipeline tables are service-role only (pattern of 0033) ───────
do $$
declare t text;
begin
    foreach t in array array['organizations','data_sources','source_runs','source_entries','source_observations',
                             'people','person_identifiers','entry_matches','provider_people','person_affiliations'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
    end loop;
end $$;

-- ── The badges cache the site reads ─────────────────────────────────────────
-- Constant default: metadata-only in Postgres 11+, no table rewrite.
alter table public.providers add column badges jsonb not null default '[]';
-- 0032 revoked anon SELECT per column; a new column is invisible to anon until granted.
grant select (badges) on public.providers to anon, authenticated;
-- Owners must not write it (0003 whitelists owner-updatable columns; badges is not added there).

-- Rebuild badges for the listings of the given people. Called by the pipeline after a run.
create or replace function public.refresh_provider_badges(p_people uuid[])
returns integer language sql security definer set search_path = public as $$
    with targets as (
        select distinct provider_id from public.provider_people where person_id = any (p_people)
    ), computed as (
        select t.provider_id,
               coalesce(jsonb_agg(jsonb_build_object(
                   'org',          o.slug,
                   'name',         o.name,
                   'kind',         o.kind,
                   'logo',         case when o.logo_permission_at is not null then o.logo_url end,
                   'source',       a.source_slug,
                   'confirmed_at', a.last_confirmed_at,
                   'valid_to',     a.valid_to
               ) order by o.kind, o.name) filter (where o.id is not null), '[]'::jsonb) as badges
        from targets t
        left join public.provider_people pp on pp.provider_id = t.provider_id
        left join public.person_affiliations a on a.person_id = pp.person_id and a.status = 'confirmed'
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
revoke all on function public.refresh_provider_badges(uuid[]) from public, anon, authenticated;

-- provider_list (0021) is re-created with p.badges appended; same security_invoker
-- view, same filter, same columns otherwise. (Exact text copied from production's
-- current definition at apply time, so later edits to the view are not lost.)

-- ── Seed: the first organization and source ──────────────────────────────────
insert into public.organizations (slug, name, kind, country, website)
values ('hospital-angeles', 'Hospital Ángeles', 'hospital', 'MX', 'https://hospitalangeles.com');
insert into public.data_sources (slug, organization_id, name, access, permission_granted_on, permission_scope, permission_ref)
select 'hospital-angeles', id, 'Hospital Ángeles doctor directory', 'permission', date '2026-10-30',
       'Scrape, store and display the doctor directory data, on condition it is kept up to date',
       'Signed letter in the team vault'
from public.organizations where slug = 'hospital-angeles';

commit;
```

### Rollback

```sql
begin;
-- re-create provider_list without p.badges first (previous definition)
drop function if exists public.refresh_provider_badges(uuid[]);
alter table public.providers drop column if exists badges;
drop table if exists public.person_affiliations, public.provider_people, public.entry_matches,
    public.person_identifiers, public.people, public.source_observations, public.source_entries,
    public.source_runs, public.data_sources, public.organizations;
drop function if exists public.sources_name_norm_trg();
commit;
```

## How it was tested

The two SQL blocks above were run, unchanged, in a **throwaway local Postgres 17 container** (never production), with stand-ins for the production objects they reference (`providers`, `auth.users`, `bh_norm`, the `anon`/`authenticated` roles). Re-run it with:

```bash
bash docs/roadmap/phase-2-sql-test/run.sh
```

Result on 3 Nov 2026: migration applied; 12 of 12 checks passed; rollback removed every table and the column; the migration re-applied cleanly after rollback.

| Check | Result |
|---|---|
| `name_norm` filled by trigger | pass |
| One refresh updates both duplicate listings of a person (2 rows) | pass |
| A second refresh is a no-op (0 rows) | pass |
| Duplicate listings show the same badge; an unrelated listing keeps `[]` | pass |
| Logo hidden until `logo_permission_at` is set, shown after | pass |
| The same cédula cannot be given to two people | pass (unique violation) |
| `anon` reads `providers.badges` | pass |
| `anon` cannot read `people` or `source_observations`, cannot run `refresh_provider_badges` | pass (permission denied) |

Not covered by the local test: production's real `provider_list` definition (re-created at apply time), production's grants beyond the stand-ins, and timing on 12,613 rows. The `alter table … add column … default '[]'` is metadata-only in Postgres 11+, so it should not rewrite the table.

## What it touches in the existing schema

| Object | Change | Risk |
|---|---|---|
| `providers` | **Adds** `badges jsonb not null default '[]'` + column grant to anon/authenticated | Brief lock to add the column (metadata only). Checked the three existing triggers (below): none reacts to a `badges`-only update |
| `provider_list` view (0021) | **Re-created** with `p.badges` added | Must start from production's current definition |
| `provider_public()` (0032) | No change: returns `to_jsonb(p)`, so `badges` flows through | Check it does not strip unknown columns |
| `clinic_practitioners` | Read only, later, for clinic listings | None |
| `doctoralia_doctors` | Read only, to find cédulas for people | None |
| Billing, `verified`, `licensed`, auth, leads, forums, contact-data grants | **Not touched** | None |

## Order of work after approval

1. Carlos approves the design and the migration number (or names another).
2. Emilio applies the migration in one transaction, at a quiet hour.
3. The pipeline gains `--commit`: writes the run, entries and observations; proposes matches. Hospital Ángeles has no cédulas, so all 394 go to `pending_review`. **No badge appears on the site yet.**
4. Roadmap phase 4 builds the review queue in `/admin`. Confirmed matches create `person_affiliations` and call `refresh_provider_badges`.
5. Roadmap phase 5 renders `providers.badges` on the card and profile, and in `/api/v1`.

Steps 3–5 change the app only on the branch, each reviewed before merge.

## Questions for Carlos (with a recommendation each)

1. **Migration number and timing.** Production's next free number is 0035. Are you writing a 0035 yourself? *Recommendation: Emilio takes 0035 once you say your work has landed, or whichever number you name.*
2. **`providers.badges` and the `provider_list` re-create.** OK to add one column to your table and re-create your view? *Alternative: a separate `provider_badges` view joined by the client; costs an extra request per page.*
3. **Triggers on `providers`.** Production has three (checked 3 Nov): `providers_norm` (BEFORE INSERT/UPDATE **of name, city, phone**: not fired by `badges`), `languages_confirmed_on_change` (BEFORE UPDATE, every row, but acts only when `languages` changes), and `providers_notify_new_listing` (AFTER INSERT, writes a `leads` row only for `source = 'self'` and `status = 'pending'`). So a `badges` update does nothing else. Anything outside the database (a Supabase webhook, realtime subscriber) listening to `providers` updates? *Later, when the pipeline creates listings for unmatched doctors, `providers.source` will need a new allowed value (e.g. `hospital-angeles`), which also keeps those inserts out of the new-listing lead trigger. That is a separate, later migration.*
4. **What "Verified" means** ([ADR 0005](../adr/0005-meaning-of-verified.md)): credential (plan D5) or paid (current code)? Hospital Ángeles badges do not depend on this; the Verified badge does.
5. **Migration files missing from the repo.** Production has migrations with no file in `supabase/migrations/`: `clinic_teams` (creates `clinic_practitioners`), `0005b`–`0005g`, `0015b`, `0017b`. *Recommendation: commit them so the repo rebuilds the real schema.*
6. **Legacy API keys end in 2026.** Supabase's docs say the legacy `anon` and `service_role` keys keep working until the end of 2026. If Vercel still uses them, the site needs the publishable and secret keys before then. `src/lib/supabase.ts` decodes the anon key as a JWT to catch a leaked service key; the new keys are not JWTs. The pipeline already uses its own secret key (`sources-pipeline`).
7. **Hetzner account** for the weekly runner (roadmap phase 6, [ADR 0006](../adr/0006-pipeline-runtime.md)).
8. **Seen along the way, for whoever owns them:** on 30 Oct, `POST /ingest/e/` (the PostHog proxy) returned **405** in production, so analytics events may not be recorded; and search cards were loading very slowly (you said a fix is in progress).

## For an AI reviewer

Check against production before approving, and report anything that does not hold:

- Every column and type referenced above exists as stated (`providers`, `doctoralia_doctors`, `clinic_practitioners`).
- `bh_norm(text)` exists with that signature and is safe to call in a trigger.
- The anon grant pattern of 0032/0033 means `grant select (badges)` is required and sufficient; `provider_public()` returns the new column.
- The `provider_list` view's current definition (production, not the 0021 file) and how to add `p.badges` without changing anything else.
- All triggers on `public.providers` and whether any should skip `badges`-only updates.
- No table name collides; RLS is enabled and anon/authenticated have no grants on the new tables.
- `refresh_provider_badges` is not executable by anon or authenticated, and only exposes a logo when `logo_permission_at` is set.
- Nothing here changes billing, `verified`, `licensed`, auth or contact-data access.
