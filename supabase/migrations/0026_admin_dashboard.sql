-- Admin analytics dashboard (/admin).
--
-- Access is enforced here, not in the UI: every function raises unless the
-- caller is a confirmed Supabase user whose email is in app_admins. The
-- functions are SECURITY DEFINER so they can read the write-only form tables
-- and the analytics views; nothing else gets broader access.

create table if not exists public.app_admins (
    email text primary key check (email = lower(email))
);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
insert into public.app_admins (email) values ('carlosglzg02@gmail.com') on conflict do nothing;

create or replace function public.is_app_admin()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
    select exists (
        select 1
        from auth.users u
        join public.app_admins a on a.email = lower(u.email)
        where u.id = auth.uid() and u.email_confirmed_at is not null
    );
$$;
revoke all on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

create or replace function public._admin_guard()
returns void
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
    if not public.is_app_admin() then
        raise exception 'not authorized' using errcode = '42501';
    end if;
end;
$$;
revoke all on function public._admin_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Form analytics + responses
-- ---------------------------------------------------------------------------
create or replace function public.admin_forms_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare r jsonb;
begin
    perform public._admin_guard();

    select jsonb_build_object(
        'generated_at', now(),
        'summary', coalesce((select jsonb_agg(to_jsonb(s)) from public.form_summary s), '[]'),
        'funnel', coalesce((select jsonb_agg(to_jsonb(f) order by f.form_slug, f.form_segment, f.lang, f.screen_no) from public.form_step_funnel f), '[]'),
        'by_source', coalesce((select jsonb_agg(to_jsonb(b)) from public.form_by_source b), '[]'),
        'daily', coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from public.form_daily d where d.day >= current_date - 89), '[]'),
        'audience', coalesce((select jsonb_agg(to_jsonb(a)) from public.form_audience a), '[]'),
        'responses_total', (select count(*) from public.bh_responses where session <> 'test'),
        'responses_test', (select count(*) from public.bh_responses where session = 'test'),
        'responses_by', coalesce((
            select jsonb_agg(jsonb_build_object(
                'form_slug', form_slug, 'segment', segment, 'lang', lang, 'n', n,
                'follow_up', follow_up, 'avg_duration_s', avg_s))
            from (
                select form_slug, segment, lang, count(*) n,
                       count(*) filter (where follow_up) follow_up,
                       round(avg(duration_s))::int avg_s
                from public.bh_responses where session <> 'test'
                group by 1, 2, 3
            ) x), '[]'),
        'responses_daily', coalesce((
            select jsonb_agg(jsonb_build_object('day', day, 'segment', segment, 'n', n) order by day)
            from (
                select created_at::date as day, segment, count(*) n
                from public.bh_responses
                where session <> 'test' and created_at >= current_date - 89
                group by 1, 2
            ) x), '[]'),
        'by_ref', coalesce((
            select jsonb_agg(jsonb_build_object('ref', ref, 'n', n) order by n desc)
            from (select coalesce(ref, 'link') ref, count(*) n from public.bh_responses where session <> 'test' group by 1) x), '[]'),
        'by_city', coalesce((
            select jsonb_agg(jsonb_build_object('segment', segment, 'city', city, 'n', n) order by n desc)
            from (select segment, coalesce(nullif(city, ''), '(none)') city, count(*) n from public.bh_responses where session <> 'test' group by 1, 2) x), '[]'),
        'by_industry', coalesce((
            select jsonb_agg(jsonb_build_object('segment', segment, 'industry', industry, 'n', n) order by n desc)
            from (select segment, coalesce(nullif(industry, ''), '(none)') industry, count(*) n from public.bh_responses where session <> 'test' group by 1, 2) x), '[]'),
        'outcomes', coalesce((
            select jsonb_agg(jsonb_build_object('segment', segment, 'outcome', outcome, 'n', n))
            from (select segment, coalesce(outcome, 'none') outcome, count(*) n from public.bh_responses where session <> 'test' and segment = 'provider' group by 1, 2) x), '[]'),
        -- Every answer, flattened: one row per (segment, question, option).
        'answers', coalesce((
            select jsonb_agg(jsonb_build_object('segment', segment, 'q', q, 'v', v, 'n', n))
            from (
                select segment, q, v, count(*) n
                from (
                    select b.segment, e.key q,
                           case jsonb_typeof(e.value)
                               when 'array' then x.elem
                               when 'string' then e.value #>> '{}'
                               else null
                           end v
                    from public.bh_responses b
                    cross join lateral jsonb_each(b.answers) e
                    left join lateral jsonb_array_elements_text(
                        case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end
                    ) x(elem) on true
                    where b.session <> 'test'
                      and e.key not in ('form_version', 'variant', 'utm')
                      and (jsonb_typeof(e.value) <> 'array' or x.elem is not null)
                ) y
                where v is not null and v <> '' and length(v) <= 120
                group by 1, 2, 3
            ) z), '[]'),
        'recent', coalesce((
            select jsonb_agg(to_jsonb(t))
            from (
                select id, created_at, form_slug, segment, lang, ref, session, industry, city,
                       contact_name, contact_org, contact_email, contact_phone, follow_up,
                       duration_s, outcome, answers
                from public.bh_responses
                order by created_at desc
                limit 300
            ) t), '[]')
    ) into r;

    return r;
