-- A patient must have an account to message a clinic.
--
-- api/inquiry.ts now requires a signed-in user's access token and records who
-- sent each message. The account is the verified identity (a confirmed email),
-- which is what keeps anonymous spam away from clinics and lets us show a
-- patient their own history later.
--
-- Nullable on purpose: every inquiry stored before this change was anonymous,
-- and must stay readable. `on delete set null` so deleting an account never
-- deletes the clinic-facing record of what was asked.
--
-- RLS is unchanged (enabled, no policies, anon/authenticated revoked in 0009):
-- only the service role used by the API can write or read this table.

alter table public.patient_inquiries
    add column if not exists user_id uuid references auth.users (id) on delete set null;

create index if not exists patient_inquiries_user_idx
    on public.patient_inquiries (user_id, created_at desc)
    where user_id is not null;
