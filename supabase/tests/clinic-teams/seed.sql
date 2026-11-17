-- Made-up clinics, doctors and people, loaded before 0049 so its backfill and
-- suggestions have something to work on.
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'owner@clinica.test', now()),   -- owner of Clínica Norte and Centro Médico Sur
  ('00000000-0000-4000-8000-0000000000e2', 'desk@clinica.test', now()),    -- front desk (staff) of Clínica Norte
  ('00000000-0000-4000-8000-0000000000e3', 'luis@doctor.test', now()),     -- owns his own listing
  ('00000000-0000-4000-8000-0000000000e4', 'ana@doctor.test', now()),      -- invited to claim hers
  ('00000000-0000-4000-8000-0000000000e5', 'other@else.test', now());      -- wrong person with Ana's link

insert into public.providers (id, name, source, specialty, city, lat, lng) values
  ('00000000-0000-4000-8000-0000000000c1', 'Clínica Norte', 'google', '{dentist}', 'Tijuana', 32.5, -117.0),
  ('00000000-0000-4000-8000-0000000000c2', 'Dr. Juan Google', 'google', '{general}', 'Tijuana', 32.5, -117.0),
  ('00000000-0000-4000-8000-0000000000c3', 'Centro Médico Sur', 'doctoralia', '{general}', 'Tijuana', 32.5, -117.0),
  ('00000000-0000-4000-8000-0000000000c4', 'Casa Recuperación', 'google', '{}', 'Tijuana', 32.5, -117.0),
  ('00000000-0000-4000-8000-0000000000d1', 'Ana Uno', 'doctoralia', '{dentist}', 'Tijuana', 32.5, -117.0),
  ('00000000-0000-4000-8000-0000000000d2', 'Luis Dos', 'doctoralia', '{orthodontist}', 'Tijuana', 32.5, -117.0),
  ('00000000-0000-4000-8000-0000000000d3', 'Rosa Tres', 'doctoralia', '{general}', 'Tijuana', 32.5, -117.0);
update public.providers set kind = 'stay' where id = '00000000-0000-4000-8000-0000000000c4';

insert into public.doctors (id, display_name) values
  ('00000000-0000-4000-8000-0000000000f1', 'Ana Uno'), ('00000000-0000-4000-8000-0000000000f2', 'Luis Dos'),
  ('00000000-0000-4000-8000-0000000000f3', 'Rosa Tres');
insert into public.doctor_listings (provider_id, doctor_id, method) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000f1', 'doctoralia_link'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000f2', 'doctoralia_link'),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000f3', 'doctoralia_link');

insert into public.doctoralia_doctors (doctoralia_id, entity_type, name, provider_id) values
  ('fac-1', 'facility', 'Centro Médico Sur', '00000000-0000-4000-8000-0000000000c3'),
  ('doc-3', 'doctor', 'Rosa Tres', '00000000-0000-4000-8000-0000000000d3'),
  ('doc-1', 'doctor', 'Ana Uno', '00000000-0000-4000-8000-0000000000d1');
insert into public.doctoralia_addresses (doctoralia_id, clinic_name, street, city) values
  ('doc-3', ' centro médico sur', 'Calle 1', 'Tijuana'),
  ('doc-1', 'Consultorio Particular', 'Calle 2', 'Tijuana');

insert into public.provider_owners (provider_id, user_id, role) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', 'owner'),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2', 'staff'),
  ('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000e1', 'owner'),
  ('00000000-0000-4000-8000-0000000000c4', '00000000-0000-4000-8000-0000000000e1', 'owner'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000e3', 'owner');
