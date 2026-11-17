-- Extra stand-ins for 0020b_clinic_teams and 0049_clinic_listings, loaded after
-- ../doctors-and-badges/stubs.sql. Not production's definitions.
create extension if not exists pgcrypto schema extensions;
alter table auth.users add column email text, add column email_confirmed_at timestamptz;
alter table public.providers add column phone text, add column updated_at timestamptz, add column updated_by uuid;

create table public.provider_owners (
    provider_id uuid not null references public.providers (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    role text not null default 'owner' check (role in ('owner', 'staff')),
    created_at timestamptz not null default now(),
    primary key (provider_id, user_id));
create function public.owns_provider(target uuid) returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
    select exists (select 1 from public.provider_owners where provider_id = target and user_id = auth.uid()) $$;

create table public.provider_photos (id uuid primary key default gen_random_uuid(), provider_id uuid);
create schema storage;
create table storage.objects (bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create table public.forum_threads (id uuid primary key default gen_random_uuid(), author_id uuid, provider_id uuid,
    forum text, hidden boolean default false);
create table public.forum_replies (id uuid primary key default gen_random_uuid(), thread_id uuid, author_id uuid, provider_id uuid);
create table public.notification_prefs (user_id uuid primary key, token uuid default gen_random_uuid(),
    prompts boolean default true, digest boolean default true);

-- As 0047 leaves them (the columns these tests touch).
create table public.provider_claims (
    id uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.providers (id) on delete cascade,
    user_id uuid not null references auth.users (id) on delete cascade,
    status text not null check (status in ('incomplete', 'pending', 'needs_info', 'approved', 'rejected')),
    evidence text, history jsonb not null default '[]', created_at timestamptz not null default now(),
    unique (provider_id, user_id));
create function public._claim_history(h jsonb, actor text, event text, status text, note text default null)
returns jsonb language sql immutable set search_path = pg_temp as $$
    select coalesce(h, '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'at', now(), 'by', actor, 'event', event, 'status', status, 'note', note))) $$;

create table public.doctoralia_addresses (id bigserial primary key, doctoralia_id text, clinic_name text, street text, city text);
create table public.patient_inquiries (id uuid primary key default gen_random_uuid(), provider_id uuid);
