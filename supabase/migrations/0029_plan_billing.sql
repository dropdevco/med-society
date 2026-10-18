-- Paid plans, end to end: a payment in GoHighLevel becomes a tier on the listing,
-- and stops being one when the payments stop.
--
-- The rule that makes this self-running is that ACCESS IS A FUNCTION OF DATES,
-- not of events. A clinic has the plan while `paid_through + grace` is in the
-- future. Every successful payment pushes `paid_through` out a month; nothing
-- else is needed to keep a customer on. A cancelled, failed or never-renewed
-- subscription simply runs out, so a missed "cancelled" webhook cannot leave
-- someone on a plan they stopped paying for.
--
-- Everything funnels through two functions, so the webhook, the manual
-- resolve button and the nightly sweep cannot disagree:
--   apply_billing_event(...)     one payment/cancel/refund from GHL  (service role)
--   recompute_provider_plan(id)  providers.tier from the subscriptions
--
-- Tier columns stay unwritable by clients (0003's column grants); only these
-- SECURITY DEFINER functions touch them.
--
-- Run in: Supabase dashboard -> SQL editor.

-- ── Matching keys ────────────────────────────────────────────────────────────
-- GHL contacts and our rows rarely agree on format ("Dr.Ana@Gmail.com" vs
-- "ana@gmail.com", "+52 664 123 4567" vs "6641234567"). Matching is always done
-- on these keys, never on the raw strings.
create or replace function public.billing_email_key(e text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
    select case
        when l is null or l !~ '^[^@[:space:]]+@[^@[:space:]]+$' then null
        -- Gmail ignores dots and +tags in the local part; nobody else is assumed to.
        when split_part(l, '@', 2) in ('gmail.com', 'googlemail.com')
            then replace(split_part(split_part(l, '@', 1), '+', 1), '.', '') || '@gmail.com'
        else l
    end
    from (select nullif(lower(btrim(coalesce(e, ''))), '') as l) x;
$$;

-- Same last-10-digits key the border-health matcher already uses, so the
-- listing's phone_norm column lines up with it.
create or replace function public.billing_phone_key(p text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
    select case when length(d) >= 10 then right(d, 10) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- How long after `paid_through` a clinic keeps the plan. Covers a late card
-- retry or a renewal webhook that arrives a day behind.
create or replace function public.billing_grace()
returns interval
language sql
immutable
set search_path = pg_temp
as $$ select interval '4 days'; $$;

-- ── What we remember to restore a badge ──────────────────────────────────────
-- `verified` means "paid" while subscribed, but the directory also carries it
-- for other reasons. Remember the pre-plan value so a lapse puts it back
-- instead of stripping a badge the listing had before it ever paid.
alter table public.providers
    add column if not exists verified_base boolean;

-- ── Subscriptions ────────────────────────────────────────────────────────────
create table if not exists public.provider_subscriptions (
    id                  uuid primary key default gen_random_uuid(),
    provider_id         uuid not null references public.providers (id) on delete cascade,
    plan                text not null check (plan in ('promoted', 'featured')),
    market              text check (market in ('us', 'mx')),
    -- active: paying. canceled: told us to stop, keeps access until paid_through.
    -- lapsed: ran out. refunded: money returned, access ended. comp: granted by us.
    status              text not null default 'active'
                        check (status in ('active', 'canceled', 'refunded', 'lapsed', 'comp')),
    paid_through        timestamptz,
    last_payment_at     timestamptz,
    last_amount         numeric,
    currency            text,
    payer_email         text,
    payer_email_key     text,
    payer_phone         text,
    ghl_contact_id      text,
    ghl_subscription_id text,
    -- GHL is told about every state change; this is the retry queue for it.
    ghl_dirty           boolean not null default true,
    ghl_synced_at       timestamptz,
    ghl_error           text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (provider_id, plan)
);

create index if not exists provider_subscriptions_email_idx on public.provider_subscriptions (payer_email_key);
create index if not exists provider_subscriptions_contact_idx on public.provider_subscriptions (ghl_contact_id);
create index if not exists provider_subscriptions_sub_idx on public.provider_subscriptions (ghl_subscription_id);
create index if not exists provider_subscriptions_dirty_idx on public.provider_subscriptions (ghl_dirty) where ghl_dirty;
create index if not exists provider_subscriptions_paid_through_idx on public.provider_subscriptions (paid_through);

-- ── Checkout intents ─────────────────────────────────────────────────────────
-- Recorded when a signed-in owner clicks Subscribe. It is the only thing that
-- ties an anonymous GHL payment page to a listing: when the payment arrives we
-- look for the intent with the payer's email.
create table if not exists public.plan_checkouts (
    id          uuid primary key default gen_random_uuid(),
    provider_id uuid not null references public.providers (id) on delete cascade,
    user_id     uuid not null references auth.users (id) on delete cascade,
    plan        text not null check (plan in ('promoted', 'featured')),
    market      text not null check (market in ('us', 'mx')),
    email       text not null,
    email_key   text not null,
    created_at  timestamptz not null default now(),
    consumed_at timestamptz
);
create index if not exists plan_checkouts_email_idx on public.plan_checkouts (email_key, created_at desc);

-- ── Event ledger ─────────────────────────────────────────────────────────────
-- Every webhook, matched or not, with what we decided. `event_key` makes GHL's
-- retries harmless.
create table if not exists public.billing_events (
    id                  uuid primary key default gen_random_uuid(),
    event_key           text not null unique,
    kind                text not null check (kind in ('payment', 'canceled', 'failed', 'refunded')),
    plan                text check (plan in ('promoted', 'featured')),
    market              text check (market in ('us', 'mx')),
    payer_email         text,
    payer_phone         text,
    ghl_contact_id      text,
    ghl_subscription_id text,
    amount              numeric,
    currency            text,
    product             text,
    provider_id         uuid references public.providers (id) on delete set null,
    outcome             text not null default 'received',
    match_method        text,
    detail              text,
    payload             jsonb,
    created_at          timestamptz not null default now(),
    resolved_at         timestamptz,
    resolved_by         text
);
create index if not exists billing_events_created_idx on public.billing_events (created_at desc);
create index if not exists billing_events_open_idx on public.billing_events (created_at desc)
    where outcome in ('unmatched', 'ambiguous');

alter table public.provider_subscriptions enable row level security;
alter table public.plan_checkouts enable row level security;
alter table public.billing_events enable row level security;
revoke all on public.provider_subscriptions, public.plan_checkouts, public.billing_events from anon, authenticated;

-- ── Does this subscription grant the plan right now? ─────────────────────────
create or replace function public.sub_grants_access(s public.provider_subscriptions)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
    select s.status = 'comp'
        or (s.status in ('active', 'canceled')
            and s.paid_through is not null
            and s.paid_through + public.billing_grace() > now());
$$;

-- ── Subscriptions → providers.tier ───────────────────────────────────────────
create or replace function public.recompute_provider_plan(pid uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    want text;
begin
    select case max(case s.plan when 'featured' then 2 when 'promoted' then 1 else 0 end)
               when 2 then 'featured'
               when 1 then 'promoted'
               else 'basic'
           end
      into want
      from public.provider_subscriptions s
     where s.provider_id = pid and public.sub_grants_access(s);

    want := coalesce(want, 'basic');

    update public.providers p
       set tier = want,
           promoted = (want <> 'basic'),
           -- Going paid: remember the old badge and show it. Going free: put it back.
           verified_base = case when p.tier = 'basic' and want <> 'basic' then p.verified else p.verified_base end,
           verified = case when want <> 'basic' then true
                           when p.tier <> 'basic' then coalesce(p.verified_base, p.verified)
                           else p.verified end
     where p.id = pid
       and (p.tier is distinct from want or p.promoted is distinct from (want <> 'basic'));

    return want;
end;
$$;
revoke all on function public.recompute_provider_plan(uuid) from public, anon, authenticated;
grant execute on function public.recompute_provider_plan(uuid) to service_role;

-- ── Which listing did this payment belong to? ────────────────────────────────
-- Strongest signal first; the first stage that finds exactly one listing wins,
-- and a stage that finds several stops the search (a guess between two clinics
-- is worse than a person looking at it).
create or replace function public._billing_match(ev public.billing_events, out pid uuid, out method text, out why text, out matched_plan text)
language plpgsql
stable
set search_path = public, auth, pg_temp
as $$
declare
    ekey  text := public.billing_email_key(ev.payer_email);
    pkey  text := public.billing_phone_key(ev.payer_phone);
    cands uuid[];
    intent record;
begin
    -- 1. The subscription id GHL itself uses: unambiguous when present.
    if ev.ghl_subscription_id is not null then
        select array_agg(distinct provider_id) into cands
          from public.provider_subscriptions where ghl_subscription_id = ev.ghl_subscription_id;
        if cardinality(cands) = 1 then pid := cands[1]; method := 'subscription_id'; return; end if;
    end if;

    -- 2. A fresh, unused checkout click with this email: a new purchase for the
    --    listing they clicked from. Skipped when that listing already has this
    --    plan in good standing, so a renewal is never mistaken for a purchase.
    if ekey is not null then
        select c.* into intent
          from public.plan_checkouts c
         where c.email_key = ekey
           and c.consumed_at is null
           and c.created_at > now() - interval '2 days'
           and (ev.plan is null or c.plan = ev.plan)
           and not exists (
               select 1 from public.provider_subscriptions s
                where s.provider_id = c.provider_id and s.plan = c.plan
                  and public.sub_grants_access(s) and s.paid_through > now() + interval '7 days')
         order by c.created_at desc
         limit 1;
        if found then
            pid := intent.provider_id; method := 'checkout'; matched_plan := intent.plan; return;
        end if;
    end if;

    -- 3. A contact we have already seen pay.
    if ev.ghl_contact_id is not null then
        select array_agg(distinct provider_id) into cands
          from public.provider_subscriptions where ghl_contact_id = ev.ghl_contact_id;
        if cardinality(cands) = 1 then pid := cands[1]; method := 'contact_id'; return;
        elsif cardinality(cands) > 1 then why := 'contact pays for several listings'; return; end if;
    end if;

    -- 4. An email that has paid before.
    if ekey is not null then
        select array_agg(distinct provider_id) into cands
          from public.provider_subscriptions where payer_email_key = ekey;
        if cardinality(cands) = 1 then pid := cands[1]; method := 'payer_email'; return;
        elsif cardinality(cands) > 1 then why := 'payer email pays for several listings'; return; end if;

        -- 5. The email of someone who owns a listing.
        select array_agg(distinct o.provider_id) into cands
          from public.provider_owners o
          join auth.users u on u.id = o.user_id
          join public.providers p on p.id = o.provider_id and p.status in ('live', 'pending')
         where public.billing_email_key(u.email) = ekey;
        if cardinality(cands) = 1 then pid := cands[1]; method := 'owner_email'; return;
        elsif cardinality(cands) > 1 then why := 'payer owns several listings and clicked none'; return; end if;

        -- 6. The listing's own public email.
        select array_agg(distinct id) into cands
          from public.providers where status in ('live', 'pending') and public.billing_email_key(email) = ekey;
        if cardinality(cands) = 1 then pid := cands[1]; method := 'listing_email'; return;
        elsif cardinality(cands) > 1 then why := 'email is on several listings'; return; end if;
    end if;

    -- 7. The listing's phone, last ten digits.
    if pkey is not null then
        select array_agg(distinct id) into cands
          from public.providers where status in ('live', 'pending') and phone_norm = pkey;
        if cardinality(cands) = 1 then pid := cands[1]; method := 'listing_phone'; return;
        elsif cardinality(cands) > 1 then why := 'phone is on several listings'; return; end if;
    end if;

    why := 'no listing matches the payer email or phone';
end;
$$;
revoke all on function public._billing_match(public.billing_events) from public, anon, authenticated;

-- ── Process one stored event ─────────────────────────────────────────────────
create or replace function public._billing_process(eid uuid, forced uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
    ev        public.billing_events%rowtype;
    m         record;
    pid       uuid;
    method    text;
    why       text;
    pl        text;
    sub       public.provider_subscriptions%rowtype;
    v_outcome text;
    v_detail  text;
    tier      text;
begin
    select * into ev from public.billing_events where id = eid;
    if not found then return jsonb_build_object('outcome', 'missing'); end if;

    if forced is not null then
        pid := forced; method := 'manual';
        if not exists (select 1 from public.providers where id = forced) then
            return jsonb_build_object('outcome', 'error', 'detail', 'no such listing');
        end if;
        pl := ev.plan;
    else
        select * into m from public._billing_match(ev);
        pid := m.pid; method := m.method; why := m.why; pl := coalesce(ev.plan, m.matched_plan);
    end if;

    if pid is null then
        update public.billing_events
           set outcome = case when why like '%several%' then 'ambiguous' else 'unmatched' end,
               detail = why, provider_id = null
         where id = eid;
        return jsonb_build_object('outcome', case when why like '%several%' then 'ambiguous' else 'unmatched' end,
                                  'detail', why, 'event_id', eid);
    end if;

    -- No plan on the event: fall back to the only plan this listing has had.
    if pl is null then
        select plan into pl from public.provider_subscriptions
         where provider_id = pid
         order by (status in ('active', 'canceled')) desc, updated_at desc limit 1;
    end if;
    if pl is null then
        update public.billing_events
           set outcome = 'unmatched', detail = 'listing found but the plan is unknown', provider_id = pid, match_method = method
         where id = eid;
        return jsonb_build_object('outcome', 'unmatched', 'detail', 'plan unknown', 'provider_id', pid, 'event_id', eid);
    end if;

    select * into sub from public.provider_subscriptions where provider_id = pid and plan = pl for update;

    if ev.kind = 'payment' then
        if found and sub.status = 'active' and sub.last_payment_at > now() - interval '20 days' then
            -- A monthly plan is not paid twice in three weeks. GHL fires several
            -- events for one charge (order, invoice, payment); extending on each
            -- would hand out free months.
            v_outcome := 'duplicate_period';
            v_detail := 'already paid ' || to_char(sub.last_payment_at, 'YYYY-MM-DD');
            update public.provider_subscriptions
               set ghl_contact_id = coalesce(ev.ghl_contact_id, ghl_contact_id),
                   ghl_subscription_id = coalesce(ev.ghl_subscription_id, ghl_subscription_id),
                   updated_at = now()
             where id = sub.id;
        else
            insert into public.provider_subscriptions as s (
                provider_id, plan, market, status, paid_through, last_payment_at, last_amount, currency,
                payer_email, payer_email_key, payer_phone, ghl_contact_id, ghl_subscription_id, ghl_dirty)
            values (
                pid, pl, ev.market, 'active', now() + interval '1 month', now(), ev.amount, ev.currency,
                ev.payer_email, public.billing_email_key(ev.payer_email), ev.payer_phone,
                ev.ghl_contact_id, ev.ghl_subscription_id, true)
            on conflict (provider_id, plan) do update
               set status = 'active',
                   -- Renewing early extends from the current end, not from today.
                   paid_through = greatest(coalesce(s.paid_through, now()), now()) + interval '1 month',
                   last_payment_at = now(),
                   last_amount = coalesce(excluded.last_amount, s.last_amount),
                   currency = coalesce(excluded.currency, s.currency),
                   market = coalesce(excluded.market, s.market),
                   payer_email = coalesce(excluded.payer_email, s.payer_email),
                   payer_email_key = coalesce(excluded.payer_email_key, s.payer_email_key),
                   payer_phone = coalesce(excluded.payer_phone, s.payer_phone),
                   ghl_contact_id = coalesce(excluded.ghl_contact_id, s.ghl_contact_id),
                   ghl_subscription_id = coalesce(excluded.ghl_subscription_id, s.ghl_subscription_id),
                   ghl_dirty = true,
                   updated_at = now();
            v_outcome := 'applied';
            update public.plan_checkouts
               set consumed_at = now()
             where id = (select id from public.plan_checkouts
                          where provider_id = pid and plan = pl and consumed_at is null
                          order by created_at desc limit 1);
        end if;

    elsif ev.kind in ('canceled', 'refunded') then
        if not found then
            update public.billing_events
               set outcome = 'unmatched', detail = ev.kind || ' for a plan this listing does not have',
                   provider_id = pid, match_method = method
             where id = eid;
            return jsonb_build_object('outcome', 'unmatched', 'detail', 'no such subscription', 'provider_id', pid, 'event_id', eid);
        end if;
        update public.provider_subscriptions
           set status = case when ev.kind = 'refunded' then 'refunded' else 'canceled' end,
               ghl_dirty = true, updated_at = now()
         where id = sub.id;
        v_outcome := 'applied';

    else  -- 'failed': nothing to change, the plan runs out by itself if it stays unpaid.
        v_outcome := 'noted';
        v_detail := 'payment failed; access continues until ' ||
                  coalesce(to_char(sub.paid_through + public.billing_grace(), 'YYYY-MM-DD'), 'n/a');
    end if;

    tier := public.recompute_provider_plan(pid);

    update public.billing_events
       set outcome = v_outcome, detail = coalesce(v_detail, public.billing_events.detail), provider_id = pid,
           plan = pl, match_method = method
     where id = eid;

    select * into sub from public.provider_subscriptions where provider_id = pid and plan = pl;
    return jsonb_build_object(
        'outcome', v_outcome, 'event_id', eid, 'provider_id', pid, 'plan', pl, 'tier', tier,
        'match_method', method, 'subscription_id', sub.id,
        'paid_through', sub.paid_through, 'ghl_contact_id', sub.ghl_contact_id);
end;
$$;
revoke all on function public._billing_process(uuid, uuid) from public, anon, authenticated;

-- ── Entry point for the webhook ──────────────────────────────────────────────
create or replace function public.apply_billing_event(
    p_event_key text, p_kind text, p_plan text, p_market text,
    p_email text, p_phone text, p_contact_id text, p_subscription_id text,
    p_amount numeric, p_currency text, p_product text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare eid uuid;
begin
    insert into public.billing_events (
        event_key, kind, plan, market, payer_email, payer_phone, ghl_contact_id, ghl_subscription_id,
        amount, currency, product, payload)
    values (
        p_event_key, p_kind, nullif(p_plan, ''), nullif(p_market, ''), nullif(btrim(p_email), ''),
        nullif(btrim(p_phone), ''), nullif(p_contact_id, ''), nullif(p_subscription_id, ''),
        p_amount, nullif(p_currency, ''), nullif(p_product, ''), p_payload)
    on conflict (event_key) do nothing
    returning id into eid;

    if eid is null then
        return jsonb_build_object('outcome', 'duplicate');
    end if;
    return public._billing_process(eid, null);
end;
$$;
revoke all on function public.apply_billing_event(text, text, text, text, text, text, text, text, numeric, text, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.apply_billing_event(text, text, text, text, text, text, text, text, numeric, text, text, jsonb)
    to service_role;

-- ── Nightly: let unpaid plans run out ────────────────────────────────────────
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
         where s.status in ('active', 'canceled')
           and s.paid_through is not null
           and s.paid_through + public.billing_grace() <= now()
        returning s.provider_id, s.plan
    )
    select l.provider_id, l.plan from lapsed l;

    -- Also repairs any provider whose tier drifted from its subscriptions.
    perform public.recompute_provider_plan(x.provider_id)
       from (select distinct s2.provider_id from public.provider_subscriptions s2) x;
end;
$$;
revoke all on function public.billing_expire() from public, anon, authenticated;
grant execute on function public.billing_expire() to service_role;

-- ── GHL sync queue ───────────────────────────────────────────────────────────
-- `active_plans` is every plan this contact currently holds across ALL its
-- listings, so lapsing one clinic never strips a tag another still earns.
create or replace function public.billing_pending_ghl(lim int default 25)
returns table (
    id uuid, provider_id uuid, provider_name text, plan text, market text, status text,
    paid_through timestamptz, payer_email text, payer_phone text, ghl_contact_id text,
    active_plans text[])
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select s.id, s.provider_id, p.name, s.plan, s.market, s.status, s.paid_through,
           s.payer_email, s.payer_phone, s.ghl_contact_id,
           coalesce((
               select array_agg(distinct o.plan)
                 from public.provider_subscriptions o
                where public.sub_grants_access(o)
                  and ((s.ghl_contact_id is not null and o.ghl_contact_id = s.ghl_contact_id)
                       or o.id = s.id)
           ), '{}')
      from public.provider_subscriptions s
      join public.providers p on p.id = s.provider_id
     where s.ghl_dirty
     order by s.updated_at
     limit greatest(lim, 1);
$$;
revoke all on function public.billing_pending_ghl(int) from public, anon, authenticated;
grant execute on function public.billing_pending_ghl(int) to service_role;

create or replace function public.billing_mark_synced(sid uuid, ok boolean, err text default null, contact_id text default null)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    update public.provider_subscriptions
       set ghl_dirty = not ok,
           ghl_synced_at = case when ok then now() else ghl_synced_at end,
           ghl_error = case when ok then null else left(err, 300) end,
           ghl_contact_id = coalesce(contact_id, ghl_contact_id)
     where id = sid;
$$;
revoke all on function public.billing_mark_synced(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.billing_mark_synced(uuid, boolean, text, text) to service_role;

-- ── Called from the browser ──────────────────────────────────────────────────
create or replace function public.start_plan_checkout(p_provider uuid, p_plan text, p_market text)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare mail text;
begin
    if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
    if not public.owns_provider(p_provider) then raise exception 'not your listing' using errcode = '42501'; end if;
    if p_plan not in ('promoted', 'featured') or p_market not in ('us', 'mx') then
        raise exception 'bad plan' using errcode = '22023';
    end if;
    select email into mail from auth.users where id = auth.uid();
    insert into public.plan_checkouts (provider_id, user_id, plan, market, email, email_key)
    values (p_provider, auth.uid(), p_plan, p_market, mail, public.billing_email_key(mail));
end;
$$;
revoke all on function public.start_plan_checkout(uuid, text, text) from public, anon;
grant execute on function public.start_plan_checkout(uuid, text, text) to authenticated;

-- What the Plan tab shows. Owners only; no payer details leave the database.
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
                'market', s.market, 'access', public.sub_grants_access(s))
                order by s.updated_at desc)
              from public.provider_subscriptions s where s.provider_id = p_provider), '[]'::jsonb)
    else '[]'::jsonb end;
$$;
revoke all on function public.my_plan_status(uuid) from public, anon;
grant execute on function public.my_plan_status(uuid) to authenticated;

-- ── Admin: see it, fix it ────────────────────────────────────────────────────
create or replace function public.admin_billing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_temp
as $$
begin
    perform public._admin_guard();
    return jsonb_build_object(
        'generated_at', now(),
        'subscriptions', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.paid_through desc nulls last)
              from (
                select s.id, s.provider_id, p.name as provider_name, p.city, s.plan, s.market, s.status,
                       s.paid_through, s.last_payment_at, s.last_amount, s.currency, s.payer_email,
                       s.ghl_contact_id, s.ghl_dirty, s.ghl_error, public.sub_grants_access(s) as access,
                       p.tier as listing_tier
                  from public.provider_subscriptions s join public.providers p on p.id = s.provider_id
              ) t), '[]'),
        'needs_attention', coalesce((
            select jsonb_agg(to_jsonb(e) order by e.created_at desc)
              from (select id, created_at, kind, plan, market, payer_email, payer_phone, ghl_contact_id,
                           amount, currency, product, outcome, detail
                      from public.billing_events where outcome in ('unmatched', 'ambiguous') and resolved_at is null
                     order by created_at desc limit 100) e), '[]'),
        'recent_events', coalesce((
            select jsonb_agg(to_jsonb(e) order by e.created_at desc)
              from (select ev.id, ev.created_at, ev.kind, ev.plan, ev.market, ev.payer_email, ev.outcome,
                           ev.match_method, ev.detail, p.name as provider_name
                      from public.billing_events ev left join public.providers p on p.id = ev.provider_id
                     order by ev.created_at desc limit 50) e), '[]'),
        'tier_drift', coalesce((
            -- Listings whose tier disagrees with their subscriptions: should always be empty.
            select jsonb_agg(jsonb_build_object('provider_id', p.id, 'name', p.name, 'tier', p.tier))
              from public.providers p
             where p.tier <> coalesce((
                    select case max(case s.plan when 'featured' then 2 else 1 end) when 2 then 'featured' else 'promoted' end
                      from public.provider_subscriptions s where s.provider_id = p.id and public.sub_grants_access(s)), 'basic')
               and exists (select 1 from public.provider_subscriptions s where s.provider_id = p.id)), '[]')
    );
