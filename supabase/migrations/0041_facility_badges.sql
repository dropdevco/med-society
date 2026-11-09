-- Facility badges: registers and directories that describe a place, not a person
-- (docs/adr/0008). A badge sits on the listing. Needs 0039 and 0040. Not applied to production.
begin;

alter table public.data_sources
    add column entity text not null default 'doctor' check (entity in ('doctor','facility'));

-- One decision per source record, like doctor_source_ids. Only confirmed and
-- rejected are final: a listing may appear after a record was seen.
create table public.facility_source_ids (
    source_slug text not null references public.data_sources (slug),
    external_id text not null,
    provider_id uuid references public.providers (id) on delete set null,
    status      text not null check (status in ('confirmed','probable','rejected','unmatched')),
    tier        smallint,
    confidence  numeric,
    candidates  jsonb not null default '[]',
    first_run_id uuid references public.source_runs (id),
    last_run_id  uuid references public.source_runs (id),
    decided_by  uuid,
    decided_at  timestamptz,
    primary key (source_slug, external_id)
);
create index facility_source_ids_provider_idx on public.facility_source_ids (provider_id);

create table public.listing_affiliations (
    provider_id           uuid not null references public.providers (id) on delete cascade,
    organization_id       uuid not null references public.organizations (id),
    label                 text not null default '',
    status                text not null check (status in ('confirmed','lapsed')),
    source_slug           text not null references public.data_sources (slug),
    evidence_entry_id     uuid references public.source_entries (id) on delete set null,
    created_run_id        uuid not null references public.source_runs (id),
    last_confirmed_run_id uuid not null references public.source_runs (id),
    last_confirmed_at     timestamptz not null,
    valid_from            date,
    valid_to              date,
    facts                 jsonb not null default '{}',
    url                   text,
    primary key (provider_id, organization_id, label)
);

-- The cache now holds both kinds, so one function builds it from listings.
create function public.refresh_listing_badges(p_providers uuid[])
returns integer language sql security definer set search_path = public as $$
    with targets as (
        select distinct unnest(p_providers) as provider_id
    ), earned as (
        select l.provider_id, a.organization_id, a.source_slug, a.label, a.url,
               a.last_confirmed_at, a.valid_from, a.valid_to, a.facts
        from public.doctor_listings l
        join public.doctor_affiliations a on a.doctor_id = l.doctor_id and a.status = 'confirmed'
        where l.provider_id = any (p_providers)
        union all
        select a.provider_id, a.organization_id, a.source_slug, a.label, a.url,
               a.last_confirmed_at, a.valid_from, a.valid_to, a.facts
        from public.listing_affiliations a
        where a.status = 'confirmed' and a.provider_id = any (p_providers)
    ), computed as (
        select t.provider_id,
               coalesce(jsonb_agg(jsonb_build_object(
                   'org',          o.slug,
                   'name',         o.name,
                   'kind',         o.kind,
                   'label',        a.label,
                   'logo',         case when o.logo_permission_at is not null then o.logo_url end,
                   'url',          case when s.doctor_links then a.url end,
                   'info_url',     coalesce(o.info_url, o.website),
                   'confirmed_at', a.last_confirmed_at,
                   'valid_from',   a.valid_from,
                   'valid_to',     a.valid_to,
                   'facts',        a.facts
               ) order by case o.kind when 'hospital' then 0 when 'consejo' then 1 when 'regulator' then 1
                                      when 'accreditor' then 1 when 'colegio' then 2 else 3 end, o.name, a.label)
               filter (where o.id is not null), '[]'::jsonb) as badges
        from targets t
        left join earned a on a.provider_id = t.provider_id and (a.valid_to is null or a.valid_to >= current_date)
        left join public.organizations o on o.id = a.organization_id
        left join public.data_sources s on s.slug = a.source_slug
        group by t.provider_id
    ), updated as (
        update public.providers p set badges = c.badges
        from computed c
        where p.id = c.provider_id and p.badges is distinct from c.badges
        returning 1
    )
    select count(*)::integer from updated;
$$;

create or replace function public.refresh_provider_badges(p_doctors uuid[])
returns integer language sql security definer set search_path = public as $$
    select public.refresh_listing_badges(coalesce(array_agg(distinct provider_id), '{}'))
    from public.doctor_listings where doctor_id = any (p_doctors);
$$;

-- Candidate listings for a facility's name, in its region.
create function public.facility_name_candidates(p_name text, p_region text, p_limit integer default 5)
returns table (provider_id uuid, name text, similarity real, region text)
language sql stable security definer set search_path = public, extensions as $$
    with n as (select public.bh_norm(p_name) as norm)
    select p.id, p.name, extensions.similarity(public.bh_norm(p.name), n.norm), p.region
    from public.providers p, n
    where p.status = 'live' and (p_region is null or p.region = p_region)
      and extensions.similarity(public.bh_norm(p.name), n.norm) >= 0.5
    order by 3 desc, p.name
    limit p_limit;
