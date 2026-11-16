-- The AI match scorer (docs/adr/0012), in shadow mode: it rates queued
-- name-only matches and stores the score, a verdict and a reason beside each
-- item in /admin -> Verification. A person still decides.
--
-- Auto-linking (off by default, scripts/sources/score-matches.ts) goes through
-- scorer_auto_link, which records exactly what each link changed, so that
--   scorer_undo_run(run)            puts every row a scorer run touched back, and
--   scorer_split(run, doctor, ...)  moves the records a run attached to one doctor
--                                   UUID into as many new UUIDs as there were people.
-- A cédula conflict (tier 1) is never auto-linked.
-- Needs 0042 to 0047. Run in: Supabase dashboard -> SQL editor (or apply_migration).

-- Scorer runs are source runs like any other: a UUIDv7, a start, a status, counts.
insert into public.data_sources (slug, name, access, cadence, doctor_links)
values ('ai-scorer', 'AI match scorer (scores queued matches; links nothing unless enabled)', 'manual', 'weekly', false);

-- ── Scores: evidence, never a decision ──────────────────────────────────────
create table public.match_scores (
    id           bigint generated always as identity primary key,
    run_id       uuid not null references public.source_runs (id),
    kind         text not null check (kind in ('doctor','facility')),
    source_slug  text not null references public.data_sources (slug),
    external_id  text not null,
    candidate_id uuid not null,              -- doctors.id or providers.id, by kind
    score        smallint not null check (score between 0 and 100),
    verdict      text not null check (verdict in ('approve','reject','needs_human')),
    reason       text not null,
    model        text not null,
    evidence     jsonb not null,             -- exactly what the model was shown: public directory fields only
    scored_at    timestamptz not null default now(),
    unique (run_id, kind, source_slug, external_id, candidate_id)
);
create index match_scores_item_idx on public.match_scores (kind, source_slug, external_id, scored_at desc);

-- ── Auto-links: what each one changed, so it can be undone or split ─────────
create table public.match_links (
    id                 bigint generated always as identity primary key,
    run_id             uuid not null references public.source_runs (id),
    source_slug        text not null,
    external_id        text not null,
    doctor_id          uuid not null references public.doctors (id),
    score              smallint not null,
    organization_id    uuid,
    label              text,
    before_match       jsonb not null,       -- the doctor_source_ids row before the link
    before_affiliation jsonb,                -- the badge row before, null if the link created it
    new_cedulas        text[] not null default '{}',  -- cédulas the link added to the doctor
    linked_at          timestamptz not null default now(),
    undone_at          timestamptz,
    split_into         uuid references public.doctors (id),
    foreign key (source_slug, external_id) references public.doctor_source_ids (source_slug, external_id)
);
create index match_links_run_idx on public.match_links (run_id);

create function public.scorer_auto_link(p_run uuid, p_source text, p_external text, p_doctor uuid, p_score smallint)
returns boolean language plpgsql security definer set search_path = public, auth as $$
declare
    m public.doctor_source_ids;
    v_entry public.source_entries;
    v_org uuid;
    v_aff jsonb;
    v_new text[];
begin
    select * into m from public.doctor_source_ids where source_slug = p_source and external_id = p_external for update;
    if not found or m.status <> 'probable' then return false; end if;
    if m.tier = 1 then return false; end if;  -- a cédula is involved: always a person (ADR 0012)
    if p_doctor is distinct from m.doctor_id
       and not exists (select 1 from jsonb_array_elements(m.candidates) c where (c->>'doctor_id')::uuid = p_doctor) then
        raise exception 'doctor % is not a candidate for %/%', p_doctor, p_source, p_external;
    end if;

    select * into v_entry from public.source_entries where source_slug = p_source and external_id = p_external;
    select organization_id into v_org from public.data_sources where slug = p_source;
    select to_jsonb(a) into v_aff from public.doctor_affiliations a
     where a.doctor_id = p_doctor and a.organization_id = v_org and a.label = v_entry.label;
    select coalesce(array_agg(c), '{}') into v_new from unnest(v_entry.cedulas) c
     where not exists (select 1 from public.doctor_cedulas d where d.cedula = c);

    perform public._decide_match(p_source, p_external, 'confirm', p_doctor);

    insert into public.match_links (run_id, source_slug, external_id, doctor_id, score, organization_id, label,
                                    before_match, before_affiliation, new_cedulas)
    values (p_run, p_source, p_external, p_doctor, p_score, v_org, v_entry.label, to_jsonb(m), v_aff, v_new);
    return true;
end $$;

