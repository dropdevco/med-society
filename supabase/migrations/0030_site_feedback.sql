-- Site feedback: the "Feedback" widget bottom-right of every page.
--
-- Every report is KEPT, but only some are ACTED ON. api/feedback.ts checks each
-- one before it bothers anybody (spam filter, duplicate count, errors the
-- browser itself recorded, how many other people reported the same page, then
-- a model's read of the text) and stores the outcome next to the report:
--
--   verdict    real_bug         corroborated by evidence (a recorded error on that
--                               page, or several independent reports)
--              likely_bug       plausible, but nothing backs it up yet
--              content_issue    wrong or outdated information on a listing / page
--              feature_request  an idea, not a defect
--              not_actionable   vague, off-topic or a question
--              spam
--   escalated  true only for a bug that passed the evidence rule; this is what
--              sends the email and puts the row on the admin "Needs attention" list.
--              A lone report with nothing behind it is never escalated, however
--              alarming it sounds: it waits in the admin queue (status 'new').
--
-- The table is write-only for browsers: RLS is on with no policies, so the only
-- way in is api/feedback.ts (service role), whose validation, honeypot and
-- rate limit cannot be bypassed by talking to Supabase directly. Admins read it
-- through the SECURITY DEFINER functions at the bottom (same guard as 0026).
--
-- Run in: Supabase dashboard -> SQL editor.

create table if not exists public.site_feedback (
    id              uuid primary key default gen_random_uuid(),
    created_at      timestamptz not null default now(),

    -- what the visitor sent
    kind            text not null check (kind in ('bug', 'content', 'idea', 'other')),
    message         text not null check (char_length(message) between 5 and 2000),
    contact_email   text check (contact_email is null or char_length(contact_email) <= 200),
    user_id         uuid references auth.users (id) on delete set null,
    language        text check (language in ('en', 'es')),

    -- where and on what (no query strings: searches can describe symptoms)
    page_path       text check (page_path is null or char_length(page_path) <= 200),
    page_key        text check (page_key is null or char_length(page_key) <= 200),  -- path with ids replaced by :id
    viewport        text,
    app_build       text,
    user_agent      text,
    ph_distinct_id  text,
    ip_hash         text,                       -- salted hash, never the address
    client_errors   jsonb not null default '[]'::jsonb,

    -- the checks
    fingerprint     text,
    duplicate_count integer not null default 0, -- other reports with this fingerprint in the last 7 days
    corroborated    boolean not null default false,
    verdict         text check (verdict in ('real_bug', 'likely_bug', 'content_issue', 'feature_request', 'not_actionable', 'spam')),
    confidence      smallint check (confidence between 0 and 100),
    severity        text check (severity in ('low', 'medium', 'high')),
    reason          text,
    triage_source   text check (triage_source in ('model', 'heuristic')),
    escalated       boolean not null default false,
    notified_at     timestamptz,

    -- the team's side
    status          text not null default 'new' check (status in ('new', 'open', 'resolved', 'dismissed')),
    admin_note      text,
    resolved_at     timestamptz
);

create index if not exists site_feedback_created_idx     on public.site_feedback (created_at desc);
create index if not exists site_feedback_ip_idx          on public.site_feedback (ip_hash, created_at desc);
create index if not exists site_feedback_fingerprint_idx on public.site_feedback (fingerprint, created_at desc);
create index if not exists site_feedback_page_idx        on public.site_feedback (page_key, created_at desc);
create index if not exists site_feedback_attention_idx   on public.site_feedback (created_at desc)
    where escalated and status in ('new', 'open');

alter table public.site_feedback enable row level security;
revoke all on public.site_feedback from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin dashboard (/admin → Feedback)
-- ---------------------------------------------------------------------------
create or replace function public.admin_feedback_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare r jsonb;
begin
    perform public._admin_guard();

    select jsonb_build_object(
        'generated_at', now(),
        'counts', jsonb_build_object(
            'total',           (select count(*) from public.site_feedback),
            'last_30d',        (select count(*) from public.site_feedback where created_at >= now() - interval '30 days'),
            'needs_attention', (select count(*) from public.site_feedback where escalated and status in ('new', 'open')),
            'unreviewed',      (select count(*) from public.site_feedback where status = 'new' and coalesce(verdict, '') <> 'spam')
        ),
        'by_verdict', coalesce((
            select jsonb_agg(jsonb_build_object('verdict', v, 'n', n) order by n desc)
            from (
                select coalesce(verdict, 'untriaged') as v, count(*) as n
                from public.site_feedback
                where created_at >= now() - interval '30 days'
                group by 1
            ) x), '[]'::jsonb),
        'items', coalesce((
            select jsonb_agg(to_jsonb(i) order by i.created_at desc)
            from (
                select f.id, f.created_at, f.kind, f.message, f.page_path, f.language,
                       f.contact_email, u.email as account_email,
                       f.viewport, f.app_build, f.user_agent, f.client_errors,
                       f.verdict, f.confidence, f.severity, f.reason, f.triage_source,
                       f.corroborated, f.duplicate_count, f.escalated, f.notified_at,
                       f.status, f.admin_note, f.resolved_at
                from public.site_feedback f
                left join auth.users u on u.id = f.user_id
                order by f.created_at desc
                limit 300
            ) i), '[]'::jsonb)
    ) into r;

    return r;
end;
$$;
revoke all on function public.admin_feedback_overview() from public, anon;
grant execute on function public.admin_feedback_overview() to authenticated;

create or replace function public.admin_feedback_set_status(fid uuid, new_status text, note text default null)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
begin
    perform public._admin_guard();

    if new_status not in ('new', 'open', 'resolved', 'dismissed') then
        raise exception 'bad status' using errcode = '22023';
    end if;

    update public.site_feedback
       set status      = new_status,
           admin_note  = coalesce(nullif(btrim(note), ''), admin_note),
           resolved_at = case when new_status in ('resolved', 'dismissed') then now() else null end
     where id = fid;
end;
$$;
revoke all on function public.admin_feedback_set_status(uuid, text, text) from public, anon;
grant execute on function public.admin_feedback_set_status(uuid, text, text) to authenticated;
