-- A clinic's own reviews, for its page and modal.
--
-- Doctoralia reviews are staged in doctoralia_reviews (RLS on, no policies: the
-- browser cannot read it) and were only ever used server-side, for smart-search
-- quotes. A provider page showed no reviews unless the listing had a Google
-- place. This function is the one public door to them: it returns the latest
-- reviews of ONE live provider, and nothing else.
--
-- What it does and does not hand out:
--   * Author names are reduced here, never in the browser: "Leticia Alvarran
--     Mendoza" -> "Leticia M.", initials stay initials, and deleted or
--     anonymous accounts come back null (the page says "Patient"). A patient
--     who reviewed a doctor did not agree to have a full name on a directory.
--   * Newest first, whatever the rating. A sample chosen by stars would flatter
--     the clinic; the average the page already shows is over all reviews.
--   * Only reviews with some text, only for providers that are live, at most 20
--     per call. The provider is reached through doctoralia_doctors.provider_id,
--     the same link smart search uses.
--   * Both language versions travel with it (review_embeddings.body_es/body_en,
--     written by scripts/reviews/enrich.ts) so the page can show the visitor's
--     language and say when it is a translation.
--
-- SECURITY DEFINER because the tables are locked to the service role; the
-- function is the only thing that opens them, and it is read-only.

create or replace function public.provider_reviews(p_provider_id uuid, p_limit int default 10)
returns table (
    author_label text,
    rating       numeric,
    published_at timestamptz,
    body         text,
    body_es      text,
    body_en      text,
    source_lang  text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select
        case
            when btrim(coalesce(r.author, '')) = ''
              or r.author ~* 'an[oó]nim|eliminad|deleted|anonymous' then null
            -- already initials ("V. M. G.", "D.M.M"): keep as they are
            when btrim(r.author) ~ '^([[:alpha:]]\.\s*)+[[:alpha:]]?\.?$' then upper(btrim(r.author))
            when array_length(tk.t, 1) = 1 then initcap(lower(tk.t[1]))
            else initcap(lower(tk.t[1])) || ' ' || upper(left(tk.t[array_length(tk.t, 1)], 1)) || '.'
        end,
        r.rating,
        r.published_at,
        r.body,
        e.body_es,
        e.body_en,
        e.source_lang
    from public.doctoralia_reviews r
    join public.doctoralia_doctors d on d.doctoralia_id = r.doctoralia_id
    join public.providers p on p.id = d.provider_id and p.status = 'live'
    left join public.review_embeddings e on e.review_id = r.id
    cross join lateral (select regexp_split_to_array(btrim(coalesce(r.author, '')), '\s+') as t) tk
    where p.id = p_provider_id
      and length(btrim(r.body)) >= 5
    order by r.published_at desc nulls last, r.id
    limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;

revoke all on function public.provider_reviews(uuid, int) from public;
grant execute on function public.provider_reviews(uuid, int) to anon, authenticated;