-- Put back everything one scorer run linked, newest first. A link a person has
-- since changed is left alone and counted as skipped.
create function public.scorer_undo_run(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
    l public.match_links;
    cur public.doctor_source_ids;
    b public.doctor_affiliations;
    v_undone integer := 0;
    v_skipped integer := 0;
    v_doctors uuid[] := '{}';
begin
    for l in select * from public.match_links where run_id = p_run and undone_at is null and split_into is null order by id desc for update loop
        select * into cur from public.doctor_source_ids where source_slug = l.source_slug and external_id = l.external_id for update;
        if cur.status <> 'confirmed' or cur.doctor_id is distinct from l.doctor_id or cur.decided_by is not null then
            v_skipped := v_skipped + 1;
            continue;
        end if;

        update public.doctor_source_ids
           set status = l.before_match->>'status',
               doctor_id = (l.before_match->>'doctor_id')::uuid,
               decided_by = (l.before_match->>'decided_by')::uuid,
               decided_at = (l.before_match->>'decided_at')::timestamptz
         where source_slug = l.source_slug and external_id = l.external_id;

        if l.before_affiliation is null then
            delete from public.doctor_affiliations
             where doctor_id = l.doctor_id and organization_id = l.organization_id and label = l.label and source_slug = l.source_slug;
        else
            b := jsonb_populate_record(null::public.doctor_affiliations, l.before_affiliation);
            update public.doctor_affiliations
               set status = b.status, evidence_entry_id = b.evidence_entry_id, last_confirmed_run_id = b.last_confirmed_run_id,
                   last_confirmed_at = b.last_confirmed_at, valid_from = b.valid_from, valid_to = b.valid_to, facts = b.facts, url = b.url
             where doctor_id = l.doctor_id and organization_id = l.organization_id and label = l.label;
        end if;

        delete from public.doctor_cedulas where cedula = any(l.new_cedulas) and doctor_id = l.doctor_id;
        update public.match_links set undone_at = now() where id = l.id;
        v_doctors := v_doctors || l.doctor_id;
        v_undone := v_undone + 1;
    end loop;
    if cardinality(v_doctors) > 0 then
        perform public.refresh_provider_badges((select array_agg(distinct d) from unnest(v_doctors) d));
    end if;
    return jsonb_build_object('undone', v_undone, 'skipped', v_skipped);
end $$;

-- One UUID turned out to hold several people. p_groups lists, per new person,
-- the records ("source/external_id") the run attached to p_doctor that belong
-- to them; records not named stay with p_doctor. Each group becomes a new UUID.
create function public.scorer_split(p_run uuid, p_doctor uuid, p_groups jsonb)
returns uuid[] language plpgsql security definer set search_path = public, auth as $$
declare
    g jsonb;
    k text;
    l public.match_links;
    v_entry public.source_entries;
    v_new uuid;
    v_out uuid[] := '{}';
    v_seen text[] := '{}';
begin
    if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) = 0 then
        raise exception 'p_groups must be a non-empty array of arrays of "source/external_id"';
    end if;
    for g in select * from jsonb_array_elements(p_groups) loop
        v_new := null;
        for k in select * from jsonb_array_elements_text(g) loop
            if k = any(v_seen) then raise exception 'record % is in two groups', k; end if;
            v_seen := v_seen || k;
            select * into l from public.match_links
             where run_id = p_run and doctor_id = p_doctor and source_slug || '/' || external_id = k
               and undone_at is null and split_into is null
             for update;
            if not found then raise exception 'run % did not link % to doctor %', p_run, k, p_doctor; end if;
            if not exists (select 1 from public.doctor_source_ids
                            where source_slug = l.source_slug and external_id = l.external_id
                              and status = 'confirmed' and doctor_id = p_doctor) then
                raise exception 'record % no longer points at doctor %', k, p_doctor;
            end if;
            select * into v_entry from public.source_entries where source_slug = l.source_slug and external_id = l.external_id;
            if v_new is null then
                insert into public.doctors (display_name, created_run_id) values (v_entry.name, p_run) returning id into v_new;
                v_out := v_out || v_new;
            end if;

            update public.doctor_source_ids set doctor_id = v_new
             where source_slug = l.source_slug and external_id = l.external_id;
            update public.doctor_cedulas set doctor_id = v_new where cedula = any(l.new_cedulas) and doctor_id = p_doctor;

            -- The badge follows the record. One the doctor held before this link stays with them too.
            insert into public.doctor_affiliations
                (doctor_id, organization_id, label, status, source_slug, evidence_entry_id,
                 created_run_id, last_confirmed_run_id, last_confirmed_at, valid_from, valid_to, facts, url)
            select v_new, a.organization_id, a.label, a.status, a.source_slug, a.evidence_entry_id,
                   a.created_run_id, a.last_confirmed_run_id, a.last_confirmed_at, a.valid_from, a.valid_to, a.facts, a.url
              from public.doctor_affiliations a
             where a.doctor_id = p_doctor and a.organization_id = l.organization_id and a.label = l.label
            on conflict (doctor_id, organization_id, label) do nothing;
            if l.before_affiliation is null and not exists (
                select 1 from public.doctor_source_ids o
                  join public.source_entries e on e.source_slug = o.source_slug and e.external_id = o.external_id
                 where o.doctor_id = p_doctor and o.status = 'confirmed' and o.source_slug = l.source_slug and e.label = l.label) then
                delete from public.doctor_affiliations
                 where doctor_id = p_doctor and organization_id = l.organization_id and label = l.label and source_slug = l.source_slug;
            end if;

            update public.match_links set split_into = v_new where id = l.id;
        end loop;
    end loop;
    perform public.refresh_provider_badges(array[p_doctor] || v_out);
    return v_out;