end;
$$;
revoke all on function public.admin_billing_overview() from public, anon;
grant execute on function public.admin_billing_overview() to authenticated;

-- Attach an unmatched payment to a listing by hand. The payer's email is stored
-- on the subscription, so every later renewal matches on its own.
create or replace function public.admin_resolve_billing_event(eid uuid, pid uuid, p_plan text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare r jsonb;
begin
    perform public._admin_guard();
    if p_plan is not null then
        if p_plan not in ('promoted', 'featured') then raise exception 'bad plan' using errcode = '22023'; end if;
        update public.billing_events set plan = p_plan where id = eid and plan is null;
    end if;
    r := public._billing_process(eid, pid);
    update public.billing_events
       set resolved_at = now(), resolved_by = (select email from auth.users where id = auth.uid())
     where id = eid and outcome in ('applied', 'duplicate_period', 'noted');
    return r;
end;
$$;
revoke all on function public.admin_resolve_billing_event(uuid, uuid, text) from public, anon;
grant execute on function public.admin_resolve_billing_event(uuid, uuid, text) to authenticated;

-- Give a listing a plan without a payment (a partner, a pilot). No end date.
create or replace function public.admin_set_comp(pid uuid, p_plan text, on_ boolean default true)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    perform public._admin_guard();
    if p_plan not in ('promoted', 'featured') then raise exception 'bad plan' using errcode = '22023'; end if;
    if on_ then
        insert into public.provider_subscriptions (provider_id, plan, status, ghl_dirty)
        values (pid, p_plan, 'comp', false)
        on conflict (provider_id, plan) do update set status = 'comp', updated_at = now();
    else
        update public.provider_subscriptions set status = 'lapsed', updated_at = now()
         where provider_id = pid and plan = p_plan and status = 'comp';
    end if;
    return public.recompute_provider_plan(pid);
end;
$$;
revoke all on function public.admin_set_comp(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_comp(uuid, text, boolean) to authenticated;
