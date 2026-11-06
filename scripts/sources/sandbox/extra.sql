-- Tables the sandbox needs beyond the migration test's stand-ins.
create table public.doctoralia_doctors (
    doctoralia_id text primary key,
    entity_type   text,
    name          text,
    cedulas       text[],
    provider_id   uuid
);
grant all on public.doctoralia_doctors to service_role;
