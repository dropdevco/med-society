-- Profile analytics for doctors: what PostHog measures, kept where the product can use it.
--
-- PostHog is where events are collected. It is not what doctors read: its key
-- must never reach a browser, its retention is not ours to promise, and "show
-- real numbers once there are enough of them" is a product rule, not a query.
-- So a nightly job (api/stats.ts?job=sync) rolls yesterday's events up into the
-- tables below, and the dashboard reads only from here, through one function
-- that decides what each plan is allowed to see.
--
--   provider_stats_daily   one row per listing per day (views, contacts, sources…)
--   market_demand_daily    what people search for, by region and specialty
--   stats_settings         the "enough data" thresholds
--   provider_stats_overrides  force a listing's numbers on or off
--   stats_email_log        one report email per listing per period, however often the cron runs
--
-- Nothing here holds a person: counts, labels and enum-like keys only. No
-- search text, names, emails or phone numbers ever reach these tables (see the
-- rules at the top of src/lib/posthog.ts).
--
-- Run in: Supabase dashboard -> SQL editor.

-- ── Daily rollup per listing ─────────────────────────────────────────────────
create table if not exists public.provider_stats_daily (
    provider_id        uuid        not null,
    day                date        not null,           -- UTC day
    -- Put in front of someone by a search (top 20 of a result list), counted
    -- once per visitor per half hour. `position_sum / impressions` is the
    -- average place in the list.
    impressions        integer     not null default 0,
    position_sum       integer     not null default 0,
    clicks             integer     not null default 0, -- opened from a list or the map
    views              integer     not null default 0, -- profile opened, any way in
    visitors           integer     not null default 0, -- distinct people that day
    contacts           integer     not null default 0, -- phone / whatsapp / email / website / directions / social taps
    contacts_by_method jsonb       not null default '{}'::jsonb,
    sources            jsonb       not null default '{}'::jsonb, -- channel -> views
    countries          jsonb       not null default '{}'::jsonb, -- visitor country (ISO) -> views
    langs              jsonb       not null default '{}'::jsonb, -- 'en' | 'es' -> views
    devices            jsonb       not null default '{}'::jsonb, -- 'Mobile' | 'Desktop' | … -> views
    sections           jsonb       not null default '{}'::jsonb, -- profile section -> views that reached it
    -- Views by hour of day in the clinic's local time (24 entries, index 0 = midnight).
    by_hour            integer[]   not null default array_fill(0, array[24]),
    updated_at         timestamptz not null default now(),
    primary key (provider_id, day)
);
create index if not exists provider_stats_daily_day_idx on public.provider_stats_daily (day);

-- ── Market demand ────────────────────────────────────────────────────────────
-- Searches, aggregated. `specialty` is '_any' for a search that named none.
--   kind 'searches' / key 'all'          searches, and how many found nothing
--   kind 'term'     / key <term id>      a service from src/utils/searchTerms.ts
--   kind 'filter'   / key insurance|language|verified   a filter that was in use
create table if not exists public.market_demand_daily (
    day        date    not null,
    region     text    not null,
    specialty  text    not null,
    kind       text    not null check (kind in ('searches', 'term', 'filter')),
    key        text    not null,
    searches   integer not null default 0,
    no_results integer not null default 0,
    primary key (day, region, specialty, kind, key)
);

-- ── "Is there enough to show?" ───────────────────────────────────────────────
-- A doctor who sees "3 views" in month one will conclude the site does nothing,
-- and a number that small is mostly their own staff. Until a listing clears both
-- bars the dashboard says it is still collecting data. Edit the row to move them.
create table if not exists public.stats_settings (
    id            boolean primary key default true check (id),
    min_views_30d integer not null default 50 check (min_views_30d >= 0),
    min_days      integer not null default 7  check (min_days >= 0)
);
insert into public.stats_settings (id) values (true) on conflict (id) do nothing;

-- Force one listing on (a showcase clinic) or off (a problem with its data).
create table if not exists public.provider_stats_overrides (
    provider_id uuid primary key references public.providers (id) on delete cascade,
    show        boolean not null
);

-- One report email per listing per period; the cron can run twice and nobody is emailed twice.
create table if not exists public.stats_email_log (
    provider_id uuid        not null,
    kind        text        not null check (kind in ('monthly', 'weekly')),
    period      text        not null,   -- '2026-11' or '2026-W46'
    sent_at     timestamptz not null default now(),
    primary key (provider_id, kind, period)
);

