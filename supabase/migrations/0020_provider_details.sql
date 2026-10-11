-- Rich profile fields scraped from Doctoralia (Tijuana run, 2026-10).
--
-- One row per provider, beside `providers` rather than in it: the directory
-- loads every live provider with `select *`, and these fields average ~1.3 KB a
-- profile (up to ~47 KB — 146 diseases, 78 certificate photos). On `providers`
-- they would add ~9 MB to every visitor's first load; here they are fetched for
-- the one provider being viewed.
--
-- Everything is the provider's own published profile. `about` is their own
-- text — deliberately not `providers.description`, which is the clinic-edited copy.

create table if not exists public.provider_details (
    provider_id          uuid primary key references public.providers (id) on delete cascade,
    doctoralia_id        text,
    about                text,
    education            text[] not null default '{}',
    experience           text[] not null default '{}',
    expert_in            text[] not null default '{}',
    -- [{name, slug}] — slug is Doctoralia's /enfermedades/<slug>, null when unlinked.
    diseases             jsonb  not null default '[]'::jsonb,
    -- [{title, url}]
    certificates         jsonb  not null default '[]'::jsonb,
    videos               text[] not null default '{}',
    -- [{question, answer}]
    qna                  jsonb  not null default '[]'::jsonb,
    -- [{text, key, count}]
    review_tags          jsonb  not null default '[]'::jsonb,
    -- {hasActiveCalendar, insuranceSupport, hasOnlinePaymentsEnabled, earliestBookableDate}
    booking              jsonb,
    -- {available, priceMin, currency}
    online_consultation  jsonb,
    equipment            text[] not null default '{}',
    cover_image_url      text,
    -- [{url, kind}] kind: profile | cover | gallery | certificate | news
    photos               jsonb  not null default '[]'::jsonb,
    -- Every distinct practice number across the provider's addresses (providers.phone holds one).
    phones               text[] not null default '{}',
    payment_methods      text[] not null default '{}',
    updated_at           timestamptz not null default now()
);

create unique index if not exists provider_details_doctoralia_id_key
    on public.provider_details (doctoralia_id) where doctoralia_id is not null;
-- Condition search ("who treats psoriasis") without unpacking every row.
create index if not exists provider_details_diseases_idx
    on public.provider_details using gin (diseases jsonb_path_ops);

alter table public.provider_details enable row level security;

-- Same visibility as the listing itself.
drop policy if exists "Public can read live provider details" on public.provider_details;
create policy "Public can read live provider details"
    on public.provider_details for select
    to anon, authenticated
    using (exists (select 1 from public.providers p where p.id = provider_id and p.status = 'live'));

drop policy if exists "owners read own details" on public.provider_details;
create policy "owners read own details"
    on public.provider_details for select
    to authenticated
    using (public.owns_provider(provider_id));

-- Service prices: a few tourist-facing surgeons quote USD. Keep the currency so a
-- "$65" consult is never read as 65 pesos; price_mxn stays null for those rows.
alter table public.doctoralia_services
    add column if not exists currency  text,
    add column if not exists price_min numeric,
    add column if not exists price_max numeric;
