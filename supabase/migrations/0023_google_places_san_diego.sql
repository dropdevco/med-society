-- Raw Google Places sweep results for the US side of San Diego–Tijuana
-- (San Diego, Chula Vista, National City, Imperial Beach, San Ysidro and the
-- rest of the border-adjacent box). Written by
--   npx tsx scripts/doctoralia/sweep.ts collect --target=san-diego --commit
-- and read by
--   npx tsx scripts/doctoralia/promote-google.ts --target=san-diego
--
-- Same shape as google_places_juarez (scripts/doctoralia/schema-003-google-sweep.sql)
-- so the two scripts share one code path, minus the Doctoralia link columns
-- (there is no Doctoralia for the US side) and plus the address parts that
-- decide country, city and ZIP for the providers row.
--
-- A separate table rather than a region column on google_places_juarez: that
-- table's FK to doctoralia_doctors and its link phase are Juárez-specific, and
-- leaving it untouched keeps the Juárez scripts exactly as they were.

create table if not exists public.google_places_san_diego (
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

  -- Which sweep query surfaced it (coverage debugging, and the specialty
  -- fallback in promote-google.ts when the name says nothing).
  found_via         text[] not null default '{}',

  -- From Place Details address_components (fallback: the formatted address).
  -- The sweep stores only country_code = 'US'; promote re-checks it.
  country_code      text,
  locality          text,
  postal_code       text,

  fetched_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists google_places_san_diego_geo_idx   on public.google_places_san_diego (lat, lng);
create index if not exists google_places_san_diego_phone_idx on public.google_places_san_diego (phone)
  where phone is not null;

-- Service-role only, like google_places_juarez: no policies, so anon and
-- authenticated clients see nothing.
alter table public.google_places_san_diego enable row level security;