end;
$$;
revoke all on function public.admin_forms_overview() from public, anon;
grant execute on function public.admin_forms_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- The directory, accounts and community
-- ---------------------------------------------------------------------------
create or replace function public.admin_site_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare r jsonb;
begin
    perform public._admin_guard();

    select jsonb_build_object(
        'generated_at', now(),
        'providers', jsonb_build_object(
            'total', (select count(*) from public.providers),
            'by_region', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'status', status, 'n', n))
                from (select coalesce(region, '(none)') region, status, count(*) n from public.providers group by 1, 2) x), '[]'),
            'by_region_source', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'source', source, 'n', n))
                from (select coalesce(region, '(none)') region, coalesce(source, '(none)') source, count(*) n from public.providers where status = 'live' group by 1, 2) x), '[]'),
            'by_city', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'city', city, 'n', n) order by n desc)
                from (select coalesce(region, '(none)') region, coalesce(city, '(none)') city, count(*) n from public.providers where status = 'live' group by 1, 2) x), '[]'),
            'by_specialty', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'specialty', sp, 'n', n) order by n desc)
                from (select coalesce(region, '(none)') region, s sp, count(*) n from public.providers p, unnest(coalesce(p.specialty, '{}')) s where p.status = 'live' group by 1, 2) x), '[]'),
            'by_tier', coalesce((select jsonb_agg(jsonb_build_object('tier', coalesce(tier, '(none)'), 'n', n)) from (select tier, count(*) n from public.providers where status = 'live' group by 1) x), '[]'),
            'flags', (select jsonb_build_object(
                'verified', count(*) filter (where verified),
                'promoted', count(*) filter (where promoted),
                'licensed', count(*) filter (where licensed),
                'languages_confirmed', count(*) filter (where languages_confirmed),
                'self_listed', count(*) filter (where source = 'self'),
                'pending_review', count(*) filter (where status = 'pending'),
                'hidden', count(*) filter (where status = 'hidden')) from public.providers),
            -- How much we actually know about live listings.
            'completeness', (select jsonb_build_object(
                'live', count(*),
                'phone', count(*) filter (where coalesce(phone, '') <> ''),
                'website', count(*) filter (where coalesce(website, '') <> ''),
                'email', count(*) filter (where coalesce(email, '') <> ''),
                'address', count(*) filter (where coalesce(address, '') <> ''),
                'hours', count(*) filter (where hours is not null and hours::text not in ('null', '{}', '[]')),
                'description', count(*) filter (where coalesce(description, '') <> ''),
                'photo', count(*) filter (where coalesce("imageUrl", '') <> '' or coalesce(array_length("galleryUrls", 1), 0) > 0),
                'languages', count(*) filter (where coalesce(array_length(languages, 1), 0) > 0),
                'insurances', count(*) filter (where coalesce(array_length(insurances, 1), 0) > 0),
                'services', count(*) filter (where services is not null and services::text not in ('null', '[]', '{}')),
                'socials', count(*) filter (where socials is not null and socials::text not in ('null', '{}', '[]')),
                'coordinates', count(*) filter (where lat is not null and lng is not null),
                'reviews', count(*) filter (where coalesce("reviewCount", 0) > 0),
                'detail_profile', count(*) filter (where exists (select 1 from public.provider_details d where d.provider_id = providers.id))
            ) from public.providers where status = 'live')
        ),
        'accounts', jsonb_build_object(
            'users', (select count(*) from auth.users),
            'confirmed', (select count(*) from auth.users where email_confirmed_at is not null),
            'signed_in_30d', (select count(*) from auth.users where last_sign_in_at >= now() - interval '30 days'),
            'owners', (select count(distinct user_id) from public.provider_owners),
            'claimed_listings', (select count(distinct provider_id) from public.provider_owners),
            'claims_by_status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'n', n)) from (select status, count(*) n from public.provider_claims group by 1) x), '[]'),
            'signups_daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'n', n) order by day) from (select created_at::date as day, count(*) n from auth.users where created_at >= current_date - 89 group by 1) x), '[]'),
            'claimed_by_region', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'n', n)) from (
                select coalesce(p.region, '(none)') region, count(distinct o.provider_id) n
                from public.provider_owners o join public.providers p on p.id = o.provider_id group by 1) x), '[]'),
            'invites', (select jsonb_build_object('sent', count(*), 'accepted', count(*) filter (where accepted_at is not null)) from public.provider_invites),
            'team_links', (select count(*) from public.clinic_practitioners),
            'photos', (select count(*) from public.provider_photos)
        ),
        'community', jsonb_build_object(
            'threads', (select count(*) from public.forum_threads where not hidden),
            'replies', (select count(*) from public.forum_replies),
            'inquiries', (select count(*) from public.patient_inquiries),
            'inquiries_by_status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'n', n)) from (select status, count(*) n from public.patient_inquiries group by 1) x), '[]'),
            'leads', (select count(*) from public.leads),
            'leads_by_status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'n', n)) from (select status, count(*) n from public.leads group by 1) x), '[]'),
            'recent_leads', coalesce((select jsonb_agg(to_jsonb(l)) from (select created_at, clinic, contact, email, phone, specialty, city, plan, status from public.leads order by created_at desc limit 25) l), '[]'),
            'recent_inquiries', coalesce((select jsonb_agg(to_jsonb(i)) from (select created_at, provider_name, patient_name, contact_kind, preferred_time, language, status from public.patient_inquiries order by created_at desc limit 25) i), '[]')
        ),
        'owners', coalesce((
            select jsonb_agg(to_jsonb(t) order by t.claimed_at desc)
            from (
                select p.id, p.name, p.city, p.region, p.status, u.email owner_email, o.role, o.created_at claimed_at
                from public.provider_owners o
                join public.providers p on p.id = o.provider_id
                left join auth.users u on u.id = o.user_id
            ) t), '[]')
    ) into r;

    return r;
