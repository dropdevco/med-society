-- Refunds stay a human decision. A refund in GHL is flagged in /admin and a
-- person ends the plan there; the money and the listing are separate actions.
--
--   * refund_seen: a full refund found in GHL. Recorded and flagged, changes nothing.
--   * admin_end_plan: ends a plan now, from /admin. GHL tags follow on the next daily sync.
--   * A late cancel can no longer bring an ended plan back. GHL reports a cancel
--     after the refund, and `canceled` keeps access until paid_through.
--   * A refund gives up the paid time, so a later purchase starts from today.
--
-- Patches the functions in place, as 0034 does, so the bodies from 0029 are not
-- duplicated here. Safe to re-run.

alter table public.billing_events drop constraint if exists billing_events_kind_check;
alter table public.billing_events add constraint billing_events_kind_check
    check (kind in ('payment', 'canceled', 'failed', 'refunded', 'refund_seen', 'ended'));

do $$
declare
    d text;
    was text;
begin
    select pg_get_functiondef('public._billing_process(uuid, uuid)'::regprocedure) into d;
    if position('refund_seen' in d) = 0 then
        was := d;
        d := replace(d,
$old$    elsif ev.kind in ('canceled', 'refunded') then
        if not found then$old$,
$new$    elsif ev.kind = 'refund_seen' then
        -- Flag only. A person ends the plan in /admin, or keeps it on.
        v_outcome := 'noted';
        v_detail := 'refunded in GHL; the plan stays on until someone ends it in /admin';

    elsif ev.kind in ('canceled', 'refunded') then
        if not found then$new$);
        if d = was then raise exception '_billing_process: branch not found'; end if;

        was := d;
        d := replace(d,
$old$        update public.provider_subscriptions
           set status = case when ev.kind = 'refunded' then 'refunded' else 'canceled' end,
               ghl_dirty = true, updated_at = now()
         where id = sub.id;
        v_outcome := 'applied';
$old$,
$new$        if ev.kind = 'canceled' and sub.status not in ('active', 'canceled') then
            v_outcome := 'noted';
            v_detail := 'cancel ignored: this plan is already ' || sub.status;
        else
            update public.provider_subscriptions
               set status = case when ev.kind = 'refunded' then 'refunded' else 'canceled' end,
                   paid_through = case when ev.kind = 'refunded' then least(paid_through, now()) else paid_through end,
                   ghl_dirty = true, updated_at = now()
             where id = sub.id;
            v_outcome := 'applied';
        end if;
$new$);
        if d = was then raise exception '_billing_process: update not found'; end if;
        execute d;
    end if;

    select pg_get_functiondef('public.admin_billing_overview()'::regprocedure) into d;
    if position('refund_flag' in d) = 0 then
        was := d;
        d := replace(d,
$old$                       p.tier as listing_tier
$old$,
$new$                       p.tier as listing_tier,
                       exists (select 1 from public.billing_events e
                                where e.kind = 'refund_seen' and e.outcome = 'noted'
                                  and e.provider_id = s.provider_id and e.plan = s.plan
                                  and e.created_at >= coalesce(s.last_payment_at, '-infinity'::timestamptz)) as refund_flag
$new$);
        if d = was then raise exception 'admin_billing_overview: columns not found'; end if;
        execute d;
    end if;
end $$;

-- End a paid plan now. It becomes `lapsed` with no time left, the same state as
-- a plan that ran out, so every reader of the plan already handles it.
create or replace function public.admin_end_plan(sid uuid)
returns text
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    sub public.provider_subscriptions%rowtype;
    who text;
begin
    perform public._admin_guard();
    select * into sub from public.provider_subscriptions where id = sid for update;
    if not found then raise exception 'no such plan' using errcode = '22023'; end if;
    if sub.status not in ('active', 'canceled') then
        raise exception 'this plan is already %', sub.status using errcode = '22023';
    end if;

    update public.provider_subscriptions
       set status = 'lapsed', paid_through = least(paid_through, now()), ghl_dirty = true, updated_at = now()
     where id = sid;

    select email into who from auth.users where id = auth.uid();
    insert into public.billing_events (
        event_key, kind, plan, market, provider_id, outcome, detail, resolved_at, resolved_by)
    values (
        'ended:' || sid || ':' || extract(epoch from now()), 'ended', sub.plan, sub.market, sub.provider_id,
        'applied', 'ended in /admin', now(), who);

    return public.recompute_provider_plan(sub.provider_id);
end;
$$;
revoke all on function public.admin_end_plan(uuid) from public, anon;
grant execute on function public.admin_end_plan(uuid) to authenticated;

-- Refunded rows from before this migration kept their paid time.
update public.provider_subscriptions
   set paid_through = least(paid_through, updated_at)
 where status = 'refunded' and paid_through > updated_at;