end $$;

-- ── The review queues show the latest score beside each item ────────────────
create or replace function public.admin_match_queue(p_source text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
    perform public._admin_guard();
    return jsonb_build_object(
        'total', (select count(*) from public.doctor_source_ids m
                  where m.status = 'probable' and (p_source is null or m.source_slug = p_source)),
        'exact', (select count(*) from public.doctor_source_ids m
                  where m.status = 'probable' and m.confidence >= 0.99 and (p_source is null or m.source_slug = p_source)),
        'items', coalesce((
            select jsonb_agg(row_to_json(q)) from (
                select m.source_slug, m.external_id, m.tier, m.confidence, m.candidates,
                       e.name, e.label, e.specialties, e.cedulas, e.region, e.url, e.valid_to, e.facts,
                       s.ai_score
                from public.doctor_source_ids m
                join public.source_entries e on e.source_slug = m.source_slug and e.external_id = m.external_id
                left join lateral (
                    select jsonb_build_object('score', x.score, 'verdict', x.verdict, 'reason', x.reason,
                                              'candidate', x.candidate_id, 'model', x.model, 'scored_at', x.scored_at, 'run', x.run_id) as ai_score
                      from public.match_scores x
                     where x.kind = 'doctor' and x.source_slug = m.source_slug and x.external_id = m.external_id
                     order by x.scored_at desc limit 1) s on true
                where m.status = 'probable' and (p_source is null or m.source_slug = p_source)
                order by m.confidence desc, e.name
                limit least(p_limit, 200) offset p_offset
            ) q), '[]'::jsonb));
end $$;

create or replace function public.admin_facility_queue(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
    perform public._admin_guard();
    return jsonb_build_object(
        'total', (select count(*) from public.facility_source_ids where status = 'probable'),
        'items', coalesce((
            select jsonb_agg(row_to_json(q)) from (
                select m.source_slug, m.external_id, m.provider_id, m.confidence, m.candidates,
                       e.name, e.label, e.region, e.url, e.valid_to, e.facts,
                       s.ai_score
                from public.facility_source_ids m
                join public.source_entries e on e.source_slug = m.source_slug and e.external_id = m.external_id
                left join lateral (
                    select jsonb_build_object('score', x.score, 'verdict', x.verdict, 'reason', x.reason,
                                              'candidate', x.candidate_id, 'model', x.model, 'scored_at', x.scored_at, 'run', x.run_id) as ai_score
                      from public.match_scores x
                     where x.kind = 'facility' and x.source_slug = m.source_slug and x.external_id = m.external_id
                     order by x.scored_at desc limit 1) s on true
                where m.status = 'probable'
                order by m.confidence desc, e.name
                limit least(p_limit, 200) offset p_offset
            ) q), '[]'::jsonb));
end $$;

-- ── Lock down: service role only, as for the other source tables ────────────
alter table public.match_scores enable row level security;
alter table public.match_links enable row level security;
revoke all on public.match_scores, public.match_links from anon, authenticated;
grant all on public.match_scores, public.match_links to service_role;
revoke all on function public.scorer_auto_link(uuid, text, text, uuid, smallint) from public, anon, authenticated;
revoke all on function public.scorer_undo_run(uuid) from public, anon, authenticated;
revoke all on function public.scorer_split(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.scorer_auto_link(uuid, text, text, uuid, smallint) to service_role;
grant execute on function public.scorer_undo_run(uuid) to service_role;
grant execute on function public.scorer_split(uuid, uuid, jsonb) to service_role;

-- Rollback (only while no auto-link is live: undo every scorer run first):
--     drop function public.scorer_split(uuid, uuid, jsonb);
--     drop function public.scorer_undo_run(uuid);
--     drop function public.scorer_auto_link(uuid, text, text, uuid, smallint);
--     drop table public.match_links, public.match_scores;
--     delete from public.source_runs where source_slug = 'ai-scorer';
--     delete from public.data_sources where slug = 'ai-scorer';
--     then re-create admin_match_queue from 0043 and admin_facility_queue from 0044 as they were.