end;
$$;
revoke all on function public.admin_site_overview() from public, anon;
grant execute on function public.admin_site_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- Clinic lookup: search, then everything we hold on one listing.
-- ---------------------------------------------------------------------------
create or replace function public.admin_provider_search(q text, lim int default 25)
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare s text := '%' || lower(trim(coalesce(q, ''))) || '%';
begin
    perform public._admin_guard();
    return coalesce((
        select jsonb_agg(to_jsonb(t))
        from (
            select p.id, p.name, p.city, p.region, p.country, p.status, p.source, p.specialty,
                   p.phone, p.website, p.verified,
                   exists (select 1 from public.provider_owners o where o.provider_id = p.id) claimed
            from public.providers p
            where length(trim(coalesce(q, ''))) >= 2
              and (lower(p.name) like s or lower(coalesce(p.email, '')) like s
                   or coalesce(p.phone_norm, '') like s or lower(coalesce(p.website, '')) like s)
            order by p.name
            limit least(greatest(coalesce(lim, 25), 1), 50)
        ) t), '[]');
end;
$$;
revoke all on function public.admin_provider_search(text, int) from public, anon;
grant execute on function public.admin_provider_search(text, int) to authenticated;

create or replace function public.admin_provider_detail(pid uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
    perform public._admin_guard();
    return (
        select jsonb_build_object(
            'provider', to_jsonb(p),
            'details', (select to_jsonb(d) from public.provider_details d where d.provider_id = p.id),
            'owners', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', o.role, 'since', o.created_at))
                from public.provider_owners o left join auth.users u on u.id = o.user_id where o.provider_id = p.id), '[]'),
            'claims', coalesce((select jsonb_agg(jsonb_build_object('status', c.status, 'evidence', c.evidence, 'created_at', c.created_at, 'email', u.email))
                from public.provider_claims c left join auth.users u on u.id = c.user_id where c.provider_id = p.id), '[]'),
            'photos', (select count(*) from public.provider_photos ph where ph.provider_id = p.id),
            'inquiries', (select count(*) from public.patient_inquiries i where i.provider_id = p.id),
            'threads', (select count(*) from public.forum_threads t where t.provider_id = p.id),
            'survey_responses', coalesce((select jsonb_agg(jsonb_build_object('created_at', b.created_at, 'form_slug', b.form_slug, 'segment', b.segment, 'outcome', b.outcome))
                from public.bh_responses b where b.provider_id = p.id), '[]')
        )
        from public.providers p where p.id = pid
    );
end;
$$;
revoke all on function public.admin_provider_detail(uuid) from public, anon;
grant execute on function public.admin_provider_detail(uuid) to authenticated;