alter table public.provider_stats_daily     enable row level security;
alter table public.market_demand_daily      enable row level security;
alter table public.stats_settings           enable row level security;
alter table public.provider_stats_overrides enable row level security;
alter table public.stats_email_log          enable row level security;
-- No policies on purpose: clients reach stats only through my_provider_stats().
revoke all on public.provider_stats_daily     from anon, authenticated;
revoke all on public.market_demand_daily      from anon, authenticated;
revoke all on public.stats_settings           from anon, authenticated;
revoke all on public.provider_stats_overrides from anon, authenticated;
revoke all on public.stats_email_log          from anon, authenticated;

-- ── Report emails are a preference of their own ──────────────────────────────
alter table public.notification_prefs
    add column if not exists reports boolean not null default true;

grant select (reports) on public.notification_prefs to authenticated;
grant update (reports) on public.notification_prefs to authenticated;

-- The unsubscribe link learns about the new kind. Same body as 0017 plus `reports`.
create or replace function public.forum_unsubscribe(p_token uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare n int;
begin
    update public.notification_prefs set
        prompts = case when p_kind in ('prompts', 'all') then false else prompts end,
        digest  = case when p_kind in ('digest',  'all') then false else digest  end,
        answers = case when p_kind in ('answers', 'all') then false else answers end,
        reports = case when p_kind in ('reports', 'all') then false else reports end,
        updated_at = now()
    where token = p_token;
    get diagnostics n = row_count;
    return n > 0;
end;
$$;
revoke all on function public.forum_unsubscribe(uuid, text) from public, anon, authenticated;

-- ── Helpers (internal: only my_provider_stats calls them) ────────────────────

-- Totals for one listing over a date range, as one object.
create or replace function public.stats_totals(p_provider uuid, p_from date, p_to date)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
    select jsonb_build_object(
        'impressions', coalesce(sum(s.impressions), 0),
        'avg_position', case when coalesce(sum(s.impressions), 0) > 0
                             then round(sum(s.position_sum)::numeric / sum(s.impressions), 1) end,
        'clicks',   coalesce(sum(s.clicks), 0),
        'views',    coalesce(sum(s.views), 0),
        'visitors', coalesce(sum(s.visitors), 0),
        'contacts', coalesce(sum(s.contacts), 0),
        -- First-party: straight from the inquiries table, not from PostHog.
        'inquiries', (
            select count(*) from public.patient_inquiries i
            where i.provider_id = p_provider
              and i.created_at >= p_from::timestamptz
              and i.created_at <  (p_to + 1)::timestamptz
        )
    )
    from public.provider_stats_daily s
    where s.provider_id = p_provider and s.day between p_from and p_to;
$$;

-- Sum one of the jsonb count-maps (sources, countries…) over a date range.
-- `p_min` drops any entry smaller than that: "1 visitor from a small country" is
-- close to describing one person, so audience breakdowns hide anything under 3.
create or replace function public.stats_map_sum(
    p_provider uuid, p_from date, p_to date, p_col text, p_min integer default 1
)
returns jsonb
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare r jsonb;
begin
    if p_col not in ('contacts_by_method', 'sources', 'countries', 'langs', 'devices', 'sections') then
        raise exception 'unknown column %', p_col;
    end if;
    execute format($q$
        select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
            select e.key as k, sum((e.value)::integer) as n
            from public.provider_stats_daily s, jsonb_each_text(s.%I) as e(key, value)
            where s.provider_id = $1 and s.day between $2 and $3
            group by e.key
            having sum((e.value)::integer) >= $4
        ) x
    $q$, p_col) into r using p_provider, p_from, p_to, p_min;
    return r;
end;
$$;

revoke all on function public.stats_totals(uuid, date, date)        from public, anon, authenticated;
revoke all on function public.stats_map_sum(uuid, date, date, text, integer) from public, anon, authenticated;

