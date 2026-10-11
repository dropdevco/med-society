-- Patients no longer book through Doctoralia; they message us through
-- /api/inquiry (patient_inquiries, 0009). The Doctoralia booking link is dead
-- data, so drop it. Dropping the column also removes it from the column-level
-- UPDATE grant created in 0003.
alter table public.providers drop column if exists "bookingUrl";