$$;

-- After a green run: renew what is still listed, lapse what missed two runs, rebuild.
create function public.sync_facility_badges(p_source text, p_run uuid, p_lapse boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
    v_org uuid;
    v_when timestamptz;
    v_touched uuid[];
    v_lapsed integer := 0;
    v_renewed integer := 0;
begin
    select organization_id into v_org from public.data_sources where slug = p_source;
    select started_at into v_when from public.source_runs where id = p_run;
    if v_org is null or v_when is null then
        raise exception 'unknown source or run: %, %', p_source, p_run;
    end if;

    with up as (
        insert into public.listing_affiliations as a
            (provider_id, organization_id, label, status, source_slug, evidence_entry_id,
             created_run_id, last_confirmed_run_id, last_confirmed_at, valid_from, valid_to, facts, url)
        select m.provider_id, v_org, e.label, 'confirmed', p_source, e.id, p_run, p_run, v_when,
               e.valid_from, e.valid_to, e.facts, e.url
        from public.facility_source_ids m
        join public.source_entries e on e.source_slug = m.source_slug and e.external_id = m.external_id
        where m.source_slug = p_source and m.status = 'confirmed' and m.provider_id is not null and e.last_seen_run_id = p_run
        on conflict (provider_id, organization_id, label) do update
            set status = 'confirmed', evidence_entry_id = excluded.evidence_entry_id,
                last_confirmed_run_id = excluded.last_confirmed_run_id, last_confirmed_at = excluded.last_confirmed_at,
                valid_from = excluded.valid_from, valid_to = excluded.valid_to, facts = excluded.facts, url = excluded.url
        returning a.provider_id
    )
    select array_agg(distinct provider_id), count(*) into v_touched, v_renewed from up;

    if p_lapse then
        with gone as (
            update public.listing_affiliations a set status = 'lapsed'
            from public.source_entries e
            where a.evidence_entry_id = e.id and a.source_slug = p_source
              and a.status = 'confirmed' and e.missed_runs >= 2
            returning a.provider_id
        )
        select coalesce(v_touched, '{}') || coalesce(array_agg(distinct provider_id), '{}'), count(*)
        into v_touched, v_lapsed from gone;
    end if;

    perform public.refresh_listing_badges(coalesce(v_touched, '{}'));
    return jsonb_build_object('renewed', v_renewed, 'lapsed', v_lapsed);
end $$;

-- ── Review, for /admin ───────────────────────────────────────────────────────
create or replace function public.admin_sources_overview()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
    perform public._admin_guard();
    return coalesce((
        select jsonb_agg(jsonb_build_object(
            'slug', s.slug, 'name', s.name, 'access', s.access, 'entity', s.entity, 'permission_granted_on', s.permission_granted_on,
            'last_run', (select jsonb_build_object('id', r.id, 'started_at', r.started_at, 'status', r.status, 'reasons', r.reasons, 'counts', r.counts)
                         from public.source_runs r where r.source_slug = s.slug order by r.started_at desc limit 1),
            'matches', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                        from (select status, count(*) n from (
                                  select status from public.doctor_source_ids m where m.source_slug = s.slug
                                  union all
                                  select status from public.facility_source_ids m where m.source_slug = s.slug) y
                              group by 1) x),
            'badges', (select count(*) from public.doctor_affiliations a where a.source_slug = s.slug and a.status = 'confirmed')
                    + (select count(*) from public.listing_affiliations a where a.source_slug = s.slug and a.status = 'confirmed')
        ) order by s.slug)
        from public.data_sources s where s.organization_id is not null), '[]'::jsonb);
end $$;

