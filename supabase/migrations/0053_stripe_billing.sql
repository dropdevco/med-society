-- 0053: Stripe billing.
--
-- Payments move from GoHighLevel payment links to Stripe (Checkout to buy, the
-- customer portal to switch or cancel). Stripe webhooks arrive at api/billing.ts
-- and are applied here. GHL stays as the CRM: provider_subscriptions.ghl_dirty
-- still queues the tag/note mirror, so contacts, tags and the site-setup email
-- keep working.
--
-- Design (see the plan in the conversation):
--   * One Stripe customer per listing. The listing id travels with the checkout
--     (client_reference_id), so there is no guessing: no email/phone matching.
--   * One Stripe subscription has exactly one live plan row. When a payment for a
--     different plan arrives on the same subscription (upgrade, or the renewal
--     after a scheduled downgrade), the old plan's row ends and the new one starts.
--   * `paid_through` is Stripe's own period end, not now() + 1 month. A prorated
--     upgrade charge mid-cycle therefore does not move the renewal date, and the
--     20-day duplicate guard of the GHL path does not apply (Stripe event ids
--     already make retries harmless).
--   * A plan cancelled in the portal is "cancel at period end": status
--     'canceled' keeps access until paid_through. Undoing it sets it back to
--     'active' ('resumed').
--
-- Nothing here changes the GHL path (apply_billing_event). It is removed at
-- cutover, together with plan_checkouts and start_plan_checkout.
--
-- Safe to re-run.

-- ── Columns ──────────────────────────────────────────────────────────────────
alter table public.provider_subscriptions
    add column if not exists stripe_customer_id     text,
    add column if not exists stripe_subscription_id text,
    add column if not exists stripe_price_id        text;

create index if not exists provider_subscriptions_stripe_cust_idx
    on public.provider_subscriptions (stripe_customer_id) where stripe_customer_id is not null;
create index if not exists provider_subscriptions_stripe_sub_idx
    on public.provider_subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

alter table public.billing_events
    add column if not exists stripe_customer_id     text,
    add column if not exists stripe_subscription_id text;

alter table public.billing_events drop constraint if exists billing_events_kind_check;
alter table public.billing_events add constraint billing_events_kind_check
    check (kind in ('payment', 'canceled', 'failed', 'refunded', 'refund_seen', 'ended', 'resumed'));

