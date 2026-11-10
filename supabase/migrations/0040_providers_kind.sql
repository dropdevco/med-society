-- providers.kind: marks listings that are a stay (post-surgery recovery house),
-- so they start the Website tab brief as "Recovery or stay" and can be filtered.
-- See docs/recovery-centers-plan.md. DRAFT - not applied.
--
-- Nullable, no default: adding it is a metadata-only change on the 12.6k rows.
-- Every existing row stays NULL; only listings curated as recovery houses get 'stay'.

alter table public.providers
    add column if not exists kind text
    check (kind is null or kind in ('stay'));

create index if not exists providers_kind_idx
    on public.providers (kind) where kind is not null;

-- 0032 made anon/authenticated reads column-by-column: a column added later is
-- unreadable (and `select *` would fail) until it is granted. kind is not
-- sensitive.
grant select (kind) on public.providers to anon, authenticated;

-- provider_list is an explicit-column view; append kind so the directory,
-- sitemap and agent API can read it. Replacing a view may only add columns at
-- the end, so every existing column keeps its position. The view stays
-- security_invoker and status = 'live' only (pending recovery houses are not
-- listed until someone sets them live).
create or replace view public.provider_list as
select id, name, specialty, country, city, region, address, lat, lng,
       "postalCode", rating, "reviewCount", promoted, tier, verified, licensed,
       "featuredRank", "priceFromMxn", insurances, languages, languages_confirmed,
       source, "imageUrl", "googlePlaceId", service_names, kind
  from public.providers p
 where status = 'live';
alter view public.provider_list set (security_invoker = true);

-- provider_public(uuid) and my_providers(uuid[]) return to_jsonb(p) minus a few
-- internals, so they pick kind up automatically; no change needed there.

-- ── Rollback ────────────────────────────────────────────────────────────────
-- create or replace view public.provider_list as <same select without kind>;
--   (a view cannot drop a column via replace: drop view + recreate + regrant
--    select to anon, authenticated, service_role)
-- drop index if exists public.providers_kind_idx;
-- alter table public.providers drop column if exists kind;
