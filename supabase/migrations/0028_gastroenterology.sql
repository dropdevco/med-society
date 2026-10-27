-- Gastroenterology as a specialty of its own.
--
-- ~100 gastroenterologists were filed under 'general', so a symptom like "my
-- stomach hurts" could only ever point at primary care or urgent care. Same
-- idea as 0019 (neurology / ENT / orthopedics): the key lives in the Specialty
-- union in src/types/provider.ts, `providers.specialty` is a plain text[], so
-- this re-tags rows and teaches the two whitelists that would otherwise turn a
-- self-listed gastroenterologist back into 'general'.
--
-- Rules (same as 0019):
--   * Add the key wherever Doctoralia lists the entity under a gastroenterology
--     slug or specialization label.
--   * Drop 'general' only from individual doctors (not clinics) whose every
--     Doctoralia specialization is gastroenterology. Someone who also lists
--     "Médico general" keeps it.
--   * Google-only listings (both regions) are tagged by name. "Endoscopy" and
--     "digestive" count; "colon" does not (it matches "Farmacia de la Colonia").

create temporary table new_gastro_tags on commit drop as
select d.doctoralia_id,
       d.provider_id,
       d.entity_type = 'doctor'
         and cardinality(d.specializations) > 0
         and not exists (select 1 from unnest(d.specializations) s where s !~* 'gastro') as drop_general
from public.doctoralia_doctors d
where d.found_under_slugs && array['gastroenterologo', 'gastroenterologo-pediatrico', 'clinicas/gastroenterologia']
   or exists (select 1 from unnest(d.specializations) s where s ~* 'gastro');

update public.doctoralia_doctors d
set mapped_specialties = (
        select array_agg(distinct k) from unnest(
            case when t.drop_general then array_remove(d.mapped_specialties, 'general') else d.mapped_specialties end
            || array['gastroenterology']) k),
    updated_at = now()
from new_gastro_tags t
where t.doctoralia_id = d.doctoralia_id;

update public.providers p
set specialty = (
        select array_agg(distinct k) from unnest(
            case when t.drop_general then array_remove(p.specialty, 'general') else p.specialty end
            || array['gastroenterology']) k)
from new_gastro_tags t
where t.provider_id = p.id;

update public.providers p
set specialty = (
        select array_agg(distinct k) from unnest(array_remove(p.specialty, 'general') || array['gastroenterology']) k)
where p."doctoraliaId" is null
  and p.name ~* '(gastro|digestive|endoscop)'
  and not ('gastroenterology' = any(p.specialty));

-- The whitelists inside bh_submit_listing (/borderhealth "Get listed") and
-- practitioner_create (clinic teams): both end `... 'orthopedics');`. Rewritten
-- from the live definitions so nothing else about them changes.
do $$
declare
    fn  text;
    def text;
begin
    foreach fn in array array[
        'public.bh_submit_listing(uuid,text,text[],text,text,text,text,text,text,text,double precision,double precision)',
        'public.practitioner_create(uuid,text,text[])'
    ] loop
        def := pg_get_functiondef(fn::regprocedure);
        if def like '%''gastroenterology''%' then continue; end if;
        if position('''orthopedics'');' in def) = 0 then
            raise exception 'specialty whitelist not found in %', fn;
        end if;
        execute replace(def, '''orthopedics'');', '''orthopedics'', ''gastroenterology'');');
    end loop;
end $$;
