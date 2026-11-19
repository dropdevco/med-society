-- Stand-ins for production objects 0054 references. Not production's definitions.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
create table public.app_admins (user_id uuid primary key);
create function public.is_app_admin() returns boolean language sql stable security definer set search_path = public, auth as $$
    select exists (select 1 from public.app_admins where user_id = auth.uid()) $$;
grant execute on function public.is_app_admin() to authenticated;
