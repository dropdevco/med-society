-- 0048: explicit "collecting since" date for doctor analytics.
--
-- provider_stats_payload() used min(day) over the whole of provider_stats_daily as
-- "when we started collecting". That made one backdated row (a demo listing, a
-- backfill) move the date for everybody, weakening the 7-day guard and the
-- previous-period comparison. The date is now a setting; min(day) stays as the
-- fallback while it is null.
--
-- A listing forced on in provider_stats_overrides (a showcase clinic) is judged by
-- its own first day instead, so its history can be longer than the real launch.
--
-- Run in: Supabase dashboard -> SQL editor.

alter table public.stats_settings
    add column if not exists collecting_since date;

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
    v_since      date;      -- first day we trust stats from
    v_own_since  date;
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

    select s.min_views_30d, s.min_days, s.collecting_since
      into v_min, v_min_days, v_since
      from public.stats_settings s where s.id = true;
    if v_since is null then
        select min(d.day) into v_since from public.provider_stats_daily d;
    end if;
    select coalesce(sum(d.views), 0) into v_views
      from public.provider_stats_daily d
      where d.provider_id = p_provider and d.day between v_from and v_today;
    select o.show into v_override from public.provider_stats_overrides o where o.provider_id = p_provider;

    -- A forced-on listing is judged by its own history.
    if v_override is true then
        select min(d.day) into v_own_since from public.provider_stats_daily d where d.provider_id = p_provider;
        if v_own_since is not null then v_since := least(coalesce(v_since, v_own_since), v_own_since); end if;
    end if;

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

-- Real tracking starts with the first sync after this ships. Move the date if
-- the first real data arrives later than this.
update public.stats_settings set collecting_since = (now() at time zone 'utc')::date
 where id = true and collecting_since is null;
