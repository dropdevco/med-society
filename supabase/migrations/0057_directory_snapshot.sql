-- 0057: a ready-made copy of each region's directory, so /api/directory reads
-- one stored row per part instead of paging provider_list.
--
-- Why: /api/directory (api/agent.ts, directoryRoute) answers from Vercel's CDN
-- cache, and every production deploy empties that cache. On a miss the function
-- read each part as up to 3 pages of 500 rows, one after another, through
-- PostgREST. Measured 20 Nov 2026: 0.6–1.7 s a page alone, ~2.9 s with 8 in
-- parallel, so a Tijuana part took 9 s or more and some hit the function's 12 s
-- abort. The rows themselves take 13 ms to read; the cost is building and
-- shipping JSON page by page under the anon role's 3 s statement timeout.
--
-- What: directory_snapshot holds each (region, part) as one jsonb array, in the
-- same shape and order the API served before (provider_list rows, ordered by
-- id). The parts are the API's: the first hex digit of the id, two digits a
-- part, 8 parts. pg_cron rebuilds it every 5 minutes (~2 s for both regions).
-- A part's rows are only rewritten when they changed; checked_at moves every run,
-- so the API can tell a live snapshot from a stopped job and fall back to paging.
--
-- Exposure: the rows are exactly what anon already reads from provider_list
-- (no contact fields, migration 0032). anon and authenticated may read the table
-- and nothing else; only the cron job (postgres) runs the refresh.
--
-- Rollback (pg_cron stays installed; dropping it would delete every job):
--   select cron.unschedule('refresh-directory-snapshot');
--   drop function public.refresh_directory_snapshot();
--   drop table public.directory_snapshot;

create table public.directory_snapshot (
    region      text        not null,
    part        smallint    not null check (part between 0 and 7),
    rows        jsonb       not null,
    row_count   integer     not null,
    built_at    timestamptz not null default now(),  -- when these rows last changed
    checked_at  timestamptz not null default now(),  -- when the job last confirmed them
    primary key (region, part)
);

comment on table public.directory_snapshot is
    'provider_list per (region, part) as one jsonb array, for /api/directory. Rebuilt by pg_cron every 5 minutes (refresh_directory_snapshot). Migration 0057.';

alter table public.directory_snapshot enable row level security;
create policy directory_snapshot_read on public.directory_snapshot
    for select to anon, authenticated using (true);
revoke all on public.directory_snapshot from anon, authenticated;
grant select on public.directory_snapshot to anon, authenticated;

create function public.refresh_directory_snapshot()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    changed integer;
    stamp   timestamptz := clock_timestamp();
begin
    -- One rebuild at a time; a run that finds another in progress skips.
    if not pg_try_advisory_xact_lock(hashtext('public.refresh_directory_snapshot')) then
        return -1;
    end if;

    with regions as (
        select distinct region from public.provider_list where region is not null
    ), slots as (
        select r.region, g.part::smallint as part
        from regions r cross join generate_series(0, 7) g(part)
    ), built as (
        select v.region,
               ((position(left(v.id::text, 1) in '0123456789abcdef') - 1) / 2)::smallint as part,
               jsonb_agg(to_jsonb(v) order by v.id) as rows
        from public.provider_list v
        where v.region is not null
        group by 1, 2
    ), fresh as (
        select s.region, s.part, coalesce(b.rows, '[]'::jsonb) as rows
        from slots s left join built b using (region, part)
    ), written as (
        insert into public.directory_snapshot as d (region, part, rows, row_count, built_at, checked_at)
        select region, part, rows, jsonb_array_length(rows), stamp, stamp from fresh
        on conflict (region, part) do update
            set rows = excluded.rows, row_count = excluded.row_count, built_at = excluded.built_at
            where d.rows is distinct from excluded.rows
        returning 1
    )
    select count(*) into changed from written;

    -- Unchanged rows keep their stored jsonb (no rewrite); only the check time moves.
    update public.directory_snapshot set checked_at = stamp
    where region in (select distinct region from public.provider_list where region is not null);
    delete from public.directory_snapshot
    where region not in (select distinct region from public.provider_list where region is not null);

    return changed;
end;
$$;

comment on function public.refresh_directory_snapshot() is
    'Rebuilds directory_snapshot from provider_list; returns the parts whose rows changed (-1: another run holds the lock). Run by pg_cron. Migration 0057.';

revoke all on function public.refresh_directory_snapshot() from public, anon, authenticated;

-- Every 5 minutes. Guarded so a Postgres without pg_cron (the local test) still applies.
do $$
begin
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
        create extension if not exists pg_cron with schema pg_catalog;
        perform cron.schedule('refresh-directory-snapshot', '*/5 * * * *',
                              'select public.refresh_directory_snapshot()');
    else
        raise notice 'pg_cron not available: directory_snapshot is not refreshed on a schedule here';
    end if;
end;
$$;

-- Fill it now, so the API can use it from the first request.
select public.refresh_directory_snapshot();
