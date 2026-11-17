\set ON_ERROR_STOP on
-- Each check prints t; refused actions print a NOTICE.
\set CN '''00000000-0000-4000-8000-0000000000c1'''
\set DRG '''00000000-0000-4000-8000-0000000000c2'''
\set CS '''00000000-0000-4000-8000-0000000000c3'''
\set STAY '''00000000-0000-4000-8000-0000000000c4'''
\set ANA '''00000000-0000-4000-8000-0000000000d1'''
\set LUIS '''00000000-0000-4000-8000-0000000000d2'''
\set ROSA '''00000000-0000-4000-8000-0000000000d3'''

-- Backfill and suggestions (run by the migration).
select 'Google clinic, Doctoralia facility marked clinic' as check,
  (select count(*) from public.providers where id in (:CN, :CS) and kind = 'clinic') = 2 as ok;
select 'Dr. on Google, doctors and the stay left alone' as check,
  (select kind is null from public.providers where id = :DRG)
  and (select count(*) from public.providers where id in (:ANA, :LUIS, :ROSA) and kind is not null) = 0
  and (select kind = 'stay' from public.providers where id = :STAY) as ok;
select 'one suggestion: Rosa at Centro Médico Sur, from the exact name' as check,
  (select count(*) = 1 and bool_and(clinic_id = :CS and practitioner_id = :ROSA)
     from public.clinic_practitioner_suggestions) as ok;

set role authenticated;

-- Front desk (staff) of Clínica Norte.
select set_config('test.uid', '00000000-0000-4000-8000-0000000000e2', false);
do $$ begin perform public.team_set_role('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2', 'owner');
  raise exception 'staff promoted themselves'; exception when insufficient_privilege then raise notice 'ok: staff cannot change roles'; end $$;
do $$ begin perform public.team_invite('00000000-0000-4000-8000-0000000000c1', 'boss@else.test', 'owner');
  raise exception 'staff invited an owner'; exception when insufficient_privilege then raise notice 'ok: staff cannot invite an owner'; end $$;
do $$ begin perform public.team_remove_member('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1');
  raise exception 'staff removed the owner'; exception when insufficient_privilege then raise notice 'ok: staff cannot remove an owner'; end $$;
select 'staff can invite staff' as check, (public.team_invite(:CN, 'nurse@clinica.test', 'staff'))->>'kind' = 'team' as ok;
select 'staff sees my_role staff' as check, (public.team_overview(:CN))->>'my_role' = 'staff' as ok;

select 'linking an unclaimed doctor is active but not managed' as check,
  public.practitioner_link(:CN, :ANA) = '{"status": "active", "managed": false}'::jsonb as ok;
select 'so the clinic cannot edit her listing' as check, not public.manages_provider(:ANA) as ok;
select 'linking a doctor who owns his listing waits for him' as check,
  (public.practitioner_link(:CN, :LUIS))->>'status' = 'pending' as ok;
select (public.practitioner_create(:CN, 'Dra. Nueva Cuatro', '{cardiology}'))->>'provider_id' as nueva \gset
select 'staff can edit the doctor the clinic created' as check, public.manages_provider(:'nueva') as ok;

reset role;
select 'a created doctor is managed and gets a doctor identity' as check,
  (select l.managed and dl.method = 'new_listing'
     from public.clinic_practitioners l join public.doctor_listings dl on dl.provider_id = l.practitioner_id
    where l.clinic_id = :CN and l.practitioner_id = :'nueva') as ok;
set role anon;
select 'clinic page shows active doctors only (Ana, Nueva; not pending Luis)' as check,
  (select jsonb_array_length(public.provider_team(:CN)->'practitioners')) = 2
  and not (public.provider_team(:CN)->'practitioners' @> jsonb_build_array(jsonb_build_object('id', :LUIS))) as ok;
select 'Ana''s page shows where she practises' as check,
  (public.provider_team(:ANA)->'clinics'->0->>'name') = 'Clínica Norte' as ok;
select 'roster carries no contact fields' as check,
  not (public.provider_team(:CN)::text ~ '"(phone|email|website)"') as ok;
do $$ begin perform 1 from public.clinic_practitioner_suggestions; raise exception 'anon read suggestions';
  exception when insufficient_privilege then raise notice 'ok: anon cannot read suggestions'; end $$;
do $$ begin perform public.team_overview('00000000-0000-4000-8000-0000000000c1'); raise exception 'anon read a team';
  exception when insufficient_privilege then raise notice 'ok: anon cannot read a team'; end $$;
reset role;

-- Owner invites Ana to claim her listing.
set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-0000000000e1', false);
select (public.team_invite(:CN, 'ana@doctor.test', 'owner', :ANA))->>'token' as tok \gset
select set_config('test.tok', :'tok', false) \g /dev/null
select set_config('test.uid', '00000000-0000-4000-8000-0000000000e5', false);
do $$ begin perform public.invite_accept(current_setting('test.tok'));
  raise exception 'someone else used the link'; exception when insufficient_privilege then raise notice 'ok: the link only works for the invited e-mail'; end $$;
select set_config('test.uid', '00000000-0000-4000-8000-0000000000e4', false);
select 'accepting a doctor invite opens a claim' as check, (public.invite_accept(:'tok'))->>'status' = 'claim' as ok;
select 'opening it again is harmless' as check, (public.invite_accept(:'tok'))->>'status' = 'claim' as ok;
reset role;
select 'no owner row: ownership waits for review' as check,
  not exists (select 1 from public.provider_owners where provider_id = :ANA) as ok;
select 'the claim is incomplete and names the clinic' as check,
  (select status = 'incomplete' and history @> '[{"event": "invited_by_clinic", "note": "Clínica Norte"}]'::jsonb
     from public.provider_claims where provider_id = :ANA and user_id = '00000000-0000-4000-8000-0000000000e4') as ok;

-- Owner powers, kind switching, suggestions.
set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-0000000000e1', false);
select public.team_set_role(:CN, '00000000-0000-4000-8000-0000000000e2', 'owner') \g /dev/null
select 'owner can promote staff' as check,
  public.team_overview(:CN)->'members' @> '[{"email": "desk@clinica.test", "role": "owner"}]'::jsonb as ok;
select public.set_listing_kind(:CN, null) \g /dev/null
select 'owner can say the listing is not a clinic' as check, (select kind is null from public.providers where id = :CN) as ok;
do $$ begin perform public.set_listing_kind('00000000-0000-4000-8000-0000000000c4', 'clinic');
  raise exception 'owner changed a stay'; exception when insufficient_privilege then raise notice 'ok: a stay stays a stay'; end $$;
select 'the clinic sees Rosa as a suggestion' as check,
  jsonb_array_length(public.team_overview(:CS)->'suggestions') = 1 as ok;
select 'adding her links her straight away (unclaimed)' as check,
  (public.practitioner_link(:CS, :ROSA))->>'status' = 'active' as ok;
select 'and clears the suggestion' as check,
  jsonb_array_length(public.team_overview(:CS)->'suggestions') = 0 as ok;
select public.practitioner_link(:CN, :DRG) \g /dev/null
reset role;
select 'linking marks the listing a clinic again' as check,
  (select kind = 'clinic' from public.providers where id = :CN) as ok;
