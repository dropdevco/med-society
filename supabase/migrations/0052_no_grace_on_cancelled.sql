-- 0052: no grace period on cancelled plans; remove the unused plan-request objects.
--
-- Replaces the abandoned 0041 (plan change requests, applied live on 2026-11-12
-- and never used). Plan changes and cancellations move to Stripe's customer
-- portal, so there is no request queue.
--
-- Kept from 0041: the 4 days after `paid_through` exist for a card that fails on
-- renewal. A cancelled plan will never renew, so it ends exactly at
-- `paid_through`. `sub_grants_access` and `billing_expire` below are the live
-- definitions, so this file also brings the repo in line with the database.
--
-- Safe to re-run.

create or replace function public.sub_grants_access(s public.provider_subscriptions)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
    select s.status = 'comp'
        or (s.status = 'active' and s.paid_through is not null
            and s.paid_through + public.billing_grace() > now())
        or (s.status = 'canceled' and s.paid_through is not null
            and s.paid_through > now());
$$;

create or replace function public.billing_expire()
returns table (provider_id uuid, plan text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    return query
    with lapsed as (
        update public.provider_subscriptions s
           set status = 'lapsed', ghl_dirty = true, updated_at = now()
         where s.paid_through is not null
           and ((s.status = 'active' and s.paid_through + public.billing_grace() <= now())
             or (s.status = 'canceled' and s.paid_through <= now()))
        returning s.provider_id, s.plan
    )
    select l.provider_id, l.plan from lapsed l;

    -- Also repairs any provider whose tier drifted from its subscriptions.
    perform public.recompute_provider_plan(x.provider_id)
       from (select distinct s2.provider_id from public.provider_subscriptions s2) x;
end;
$$;

-- ── Remove 0041's plan-request objects ───────────────────────────────────────
drop function if exists public.request_plan_change(uuid, text);
drop function if exists public.my_plan_request(uuid);
drop function if exists public.billing_plan_request_alert(uuid, uuid);
drop function if exists public.admin_plan_requests();
drop function if exists public.admin_resolve_plan_request(uuid, text);
drop table if exists public.plan_change_requests;
