-- Review helpers for the AI scorer (docs/adr/0014): two read-only functions, no
-- table changes.
--
--   admin_match_compare(source, external)  one queued or AI-linked record beside
--       each candidate doctor, field by field: name, specialties, regions,
--       cédulas with their titles, listings, badges. What /admin -> Verification
--       shows when a reviewer presses "Compare". Also the latest AI score with
--       the exact evidence the model was shown, and the scorer link if any.
--
--   review_near_bar(since, low, high)  records the scorer judged since `since`
--       with a score in [low, high] (default 70-89, either side of the 80 bar
--       for auto-linking), plus every cédula conflict (tier 1) it judged. One
--       row per record, its latest score. Feeds the "Near the bar" card and the
--       daily alert e-mail (api/claim-notify.ts, job=review).
--
-- Needs 0042 to 0046, 0050 and 0051.
-- Run in: Supabase dashboard -> SQL editor (or apply_migration).

-- ── One record beside its candidates ────────────────────────────────────────
create or replace function public.admin_match_compare(p_source text, p_external text)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
    m public.doctor_source_ids;
    ids uuid[];
begin
    perform public._admin_guard();
    select * into m from public.doctor_source_ids where source_slug = p_source and external_id = p_external;
    if not found then return null; end if;

    -- The candidates the matcher proposed, plus the doctor it is linked to now.
    select coalesce(array_agg(distinct x), '{}') into ids from (
        select (c->>'doctor_id')::uuid as x from jsonb_array_elements(coalesce(m.candidates, '[]'::jsonb)) c
        union all select m.doctor_id where m.doctor_id is not null
    ) s where x is not null;

    return jsonb_build_object(
        'status', m.status, 'tier', m.tier, 'confidence', m.confidence, 'doctor_id', m.doctor_id,
        'record', (select jsonb_build_object('name', e.name, 'label', e.label, 'specialties', e.specialties,
                                             'cedulas', e.cedulas, 'region', e.region, 'url', e.url,
                                             'valid_to', e.valid_to, 'facts', e.facts)
                     from public.source_entries e where e.source_slug = p_source and e.external_id = p_external),
        'candidates', coalesce((
            select jsonb_agg(jsonb_build_object(
                'doctor_id', d.id,
                'display_name', d.display_name,
                'similarity', (select (c->>'similarity')::numeric from jsonb_array_elements(coalesce(m.candidates, '[]'::jsonb)) c
                                where c->>'doctor_id' = d.id::text limit 1),
                'linked', d.id = m.doctor_id,
                'cedulas', coalesce((select jsonb_agg(jsonb_build_object('cedula', k.cedula, 'title', k.title, 'kind', k.kind) order by k.cedula)
                                       from public.doctor_cedulas k where k.doctor_id = d.id), '[]'::jsonb),
                'listings', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'city', p.city,
                                                                          'region', p.region, 'specialty', p.specialty, 'kind', p.kind) order by p.name)
                                        from public.doctor_listings l join public.providers p on p.id = l.provider_id
                                       where l.doctor_id = d.id), '[]'::jsonb),
                'badges', coalesce((select jsonb_agg(jsonb_build_object('organization', o.name, 'label', a.label, 'source', a.source_slug) order by o.name)
                                      from public.doctor_affiliations a join public.organizations o on o.id = a.organization_id
                                     where a.doctor_id = d.id and a.status = 'confirmed'), '[]'::jsonb)
            ) order by d.id = m.doctor_id desc, d.display_name)
              from public.doctors d where d.id = any (ids)), '[]'::jsonb),
        'ai', (select jsonb_build_object('score', x.score, 'verdict', x.verdict, 'reason', x.reason, 'candidate', x.candidate_id,
                                         'model', x.model, 'scored_at', x.scored_at, 'run', x.run_id, 'evidence', x.evidence)
                 from public.match_scores x
                where x.kind = 'doctor' and x.source_slug = p_source and x.external_id = p_external
                order by x.scored_at desc limit 1),
        'link', (select jsonb_build_object('doctor_id', k.doctor_id, 'score', k.score, 'run', k.run_id, 'linked_at', k.linked_at)
                   from public.match_links k
                  where k.source_slug = p_source and k.external_id = p_external and k.undone_at is null
                  order by k.linked_at desc limit 1)
    );
end $$;

-- ── Records near the auto-link bar, for review and the alert e-mail ─────────
create or replace function public.review_near_bar(p_since timestamptz, p_low integer default 70, p_high integer default 89, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
    -- The daily e-mail runs as the service role; people need to be admins.
    if coalesce(auth.role(), '') <> 'service_role' then
        perform public._admin_guard();
    end if;
    return coalesce((
        -- Cédula conflicts first, then the closest to the bar.
        select jsonb_agg(row_to_json(r) order by r.tier, abs(r.score - 80), r.name) from (
        select q.* from (
            select distinct on (x.source_slug, x.external_id)
                   x.source_slug, x.external_id, x.score, x.verdict, x.reason, x.scored_at, x.run_id as run,
                   m.status, m.tier, e.name, e.label, e.region,
                   d.display_name as candidate,
                   exists (select 1 from public.match_links k
                            where k.source_slug = x.source_slug and k.external_id = x.external_id and k.undone_at is null) as linked
              from public.match_scores x
              join public.doctor_source_ids m on m.source_slug = x.source_slug and m.external_id = x.external_id
              join public.source_entries e on e.source_slug = x.source_slug and e.external_id = x.external_id
              left join public.doctors d on d.id = x.candidate_id
             where x.kind = 'doctor' and x.scored_at >= p_since
             order by x.source_slug, x.external_id, x.scored_at desc
        ) q
        where (q.score between p_low and p_high or q.tier = 1)
          and q.status in ('probable', 'confirmed')   -- a person's rejection settles it
        order by q.tier, abs(q.score - 80), q.name
        limit least(p_limit, 500)
        ) r
    ), '[]'::jsonb);
end $$;

revoke all on function public.admin_match_compare(text, text) from public, anon;
grant execute on function public.admin_match_compare(text, text) to authenticated;
revoke all on function public.review_near_bar(timestamptz, integer, integer, integer) from public, anon;
grant execute on function public.review_near_bar(timestamptz, integer, integer, integer) to authenticated, service_role;

-- Rollback:
--     drop function public.review_near_bar(timestamptz, integer, integer, integer);
--     drop function public.admin_match_compare(text, text);
