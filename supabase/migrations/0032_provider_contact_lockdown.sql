-- Stop anonymous bulk harvesting of provider contact data.
--
-- The browser talks to Supabase with the public anon key, which is bundled in
-- the JS. Until now that key could `select=*` on public.providers and page out
-- every live row WITH its e-mail, phone, website and socials (12.6k rows in a
-- handful of requests), and read provider_details.phones the same way. Names,
-- addresses and licences are personal data under Mexico's LFPDPPP; e-mails and
-- phones of sole practitioners are the part a scraper actually wants.
--
-- What changes
--   1. Column-level SELECT. anon and authenticated lose table-wide SELECT on
--      public.providers and get it back column by column, MINUS the contact
--      columns (email, phone, website, socials), the normalised phone used for
--      matching (phone_norm) and updated_by (an auth.users id). The directory
--      is unaffected: provider_list is a security_invoker view that never
--      selected any of them. services stays readable because that view builds
--      service_names from it; it is the clinic's public price list, not contact
--      data (see "Left alone" below).
--   2. provider_details.phones gets the same treatment (the rest of that table
--      is public profile text).
--   3. provider_public(id): the one door to ONE provider's full public row,
--      contact fields included, so a provider page looks exactly as before. It
--      is SECURITY DEFINER, counts calls per client IP (90/minute, 1500/hour)
--      and answers HTTP 429 beyond that. Harvesting 12.6k profiles through it
--      means 12.6k throttled requests instead of a handful of unthrottled
--      pages. It is a speed bump plus a single place to add a stronger gate
--      (captcha token, signed-in only) later - not an absolute barrier.
--   4. my_providers(ids): the owner's own listings with every column (their
--      dashboard edits the contact fields), only for rows the caller manages.
--
-- Because a column-level revoke makes `select *` fail for anon/authenticated,
-- the browser reads that used `select('*')` on providers were moved to the two
-- functions above in the same change (useProvider, ClaimPage, useMyClinic) and
-- api/agent.ts' detail lookup. Anything new that reads providers from the
-- browser must list columns explicitly or go through provider_public.
--
-- Left alone on purpose (product decisions, not plumbing)
--   * services/prices stay bulk-readable; moving them behind the RPC means
--     making provider_list a definer view or materialising service_names.
--   * The clinic e-mail is still returned by provider_public and shown on the
--     profile page. Dropping it is one line (remove it from the jsonb below)
--     plus the DetailRow in ProviderView.
--   * Postgres columns added later are NOT readable by anon until granted -
--     the safe default, but add a grant when a new public column is needed
--     (and re-create provider_list if it should expose it).
--
-- Depends on public.manages_provider (clinic teams). Run in: Supabase
-- dashboard -> SQL editor (or apply_migration).

-- ── 1. providers: contact columns off the public grant ──────────────────────
revoke select on public.providers from anon, authenticated;

do $$
declare
    cols text;
begin
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'providers'
       and column_name not in ('email', 'phone', 'phone_norm', 'website', 'socials', 'updated_by');
    execute format('grant select (%s) on public.providers to anon, authenticated', cols);
end $$;

-- ── 2. provider_details: the extra phone numbers ────────────────────────────
revoke select on public.provider_details from anon, authenticated;

do $$
declare
    cols text;
begin
    select string_agg(format('%I', column_name), ', ' order by ordinal_position)
      into cols
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'provider_details'
       and column_name <> 'phones';
    execute format('grant select (%s) on public.provider_details to anon, authenticated', cols);
end $$;

-- ── 3. provider_public: one provider, contact included, throttled ───────────
-- Counters live in 1-minute buckets keyed by client IP. The key is
-- cf-connecting-ip (set by the edge in front of the API, so a caller cannot
-- choose it), else the last x-forwarded-for hop. No request headers at all
-- (SQL editor, tests) or a service-role caller: no throttling.
create table if not exists public.provider_read_throttle (
    ip     text        not null,
    minute timestamptz not null,
    n      integer     not null default 0,
    primary key (ip, minute)
);

alter table public.provider_read_throttle enable row level security;
revoke all on public.provider_read_throttle from anon, authenticated;

create or replace function public.provider_public(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
    h        jsonb := nullif(current_setting('request.headers', true), '')::jsonb;
    claims   jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v_ip     text;
    v_xff    text[];
    v_now    timestamptz := date_trunc('minute', now());
    v_minute integer;
    v_hour   integer;
    v_row    jsonb;
begin
    if h is not null and coalesce(claims ->> 'role', '') <> 'service_role' then
        v_ip := nullif(btrim(h ->> 'cf-connecting-ip'), '');
        if v_ip is null and coalesce(h ->> 'x-forwarded-for', '') <> '' then
            v_xff := regexp_split_to_array(btrim(h ->> 'x-forwarded-for'), '\s*,\s*');
            v_ip  := nullif(v_xff[array_length(v_xff, 1)], '');
        end if;
    end if;

    if v_ip is not null then
        insert into public.provider_read_throttle as t (ip, minute, n)
        values (v_ip, v_now, 1)
        on conflict (ip, minute) do update set n = t.n + 1
        returning t.n into v_minute;

        select coalesce(sum(n), 0) into v_hour
          from public.provider_read_throttle
         where ip = v_ip and minute > v_now - interval '1 hour';

        if v_minute > 90 or v_hour > 1500 then
            raise sqlstate 'PT429' using
                message = 'Too many profile requests. Try again in a minute.',
                detail  = 'rate_limited';
        end if;

        if random() < 0.01 then
            delete from public.provider_read_throttle where minute < now() - interval '2 hours';
        end if;
    end if;

    -- Live listings for everyone; a pending/hidden one only for the people who
    -- manage it (they open their own page to check it before it is reviewed).
    select to_jsonb(p) - 'updated_by' - 'phone_norm' - 'name_norm' - 'city_norm'
      into v_row
      from public.providers p
     where p.id = p_id
       and (p.status = 'live' or public.manages_provider(p.id));

    return v_row;
end;
$$;

revoke all on function public.provider_public(uuid) from public;
grant execute on function public.provider_public(uuid) to anon, authenticated;

-- ── 4. my_providers: the owner's own rows, every column ─────────────────────
-- The dashboard passes the provider ids it learnt from provider_owners; the
-- manages_provider() filter is what actually decides, exactly as the old
-- "owners read own listing" policy did.
create or replace function public.my_providers(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        jsonb_agg(to_jsonb(p) - 'updated_by' - 'phone_norm' - 'name_norm' - 'city_norm' order by p.name),
        '[]'::jsonb)
      from public.providers p
     where p.id = any (coalesce(p_ids, '{}'::uuid[]))
       and public.manages_provider(p.id);
$$;

revoke all on function public.my_providers(uuid[]) from public, anon;
grant execute on function public.my_providers(uuid[]) to authenticated;
