-- Smart search, one border region at a time.
--
-- The directory now covers El Paso–Ciudad Juárez and San Diego–Tijuana
-- (`providers.region`, migration 0021). Rule from the owner: a Tijuana review
-- must never affect a Juárez smart-search answer, and vice versa.
--
-- 0018's match_reviews ranked *every* review and returned the global top 40.
-- Filtering those 40 afterwards is not enough: Tijuana reviews would still
-- crowd Juárez ones out of the top-k (a Juárez query could come back with
-- 3 usable candidates instead of 40), and the triage model would see them.
-- So the region filter sits in the WHERE clause, joined through `providers`,
-- and the ORDER BY / LIMIT only ever see that region's rows.
--
-- Guarantees, by construction:
--   * `join public.providers p on p.id = e.provider_id` + `p.region = p_region`
--     drops every review whose listing is in another region (or has no region,
--     i.e. no coordinates) before ranking. NULL `p_region` matches nothing
--     (`=` with NULL is never true), so there is no "search everywhere" mode.
--   * `p.status = 'live'` keeps paused/pending listings out, matching what the
--     directory shows. (0018 relied on provider_id being non-null only.)
--   * `p_region` has no default and the old two-argument signature is dropped,
--     so a caller that forgets the region gets an error, not a global search.
--   * The region is returned per row so api/ai-search.ts can assert it too.
--
-- Performance: still an exact scan (see 0018 for why approximate search is
-- not used). review_embeddings grows from ~6.7k to ~23k rows with Tijuana;
-- halfvec(1024) STORAGE PLAIN keeps each vector in the heap row (~2 KB), so a
-- full pass is ~45 MB of buffer reads. The planner hash-joins against the
-- region's live providers (a few thousand ids, found via
-- providers_region_live_idx from 0021) and computes the distance only for joined rows, so the cosine work
-- scales with the region's review count, not the table's. If the heap pass ever
-- becomes the bottleneck, denormalise `region` onto review_embeddings (set by
-- scripts/reviews/enrich.ts seed) with a btree on it, or list-partition the
-- table by region; neither is needed at this size.

drop function if exists public.match_reviews(extensions.vector, int);

create function public.match_reviews(
    query_embedding extensions.vector(1024),
    p_region        text,
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
    select e.review_id, e.provider_id, r.body, e.body_es, e.body_en, e.source_lang,
           r.rating, e.symptoms, e.outcome,
           1 - (e.embedding <=> query_embedding::halfvec(1024)) as similarity,
           p.region
    from public.review_embeddings e
    join public.providers p on p.id = e.provider_id
    join public.doctoralia_reviews r on r.id = e.review_id
    where p.region = p_region
      and p.status = 'live'
      and e.embedding is not null
    order by e.embedding <=> query_embedding::halfvec(1024)
    limit least(match_count, 200);
$$;

-- Same posture as before: only the service role (api/ai-search.ts) may call it.
revoke all on function public.match_reviews(extensions.vector, text, int) from public, anon, authenticated;
