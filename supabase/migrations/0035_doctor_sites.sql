-- Doctor websites: <subdomain>.medsociety.one, one row per site.
--
-- A site is not a deployment. middleware.ts sends every request on a doctor's
-- subdomain to api/agent.ts (route=site), which renders the page from this row
-- and the doctor's listing, so a new site is a row plus one domain on Vercel.
--
--   status    preview   renders, but noindex and out of the sitemap
--             active    renders and is indexed
--             suspended does not render (a moderation switch, not billing)
--   comped    the site stays up without a paid plan (first sites, demos)
--   content   copy that the listing does not hold, per language:
--             {"headline": {"es": "...", "en": "..."}, "about": {...}}
--
-- Billing is deliberately not stored here. Whether the plan is paid is read
-- from providers.tier at render time ('featured' is the US$99 plan), so a lost
-- webhook can never leave a site up, or down, against the plan.
--
-- Writes are service-role only. Run in: Supabase dashboard -> SQL editor (or
-- apply_migration).

create table if not exists public.doctor_sites (
    provider_id   uuid        primary key references public.providers(id) on delete cascade,
    subdomain     text        not null unique,
    status        text        not null default 'preview' check (status in ('preview', 'active', 'suspended')),
    comped        boolean     not null default false,
    content       jsonb       not null default '{}'::jsonb,
    custom_domain text        unique,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),
    constraint doctor_sites_subdomain_shape
        check (subdomain ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
    constraint doctor_sites_subdomain_reserved
        check (subdomain <> all (array[
            'www', 'api', 'app', 'admin', 'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2',
            'support', 'help', 'blog', 'docs', 'status', 'dashboard', 'account', 'accounts', 'login',
            'auth', 'billing', 'pay', 'pricing', 'cdn', 'static', 'assets', 'media', 'files', 'dev',
            'staging', 'test', 'demo', 'preview', 'beta', 'medsociety'
        ]))
);

alter table public.doctor_sites enable row level security;

revoke all on public.doctor_sites from anon, authenticated;
grant select (provider_id, subdomain, status, comped, content) on public.doctor_sites to anon, authenticated;

drop policy if exists "doctor sites that render are public" on public.doctor_sites;
create policy "doctor sites that render are public" on public.doctor_sites
    for select to anon, authenticated
    using (status in ('preview', 'active'));