create function public.admin_facility_queue(p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
    perform public._admin_guard();
    return jsonb_build_object(
        'total', (select count(*) from public.facility_source_ids where status = 'probable'),
        'items', coalesce((
            select jsonb_agg(row_to_json(q)) from (
                select m.source_slug, m.external_id, m.provider_id, m.confidence, m.candidates,
                       e.name, e.label, e.region, e.url, e.valid_to, e.facts
                from public.facility_source_ids m
                join public.source_entries e on e.source_slug = m.source_slug and e.external_id = m.external_id
                where m.status = 'probable'
                order by m.confidence desc, e.name
                limit least(p_limit, 200) offset p_offset
            ) q), '[]'::jsonb));
end $$;

create function public.admin_facility_decide(p_source text, p_external text, p_decision text, p_provider uuid default null)
returns void language plpgsql security definer set search_path = public, auth as $$
declare
    v_provider uuid;
    v_status text;
    v_org uuid;
    v_entry public.source_entries;
begin
    perform public._admin_guard();
    if p_decision not in ('confirm','reject') then
        raise exception 'decision must be confirm or reject';
    end if;
    select coalesce(p_provider, m.provider_id), m.status into v_provider, v_status from public.facility_source_ids m
    where m.source_slug = p_source and m.external_id = p_external
    for update;
    if not found then raise exception 'no such match'; end if;
    if v_status in ('confirmed','rejected') then raise exception 'this match was already decided'; end if;
    if p_decision = 'confirm' and v_provider is null then raise exception 'no listing to confirm'; end if;

    update public.facility_source_ids
       set status = case p_decision when 'confirm' then 'confirmed' else 'rejected' end,
           provider_id = case p_decision when 'confirm' then v_provider else provider_id end,
           decided_by = auth.uid(), decided_at = now()
     where source_slug = p_source and external_id = p_external;
    if p_decision = 'reject' then return; end if;

    select * into v_entry from public.source_entries where source_slug = p_source and external_id = p_external;
    select organization_id into v_org from public.data_sources where slug = p_source;

    insert into public.listing_affiliations as a
        (provider_id, organization_id, label, status, source_slug, evidence_entry_id,
         created_run_id, last_confirmed_run_id, last_confirmed_at, valid_from, valid_to, facts, url)
    select v_provider, v_org, v_entry.label, 'confirmed', p_source, v_entry.id,
           v_entry.last_seen_run_id, v_entry.last_seen_run_id, r.started_at,
           v_entry.valid_from, v_entry.valid_to, v_entry.facts, v_entry.url
    from public.source_runs r where r.id = v_entry.last_seen_run_id
    on conflict (provider_id, organization_id, label) do update
        set status = 'confirmed', evidence_entry_id = excluded.evidence_entry_id,
            last_confirmed_run_id = excluded.last_confirmed_run_id, last_confirmed_at = excluded.last_confirmed_at,
            valid_from = excluded.valid_from, valid_to = excluded.valid_to, facts = excluded.facts, url = excluded.url;

    perform public.refresh_listing_badges(array[v_provider]);
end $$;

-- ── Seed: open sources, no letter needed (docs/sources/README.md) ────────────
insert into public.organizations (slug, name, kind, website) values
    ('coepris-bc', 'COEPRIS Baja California', 'regulator', 'https://www.coeprisbc.gob.mx'),
    ('padron-salud-bc', 'Padrón Estatal de Salud', 'regulator', 'https://bajahealthtourism.com'),
    ('baja-health-cluster', 'Baja Health Cluster', 'association', 'https://bajahealthcluster.mx');

insert into public.data_sources (slug, organization_id, name, access, entity)
select o.slug, o.id, x.name, 'open', 'facility'
from public.organizations o
join (values
    ('coepris-bc', 'COEPRIS REPSSABI register'),
    ('padron-salud-bc', 'Padrón Estatal de Salud, residences'),
    ('baja-health-cluster', 'Baja Health Cluster recovery centers')
) as x (slug, name) on x.slug = o.slug;

-- ── Lock down (pattern of 0033) ──────────────────────────────────────────────
do $$
declare t text;
begin
    foreach t in array array['facility_source_ids','listing_affiliations'] loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon, authenticated', t);
        execute format('grant all on public.%I to service_role', t);
    end loop;
end $$;

revoke all on function public.refresh_listing_badges(uuid[]) from public, anon, authenticated;
revoke all on function public.refresh_provider_badges(uuid[]) from public, anon, authenticated;
revoke all on function public.facility_name_candidates(text, text, integer) from public, anon, authenticated;
revoke all on function public.sync_facility_badges(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.refresh_listing_badges(uuid[]) to service_role;
grant execute on function public.refresh_provider_badges(uuid[]) to service_role;
grant execute on function public.facility_name_candidates(text, text, integer) to service_role;
grant execute on function public.sync_facility_badges(text, uuid, boolean) to service_role;

revoke all on function public.admin_sources_overview() from public, anon;
revoke all on function public.admin_facility_queue(integer, integer) from public, anon;
revoke all on function public.admin_facility_decide(text, text, text, uuid) from public, anon;
grant execute on function public.admin_sources_overview() to authenticated;
grant execute on function public.admin_facility_queue(integer, integer) to authenticated;
grant execute on function public.admin_facility_decide(text, text, text, uuid) to authenticated;

commit;

-- Rollback (undo 0042 first):
--     begin;
--     drop function public.admin_facility_decide(text, text, text, uuid), public.admin_facility_queue(integer, integer),
--                   public.sync_facility_badges(text, uuid, boolean), public.facility_name_candidates(text, text, integer);
--     drop table public.listing_affiliations, public.facility_source_ids;
--     delete from public.data_sources where entity = 'facility'; delete from public.organizations where slug in ('coepris-bc', 'padron-salud-bc', 'baja-health-cluster');
--     -- then re-run the definitions of refresh_provider_badges and admin_sources_overview from 0040
--     drop function public.refresh_listing_badges(uuid[]);
--     alter table public.data_sources drop column entity;
--     commit;
