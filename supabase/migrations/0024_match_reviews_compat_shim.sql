-- TEMPORARY: keep the deployed site's smart search working until the
-- region-aware API ships.
--
-- 0022 replaced match_reviews(query_embedding, match_count) with a version that
-- requires a region. The site currently in production still calls the old
-- two-argument form, so dropping it would make every smart search fail until
-- the deploy. That production build only knows El Paso–Ciudad Juárez, so this
-- shim answers it from that region only — which also keeps the Tijuana reviews
-- being seeded now from ever reaching it.
--
-- PostgREST resolves by argument names: {query_embedding, match_count} matches
-- this function; {query_embedding, p_region, match_count} matches 0022's.
--
-- DROP THIS once the new api/ai-search.ts is deployed:
--   drop function if exists public.match_reviews(extensions.vector, int);

create or replace function public.match_reviews(
    query_embedding extensions.vector(1024),
    match_count     int default 40
)
returns table (
    review_id   uuid,
    provider_id uuid,
    body        text,
    body_es     text,
    body_en     text,
    source_lang text,
    rating      numeric,
    symptoms    text[],
    outcome     text,
    similarity  double precision,
    region      text
)
language sql stable
set search_path = public, extensions
as $$
    select * from public.match_reviews(query_embedding, 'elpaso-juarez', match_count);
$$;

revoke all on function public.match_reviews(extensions.vector, int) from public, anon, authenticated;
