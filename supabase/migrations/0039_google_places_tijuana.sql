-- Staging table for the Tijuana post-surgery recovery-center sweep:
--   npx tsx scripts/doctoralia/sweep.ts collect --target=tijuana-recovery --commit
-- Same shape as google_places_juarez minus its Doctoralia link columns.
-- NOT APPLIED: only --commit needs it; the dry run / --estimate never touches it.

create table if not exists public.google_places_tijuana (
  place_id          text primary key,
  name              text not null,
  formatted_address text,
  lat               double precision,
  lng               double precision,
  phone             text,
  website           text,
  rating            numeric(2,1),
  review_count      integer,
  types             text[] not null default '{}',
  business_status   text,
  found_via         text[] not null default '{}',
  fetched_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists google_places_tijuana_geo_idx on public.google_places_tijuana (lat, lng);

-- Service-role only, like google_places_juarez / _san_diego.
alter table public.google_places_tijuana enable row level security;
