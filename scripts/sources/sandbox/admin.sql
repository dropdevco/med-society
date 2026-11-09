-- Sandbox only: one made-up reviewer, so /admin can be walked in a browser.
-- proxy.ts answers its sign-in. Every sandbox request then acts as this user.
insert into auth.users (id) values ('00000000-0000-4000-8000-00000000aaaa') on conflict do nothing;
insert into public.app_admins (user_id) values ('00000000-0000-4000-8000-00000000aaaa') on conflict do nothing;
alter database postgres set test.uid = '00000000-0000-4000-8000-00000000aaaa';
