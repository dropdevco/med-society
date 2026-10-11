-- One-off data fixes after the Tijuana + San Diego load (2026-10-11).
-- Needs the owner's approval to run against production (it writes live rows).
-- Run in the Supabase SQL editor, or approve it in Claude Code.

begin;

-- 1. 50 Doctoralia doctors practising at San Ysidro Health
--    ("4004 Beyer Blvd, San Ysidro, CA 92173, USA") were tagged country MX /
--    city Tijuana because Doctoralia filed the address under Tijuana. They are
--    on the US side of the San Diego–Tijuana crossing.
update public.providers
   set country = 'US',
       city    = 'San Diego',
       address = regexp_replace(address, ',\s*Tijuana,\s*Baja California,\s*M[eé]xico\s*$', '')
 where status = 'live'
   and region = 'sandiego-tijuana'
   and country = 'MX'
   and address ~* ', CA 9\d{4}|, USA';

-- 2. 4 El Paso–Juárez rows whose address is in Tecate / Cabo San Lucas /
--    Tijuana but whose pin sits in Juárez — the pin is wrong, so hide them
--    (recoverable) and flag the staging row for review.
with hidden as (
    update public.providers
       set status = 'hidden'
     where status = 'live'
       and region = 'elpaso-juarez'
       and country = 'MX'
       and address ~* 'tijuana|cabo san lucas|tecate|baja california'
    returning "doctoraliaId"
)
update public.doctoralia_doctors
   set review_status = 'pending', updated_at = now()
 where doctoralia_id in (select "doctoraliaId" from hidden);

-- 3. Tijuana languages were stored as Doctoralia's Spanish names; every other
--    row (and the language filter) uses ISO codes. (The app also normalises
--    names on read now, so this is for data consistency.)
with map(word, code) as (values
    ('español','es'),('inglés','en'),('francés','fr'),('italiano','it'),('alemán','de'),
    ('portugués','pt'),('ruso','ru'),('catalán','ca'),('japonés','ja'),('chino','zh'),('coreano','ko'))
update public.providers p
   set languages = (
       select coalesce(array_agg(distinct coalesce(m.code, lower(l))), '{}')
         from unnest(p.languages) l left join map m on m.word = lower(l))
 where p.source = 'doctoralia' and p.region = 'sandiego-tijuana' and cardinality(p.languages) > 0;
-- The UPDATE trigger marks changed languages as confirmed; these are scraped.
-- (No Tijuana/San Ysidro Doctoralia row had a confirmed language before this.)
update public.providers set languages_confirmed = false
 where source = 'doctoralia' and region = 'sandiego-tijuana' and languages_confirmed;

commit;