-- ── Apply one Stripe event ───────────────────────────────────────────────────
-- p_kind: payment | canceled | resumed | failed | refund_seen
--   payment      an invoice was paid: p_plan and p_period_end are required.
--   canceled     cancel at period end was set, or the subscription ended.
--   resumed      cancel at period end was undone.
--   failed       a renewal charge failed (noted only; access runs out by itself).
--   refund_seen  a charge was refunded (flagged in /admin, not applied: refunding
--                the money and ending the plan are separate decisions).
-- p_provider comes from the checkout's client_reference_id; for later events it
-- may be null and is found through the Stripe subscription id.
create or replace function public.apply_stripe_event(
    p_event_key text, p_kind text, p_provider uuid, p_plan text, p_market text,
    p_email text, p_customer_id text, p_subscription_id text, p_price_id text,
    p_amount numeric, p_currency text, p_period_end timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    eid       uuid;
    pid       uuid;
    method    text;
    pl        text;
    cands     uuid[];
    sub       public.provider_subscriptions%rowtype;
    v_outcome text;
    v_detail  text;
    tier      text;
begin
    if p_kind is null or p_kind not in ('payment', 'canceled', 'resumed', 'failed', 'refund_seen') then
        return jsonb_build_object('outcome', 'error', 'detail', 'unknown kind');
    end if;
    if p_plan is not null and p_plan not in ('promoted', 'featured') then
        return jsonb_build_object('outcome', 'error', 'detail', 'unknown plan');
    end if;

    insert into public.billing_events (
        event_key, kind, plan, market, payer_email, stripe_customer_id, stripe_subscription_id,
        amount, currency, product, provider_id)
    values (
        p_event_key, p_kind, p_plan, nullif(p_market, ''), nullif(btrim(p_email), ''),
        nullif(p_customer_id, ''), nullif(p_subscription_id, ''),
        p_amount, nullif(p_currency, ''), nullif(p_price_id, ''),
        -- Only a listing that exists: an unknown id must be recorded as unmatched, not crash.
        (select id from public.providers where id = p_provider))
    on conflict (event_key) do nothing
    returning id into eid;

    if eid is null then
        return jsonb_build_object('outcome', 'duplicate');
    end if;

    -- Which listing: the one the checkout named, else the one that holds this subscription.
    if p_provider is not null then
        if exists (select 1 from public.providers where id = p_provider) then
            pid := p_provider; method := 'listing_id';
        end if;
    elsif p_subscription_id is not null then
        select array_agg(distinct provider_id) into cands
          from public.provider_subscriptions where stripe_subscription_id = p_subscription_id;
        if cardinality(cands) = 1 then pid := cands[1]; method := 'subscription_id'; end if;
    end if;

    if pid is null then
        update public.billing_events
           set outcome = 'unmatched', detail = 'no listing for this Stripe event', provider_id = null
         where id = eid;
        return jsonb_build_object('outcome', 'unmatched', 'detail', 'no listing', 'event_id', eid);
    end if;

    -- Events after the first one carry the subscription, not always the plan.
    pl := p_plan;
    if pl is null and p_subscription_id is not null then
        select plan into pl from public.provider_subscriptions
         where provider_id = pid and stripe_subscription_id = p_subscription_id
         order by (status in ('active', 'canceled')) desc, updated_at desc limit 1;
    end if;
    if pl is null then
        update public.billing_events
           set outcome = 'unmatched', detail = 'listing found but the plan is unknown',
               provider_id = pid, match_method = method
         where id = eid;
        return jsonb_build_object('outcome', 'unmatched', 'detail', 'plan unknown', 'provider_id', pid, 'event_id', eid);
    end if;

    if p_kind = 'payment' then
        if p_period_end is null then
            update public.billing_events
               set outcome = 'unmatched', detail = 'payment without a period end', provider_id = pid, match_method = method
             where id = eid;
            return jsonb_build_object('outcome', 'unmatched', 'detail', 'no period end', 'provider_id', pid, 'event_id', eid);
        end if;

        -- One subscription, one live plan: an upgrade (or the renewal after a
        -- scheduled downgrade) ends the other plan's row on this subscription.
        if p_subscription_id is not null then
            update public.provider_subscriptions
               set status = 'lapsed', paid_through = least(coalesce(paid_through, now()), now()),
                   ghl_dirty = true, updated_at = now()
             where provider_id = pid and stripe_subscription_id = p_subscription_id
               and plan <> pl and status in ('active', 'canceled');
        end if;

        insert into public.provider_subscriptions as s (
            provider_id, plan, market, status, paid_through, last_payment_at, last_amount, currency,
            payer_email, payer_email_key, stripe_customer_id, stripe_subscription_id, stripe_price_id, ghl_dirty)
        values (
            pid, pl, nullif(p_market, ''), 'active', p_period_end, now(), p_amount, nullif(p_currency, ''),
            nullif(btrim(p_email), ''), public.billing_email_key(p_email),
            nullif(p_customer_id, ''), nullif(p_subscription_id, ''), nullif(p_price_id, ''), true)
        on conflict (provider_id, plan) do update
           set status = 'active',
               -- Never move the end backwards: an older invoice can arrive late.
               paid_through = greatest(coalesce(s.paid_through, p_period_end), p_period_end),
               last_payment_at = now(),
               last_amount = coalesce(excluded.last_amount, s.last_amount),
               currency = coalesce(excluded.currency, s.currency),
               market = coalesce(excluded.market, s.market),
               payer_email = coalesce(excluded.payer_email, s.payer_email),
               payer_email_key = coalesce(excluded.payer_email_key, s.payer_email_key),
               stripe_customer_id = coalesce(excluded.stripe_customer_id, s.stripe_customer_id),
               stripe_subscription_id = coalesce(excluded.stripe_subscription_id, s.stripe_subscription_id),
               stripe_price_id = coalesce(excluded.stripe_price_id, s.stripe_price_id),
               ghl_dirty = true,
               updated_at = now();
        v_outcome := 'applied';

    else
        select * into sub from public.provider_subscriptions
         where provider_id = pid and plan = pl
           and (p_subscription_id is null or stripe_subscription_id = p_subscription_id)
         for update;
        if not found then
            update public.billing_events
               set outcome = 'unmatched', detail = p_kind || ' for a plan this listing does not have',
                   provider_id = pid, plan = pl, match_method = method
             where id = eid;
            return jsonb_build_object('outcome', 'unmatched', 'detail', 'no such subscription', 'provider_id', pid, 'event_id', eid);
        end if;

        if p_kind = 'canceled' then
            if sub.status in ('lapsed', 'refunded') then
                v_outcome := 'noted'; v_detail := 'already ' || sub.status;
            else
                update public.provider_subscriptions
                   set status = 'canceled', paid_through = coalesce(p_period_end, paid_through),
                       ghl_dirty = true, updated_at = now()
                 where id = sub.id;
                v_outcome := 'applied';
            end if;

        elsif p_kind = 'resumed' then
            if sub.status = 'canceled' then
                update public.provider_subscriptions
                   set status = 'active', ghl_dirty = true, updated_at = now()
                 where id = sub.id;
                v_outcome := 'applied';
            else
                v_outcome := 'noted'; v_detail := 'was ' || sub.status;
            end if;

        elsif p_kind = 'failed' then
            v_outcome := 'noted';
            v_detail := 'payment failed; access continues until ' ||
                        coalesce(to_char(sub.paid_through + public.billing_grace(), 'YYYY-MM-DD'), 'n/a');

        else  -- refund_seen: flagged for /admin, never applied here.
            v_outcome := 'noted';
            v_detail := 'refund seen; end the plan from /admin > Billing if that is intended';
        end if;
    end if;

    tier := public.recompute_provider_plan(pid);

    update public.billing_events
       set outcome = v_outcome, detail = v_detail, provider_id = pid, plan = pl, match_method = method
     where id = eid;

    select * into sub from public.provider_subscriptions where provider_id = pid and plan = pl;
    return jsonb_build_object(
        'outcome', v_outcome, 'event_id', eid, 'provider_id', pid, 'plan', pl, 'tier', tier,
        'match_method', method, 'subscription_id', sub.id, 'paid_through', sub.paid_through);
end;
$$;
revoke all on function public.apply_stripe_event(text, text, uuid, text, text, text, text, text, text, numeric, text, timestamptz)
    from public, anon, authenticated;
grant execute on function public.apply_stripe_event(text, text, uuid, text, text, text, text, text, text, numeric, text, timestamptz)
    to service_role;

-- ── The Plan tab ─────────────────────────────────────────────────────────────
-- Same shape as before plus `stripe`: true when this plan is paid through Stripe,
-- so the tab can offer "Manage plan" (the customer portal).
create or replace function public.my_plan_status(p_provider uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select case when public.owns_provider(p_provider) then
        coalesce((
            select jsonb_agg(jsonb_build_object(
                'plan', s.plan, 'status', s.status, 'paid_through', s.paid_through,
                'market', s.market, 'access', public.sub_grants_access(s),
                'stripe', s.stripe_customer_id is not null)
                order by s.updated_at desc)
              from public.provider_subscriptions s where s.provider_id = p_provider), '[]'::jsonb)
    else '[]'::jsonb end;
$$;
revoke all on function public.my_plan_status(uuid) from public, anon;
grant execute on function public.my_plan_status(uuid) to authenticated;
