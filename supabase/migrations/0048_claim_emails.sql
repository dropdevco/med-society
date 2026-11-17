-- Claim e-mails: an outbox the database fills and api/claim-notify.ts empties.
--
-- WHY. Production has no pg_net and no webhook on public.leads, so nothing the
-- database does today reaches anyone's inbox (see 0047's leads alert). A claim
-- moving through review must tell the claimant and the team, and that must not
-- depend on a browser tab staying open.
--
-- HOW. A trigger on provider_claims writes one row per e-mail-worthy status
-- change, in the same transaction as the change, so an event can never be
-- lost. api/claim-notify.ts sends them through GHL (e-mail decision D9: GHL,
-- not Resend). The browser pings that endpoint right after submitting or
-- deciding a claim, and a daily cron drains anything left over.
--
--   pending   (new or answered)      → claimant_received + team_new_claim
--   needs_info                        → claimant_needs_info (carries review_note)
--   approved                          → claimant_approved
--   rejected                          → claimant_rejected  (carries review_note)
--
-- An amendment (pending → pending) sends nothing. Only the service role reads
-- or writes the outbox.

begin;

create table if not exists public.claim_emails (
    id             uuid primary key default gen_random_uuid(),
    claim_id       uuid not null references public.provider_claims (id) on delete cascade,
    kind           text not null check (kind in ('claimant_received', 'team_new_claim', 'claimant_needs_info',
                                                 'claimant_approved', 'claimant_rejected')),
    created_at     timestamptz not null default now(),
    -- Set when a sender takes the row, so two senders never mail it twice.
    leased_until   timestamptz,
    attempts       int not null default 0,
    sent_at        timestamptz,
    last_error     text check (char_length(last_error) <= 500),
    ghl_message_id text
);
create index if not exists claim_emails_unsent_idx on public.claim_emails (created_at) where sent_at is null;

alter table public.claim_emails enable row level security;
revoke all on public.claim_emails from anon, authenticated;
grant all on public.claim_emails to service_role;

create or replace function public.claim_emails_enqueue()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_old text := case when tg_op = 'UPDATE' then old.status end;
begin
    if new.status is not distinct from v_old then return new; end if;
    if new.status = 'pending' then
        insert into public.claim_emails (claim_id, kind) values (new.id, 'claimant_received'), (new.id, 'team_new_claim');
    elsif new.status in ('needs_info', 'approved', 'rejected') then
        insert into public.claim_emails (claim_id, kind) values (new.id, 'claimant_' || new.status);
    end if;
    return new;
end $$;
revoke execute on function public.claim_emails_enqueue() from public, anon, authenticated;

drop trigger if exists provider_claims_enqueue_emails on public.provider_claims;
create trigger provider_claims_enqueue_emails
    after insert or update of status on public.provider_claims
    for each row execute function public.claim_emails_enqueue();

-- Take up to p_limit unsent rows for two minutes, with what the e-mail needs.
-- Five failed attempts park a row; the admin Claims tab shows the error.
create or replace function public.claim_emails_take(p_limit int default 20)
returns table (
    id uuid, kind text, claim_id uuid, attempts int,
    claimant_email text, legal_name text, claimant_role text, review_note text,
    provider_id uuid, provider_name text, provider_city text, provider_country text
)
language sql volatile security definer
set search_path = public, auth, pg_temp
as $$
    with taken as (
        update public.claim_emails e
           set leased_until = now() + interval '2 minutes', attempts = e.attempts + 1
         where e.id in (
             select x.id from public.claim_emails x
              where x.sent_at is null and x.attempts < 5
                and (x.leased_until is null or x.leased_until < now())
              order by x.created_at
              limit greatest(1, least(coalesce(p_limit, 20), 50))
              for update skip locked)
        returning e.*
    )
    select t.id, t.kind, t.claim_id, t.attempts,
           u.email, c.legal_name, c.claimant_role, c.review_note,
           p.id, p.name, p.city, p.country
      from taken t
      join public.provider_claims c on c.id = t.claim_id
      join public.providers p on p.id = c.provider_id
      left join auth.users u on u.id = c.user_id
     order by t.created_at;
$$;

create or replace function public.claim_emails_done(p_id uuid, p_ok boolean, p_message_id text default null, p_error text default null)
returns void
language sql volatile security definer
set search_path = public, pg_temp
as $$
    update public.claim_emails
       set sent_at        = case when p_ok then now() end,
           ghl_message_id = case when p_ok then left(p_message_id, 120) end,
           last_error     = case when p_ok then null else left(p_error, 500) end,
           leased_until   = null
     where id = p_id;
$$;

revoke all on function public.claim_emails_take(int) from public, anon, authenticated;
revoke all on function public.claim_emails_done(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.claim_emails_take(int) to service_role;
grant execute on function public.claim_emails_done(uuid, boolean, text, text) to service_role;

-- The review queue shows whether the claimant has actually been told.
create or replace function public.admin_claim_emails(p_claim uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
    perform public._admin_guard();
    return coalesce((select jsonb_agg(jsonb_build_object(
                'kind', kind, 'created_at', created_at, 'sent_at', sent_at,
                'attempts', attempts, 'last_error', last_error) order by created_at)
            from public.claim_emails where claim_id = p_claim), '[]');
end $$;
revoke all on function public.admin_claim_emails(uuid) from public, anon;
grant execute on function public.admin_claim_emails(uuid) to authenticated;

commit;