-- ── What a doctor may see, decided by their plan ─────────────────────────────
--   not ready  →  { ready: false }          still collecting data
--   basic      →  one headline number       the taste
--   promoted   →  the monthly report        totals, change, contacts, sources, plan lift
--   featured   →  everything                daily trend, audience, peak times, benchmark, demand
-- The gating lives here, not in the page, so it cannot be skipped by editing JS.
--
-- Two functions share one body: provider_stats_payload() does the work and is
-- callable only by the server (the report emails use it); my_provider_stats() is
-- the one a signed-in owner can call, and only for a listing they own.
create or replace function public.provider_stats_payload(p_provider uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_tier       text;
    v_region     text;
    v_spec       text;
    v_today      date := (now() at time zone 'utc')::date;
    v_from       date := (now() at time zone 'utc')::date - 29;
    v_prev_from  date := (now() at time zone 'utc')::date - 59;
    v_prev_to    date := (now() at time zone 'utc')::date - 30;
    v_min        integer;
    v_min_days   integer;
    v_since      date;      -- first day any stats exist anywhere
    v_views      integer;
    v_override   boolean;
    v_ready      boolean;
    v_out        jsonb;
    v_plan_since date;
    v_before_start date;
    v_before_days  integer;
    v_after_days   integer;
    v_before     integer;
    v_after      integer;
    v_lift       jsonb;
    v_peers      integer;
    v_below      integer;
    v_mine       integer;
    v_benchmark  jsonb;
    v_demand     jsonb;
begin
    select p.tier::text, p.region, p.specialty[1]
      into v_tier, v_region, v_spec
      from public.providers p where p.id = p_provider;
    if v_tier is null then
        return jsonb_build_object('ready', false);
    end if;

    select s.min_views_30d, s.min_days into v_min, v_min_days from public.stats_settings s where s.id = true;
    select min(d.day) into v_since from public.provider_stats_daily d;
    select coalesce(sum(d.views), 0) into v_views
      from public.provider_stats_daily d
      where d.provider_id = p_provider and d.day between v_from and v_today;
    select o.show into v_override from public.provider_stats_overrides o where o.provider_id = p_provider;

    v_ready := coalesce(
        v_override,
        v_views >= v_min and v_since is not null and (v_today - v_since) >= v_min_days
    );

    v_out := jsonb_build_object(
        'tier', v_tier, 'ready', v_ready, 'min_views', v_min, 'collecting_since', v_since
    );
    if not v_ready then return v_out; end if;

    v_out := v_out || jsonb_build_object('views_30d', v_views);
    if v_tier = 'basic' then return v_out; end if;

    -- ── Promoted and up ──
    v_out := v_out || jsonb_build_object(
        'totals', public.stats_totals(p_provider, v_from, v_today),
        'prev', public.stats_totals(p_provider, v_prev_from, v_prev_to),
        -- Only meaningful once the previous window is fully inside what we have.
        'prev_complete', (v_since is not null and v_since <= v_prev_from),
        'contacts_by_method', public.stats_map_sum(p_provider, v_from, v_today, 'contacts_by_method'),
        'sources', public.stats_map_sum(p_provider, v_from, v_today, 'sources')
    );

    -- "Views since you were promoted vs before": daily average over up to two
    -- weeks each side, and only when both sides have a week of real data.
    select min(sub.created_at)::date into v_plan_since
      from public.provider_subscriptions sub
      where sub.provider_id = p_provider and sub.status in ('active', 'canceled', 'comp');
    if v_plan_since is not null and v_since is not null and v_plan_since <= v_today then
        v_before_start := greatest(v_plan_since - 14, v_since);
        v_before_days  := v_plan_since - v_before_start;
        v_after_days   := v_today - v_plan_since + 1;
        if v_before_days >= 7 and v_after_days >= 7 then
            select coalesce(sum(d.views) filter (where d.day <  v_plan_since), 0),
                   coalesce(sum(d.views) filter (where d.day >= v_plan_since), 0)
              into v_before, v_after
              from public.provider_stats_daily d
              where d.provider_id = p_provider and d.day between v_before_start and v_today;
            v_lift := jsonb_build_object(
                'since', v_plan_since,
                'before_per_day', round(v_before::numeric / v_before_days, 1),
                'after_per_day',  round(v_after::numeric  / v_after_days, 1)
            );
        end if;
    end if;
    v_out := v_out || jsonb_build_object('plan_lift', v_lift);

    if v_tier <> 'featured' then return v_out; end if;

    -- ── Featured ──
    v_out := v_out || jsonb_build_object(
        'daily', (
            select coalesce(jsonb_agg(jsonb_build_object(
                       'day', d.day, 'views', d.views, 'contacts', d.contacts, 'impressions', d.impressions
                   ) order by d.day), '[]'::jsonb)
            from public.provider_stats_daily d
            where d.provider_id = p_provider and d.day between v_from and v_today
        ),
        'countries', public.stats_map_sum(p_provider, v_from, v_today, 'countries', 3),
        'devices',   public.stats_map_sum(p_provider, v_from, v_today, 'devices', 3),
        'sections',  public.stats_map_sum(p_provider, v_from, v_today, 'sections'),
        'langs',     public.stats_map_sum(p_provider, v_from, v_today, 'langs', 3),
        'by_hour', (
            select coalesce(jsonb_agg(x.n order by x.h), '[]'::jsonb) from (
                select h.h, coalesce(sum(d.by_hour[h.h + 1]), 0) as n
                from generate_series(0, 23) as h(h)
                left join public.provider_stats_daily d
                       on d.provider_id = p_provider and d.day between v_from and v_today
                group by h.h
            ) x
        ),
        'by_dow', (
            select coalesce(jsonb_agg(x.n order by x.w), '[]'::jsonb) from (
                select w.w, coalesce(sum(d.views), 0) as n
                from generate_series(0, 6) as w(w)
                left join public.provider_stats_daily d
                       on d.provider_id = p_provider and d.day between v_from and v_today
                      and extract(dow from d.day)::integer = w.w
                group by w.w
            ) x
        )
    );

    -- Where this listing stands among live listings of the same first specialty
    -- in the same region. Not shown for a group of fewer than five.
    if v_region is not null and v_spec is not null then
        with peers as (
            select p.id, coalesce(sum(d.views), 0)::integer as v
            from public.providers p
            left join public.provider_stats_daily d
                   on d.provider_id = p.id and d.day between v_from and v_today
            where p.status = 'live' and p.region = v_region and p.specialty[1] = v_spec
            group by p.id
        )
        select count(*)::integer,
               count(*) filter (where v < (select v from peers where id = p_provider))::integer,
               (select v from peers where id = p_provider)
          into v_peers, v_below, v_mine
          from peers;
        if v_peers >= 5 and v_mine is not null then
            v_benchmark := jsonb_build_object(
                'percentile', round(100.0 * v_below / (v_peers - 1)),
                'peers', v_peers,
                'specialty', v_spec
            );
        end if;

        -- What people in this region searched for in this specialty.
        select jsonb_build_object(
            'searches',   coalesce(sum(m.searches)   filter (where m.kind = 'searches'), 0),
            'no_results', coalesce(sum(m.no_results) filter (where m.kind = 'searches'), 0),
            'filters', (
                select coalesce(jsonb_object_agg(f.key, f.n), '{}'::jsonb) from (
                    select m2.key, sum(m2.searches) as n from public.market_demand_daily m2
                    where m2.region = v_region and m2.specialty = v_spec and m2.kind = 'filter'
                      and m2.day between v_from and v_today
                    group by m2.key
                ) f
            ),
            'terms', (
                select coalesce(jsonb_agg(jsonb_build_object('term', t.key, 'searches', t.n) order by t.n desc), '[]'::jsonb)
                from (
                    select m3.key, sum(m3.searches) as n from public.market_demand_daily m3
                    where m3.region = v_region and m3.specialty = v_spec and m3.kind = 'term'
                      and m3.day between v_from and v_today
                    group by m3.key having sum(m3.searches) >= 3 order by n desc limit 8
                ) t
            )
        ) into v_demand
        from public.market_demand_daily m
        where m.region = v_region and m.specialty = v_spec and m.day between v_from and v_today;
    end if;

    return v_out || jsonb_build_object('benchmark', v_benchmark, 'demand', v_demand);
end;
$$;

revoke all on function public.provider_stats_payload(uuid) from public, anon, authenticated;
grant execute on function public.provider_stats_payload(uuid) to service_role;

create or replace function public.my_provider_stats(p_provider uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
    if auth.uid() is null or not public.owns_provider(p_provider) then
        raise exception 'not allowed' using errcode = '42501';
    end if;
    return public.provider_stats_payload(p_provider);
end;
$$;

revoke all on function public.my_provider_stats(uuid) from public, anon;
grant execute on function public.my_provider_stats(uuid) to authenticated;

-- ── Who gets the report emails (service role only) ───────────────────────────
-- One row per listing per owner. SECURITY DEFINER because emails live in
-- auth.users. Mirrors forum_clinician_recipients (0017), including creating
-- the preference row that carries the unsubscribe token.
create or replace function public.stats_report_recipients()
returns table (
    user_id uuid, email text, lang text, token uuid,
    provider_id uuid, provider_name text, tier text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
begin
    insert into public.notification_prefs (user_id)
    select distinct o.user_id from public.provider_owners o
    on conflict (user_id) do nothing;

    return query
    select u.id,
           u.email::text,
           case when p.country = 'MX' then 'es' else 'en' end,
           np.token,
           p.id,
           p.name::text,
           p.tier::text
    from public.provider_owners o
    join auth.users u on u.id = o.user_id
    join public.notification_prefs np on np.user_id = u.id
    join public.providers p on p.id = o.provider_id
    where u.email is not null
      and u.email_confirmed_at is not null
      and np.reports
      and p.status = 'live';
end;
$$;

revoke all on function public.stats_report_recipients() from public, anon, authenticated;
grant execute on function public.stats_report_recipients() to service_role;
