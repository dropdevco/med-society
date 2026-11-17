-- Claim verification: every claim is reviewed by a person, with real evidence.
--
-- WHY. Until now a claim was a free-text box ("how can we verify you?"), and
-- bh_claim_provider granted ownership instantly when the account's confirmed
-- email equalled the listing's email. Two problems:
--   1. Listing emails are scraped (Google, Doctoralia). An old, shared or
--      agency inbox on a listing handed the listing to whoever controls it,
--      with no human ever looking.
--   2. Nothing a reviewer saw proved who the claimant was. A cédula number is
--      not proof either: SEP's registry is public, so anyone can look up a
--      doctor's cédula by name. It identifies a doctor; it does not prove the
--      claimant is that doctor.
--
-- WHAT. A claim now asks for three independent things, and a reviewer must
-- confirm them before ownership is granted:
--   a. Who you are: legal name, phone, and a government photo ID (INE,
--      passport, driver's licence) uploaded to a private bucket.
--   b. Your credential, by role:
--        doctor, MX listing  cédula profesional + photo of the cédula or the
--                            SEP constancia (checked by the reviewer at SEP)
--        doctor, US listing  NPI (checksum-validated) + state licence number
--                            + licence document (checked at NPPES / the board)
--        clinic owner        proof of the business (constancia de situación
--                            fiscal, COFEPRIS aviso / licencia sanitaria,
--                            business licence)
--        authorised staff    a signed authorisation letter from the owner
--   c. Control of the listing: the reviewer reaches the clinic through a
--      channel already on the listing (call or WhatsApp its published phone,
--      or write to its published email). This is what stops someone with a
--      real ID and a real cédula claiming a clinic that is not theirs.
--
-- The database computes signals for the reviewer (cédula vs. our identity
-- registry from 0042, email/phone/domain matches, name similarity, how many
-- other claims this account has) but never decides. Nothing is instant.
--
-- Statuses: incomplete (started from the survey, details missing) → pending
-- (submitted) → needs_info | approved | rejected. A rejected claim may be
-- resubmitted after 30 days.
--
-- Run in: Supabase dashboard -> SQL editor (or apply_migration). Check
-- production's schema_migrations for the number first.

begin;

-- ── provider_claims: new statuses and the claimant's declared details ───────
alter table public.provider_claims drop constraint if exists provider_claims_status_check;
alter table public.provider_claims add constraint provider_claims_status_check
    check (status in ('incomplete', 'pending', 'needs_info', 'approved', 'rejected'));

alter table public.provider_claims
    add column if not exists claimant_role  text check (claimant_role in ('doctor', 'owner', 'manager')),
    add column if not exists legal_name     text check (char_length(legal_name) <= 160),
    add column if not exists phone          text check (char_length(phone) <= 40),
    add column if not exists cedula         text check (cedula ~ '^[0-9]{6,9}$'),
    add column if not exists npi            text check (npi ~ '^[0-9]{10}$'),
    add column if not exists license_number text check (char_length(license_number) <= 40),
    add column if not exists license_state  text check (license_state ~ '^[A-Z]{2}$'),
    add column if not exists rfc            text check (rfc ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'),
    add column if not exists consent_at     timestamptz,
    add column if not exists submitted_at   timestamptz,
    -- Shown to the claimant: why it was rejected, or what is missing.
    add column if not exists review_note    text check (char_length(review_note) <= 1000),
    -- Never shown to the claimant.
    add column if not exists reviewer_note  text check (char_length(reviewer_note) <= 2000),
    add column if not exists reviewer_checks jsonb,
    add column if not exists reviewed_by    uuid references auth.users (id),
    add column if not exists signals        jsonb,
    add column if not exists history        jsonb not null default '[]';

-- ── Documents ───────────────────────────────────────────────────────────────
create table if not exists public.claim_documents (
    id           uuid primary key default gen_random_uuid(),
    claim_id     uuid not null references public.provider_claims (id) on delete cascade,
    user_id      uuid not null references auth.users (id) on delete cascade,
    kind         text not null check (kind in ('government_id', 'cedula', 'license', 'business_proof', 'authorization_letter', 'other')),
    storage_path text not null unique,
    created_at   timestamptz not null default now()
);
create index if not exists claim_documents_claim_idx on public.claim_documents (claim_id);

-- Private bucket: ID documents are personal data (LFPDPPP). Files live under
-- <user_id>/<provider_id>/<file>. The claimant may upload into their own
-- folder and read it back; only app admins read anyone else's. Nobody deletes
-- from the browser, so evidence cannot be withdrawn after a decision.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('claim-documents', 'claim-documents', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update
    set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "claimants upload claim documents" on storage.objects;
create policy "claimants upload claim documents" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "claimants read own claim documents" on storage.objects;
create policy "claimants read own claim documents" on storage.objects
    for select to authenticated
    using (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "admins read claim documents" on storage.objects;
create policy "admins read claim documents" on storage.objects
    for select to authenticated
    using (bucket_id = 'claim-documents' and public.is_app_admin());

-- ── Lock the tables down: claims are written through the functions below ────
-- 0003/0005 let the browser insert and amend claims directly. Everything now
-- goes through claim_submit, which enforces what a claim must contain.
drop policy if exists "claim own" on public.provider_claims;
drop policy if exists "update own pending claims" on public.provider_claims;
revoke all on public.provider_claims from anon;
revoke insert, update, delete, truncate, references, trigger on public.provider_claims from authenticated;
-- The claimant reads their own claim's status and the reviewer's message, not
-- the reviewer's internal note, checks or the computed signals.
revoke select on public.provider_claims from authenticated;
grant select (id, provider_id, user_id, status, claimant_role, created_at, submitted_at, reviewed_at, review_note)
    on public.provider_claims to authenticated;

revoke all on public.provider_owners from anon;
revoke insert, update, delete, truncate, references, trigger on public.provider_owners from authenticated;

alter table public.claim_documents enable row level security;
revoke all on public.claim_documents from anon, authenticated;
grant select (id, claim_id, kind, created_at) on public.claim_documents to authenticated;
drop policy if exists "read own claim documents" on public.claim_documents;
create policy "read own claim documents" on public.claim_documents
    for select to authenticated using (user_id = auth.uid());

-- ── Helpers ─────────────────────────────────────────────────────────────────
-- NPI check digit: Luhn over "80840" + the ten digits (CMS standard).
create or replace function public.npi_valid(t text)
returns boolean
language plpgsql immutable
set search_path = pg_temp
as $$
declare s text; total int := 0; d int; i int;
begin
    if t is null or t !~ '^[0-9]{10}$' then return false; end if;
    s := '80840' || t;
    for i in 1 .. length(s) loop
        d := substr(s, length(s) - i + 1, 1)::int;
        if i % 2 = 0 then d := d * 2; if d > 9 then d := d - 9; end if; end if;
        total := total + d;
    end loop;
    return total % 10 = 0;
end $$;

create or replace function public._claim_history(h jsonb, actor text, event text, status text, note text default null)
returns jsonb
language sql immutable
set search_path = pg_temp
as $$
    select coalesce(h, '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'at', now(), 'by', actor, 'event', event, 'status', status, 'note', note)));
$$;

-- What a reviewer should know before deciding. Facts only; never a verdict.
create or replace function public._claim_signals(p_claim uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
    c        public.provider_claims%rowtype;
    p        public.providers%rowtype;
    v_email  text;
    v_conf   boolean;
    v_since  timestamptz;
    v_domain text;
    v_site   text;
    v_doctor uuid;
    v_dname  text;
    v_onfile text[];
    v_other  record;
    v_cedula text := 'not_given';
    v_sim    real;
    v_owners int;
    v_rivals int;
    v_mine   int;
    v_rej    int;
    v_docs   jsonb;
    flags    text[] := '{}';
    free_mail constant text[] := array['gmail.com','googlemail.com','hotmail.com','hotmail.es','outlook.com','outlook.es',
                                       'live.com','live.com.mx','yahoo.com','yahoo.com.mx','icloud.com','me.com',
                                       'prodigy.net.mx','aol.com','protonmail.com','proton.me','msn.com'];
begin
    select * into c from public.provider_claims where id = p_claim;
    if not found then return null; end if;
    select * into p from public.providers where id = c.provider_id;
    select lower(email), email_confirmed_at is not null, created_at into v_email, v_conf, v_since
      from auth.users where id = c.user_id;

    v_domain := nullif(split_part(coalesce(v_email, ''), '@', 2), '');
    v_site   := nullif(regexp_replace(lower(coalesce(p.website, '')), '^[a-z]+://(www\.)?([^/:?#]+).*$', '\2'), '');

    select dl.doctor_id, d.display_name into v_doctor, v_dname
      from public.doctor_listings dl join public.doctors d on d.id = dl.doctor_id
     where dl.provider_id = p.id;
    if v_doctor is not null then
        select coalesce(array_agg(cedula order by cedula), '{}') into v_onfile
          from public.doctor_cedulas where doctor_id = v_doctor;
    end if;

    if c.cedula is not null then
        select dc.doctor_id, d.display_name into v_other
          from public.doctor_cedulas dc join public.doctors d on d.id = dc.doctor_id
         where dc.cedula = c.cedula;
        v_cedula := case
            when v_other.doctor_id is not null and v_other.doctor_id = v_doctor then 'matches_listing_doctor'
            when v_other.doctor_id is not null then 'belongs_to_other_doctor'
            when coalesce(array_length(v_onfile, 1), 0) > 0 then 'differs_from_file'
            else 'not_in_registry' end;
    end if;

    if c.legal_name is not null then
        v_sim := round(extensions.similarity(public.bh_norm(c.legal_name), public.bh_norm(coalesce(v_dname, p.name)))::numeric, 2);
    end if;

    select count(*) into v_owners from public.provider_owners where provider_id = p.id;
    select count(*) into v_rivals from public.provider_claims
     where provider_id = p.id and user_id <> c.user_id and status in ('incomplete', 'pending', 'needs_info');
    select count(*) filter (where status in ('incomplete', 'pending', 'needs_info')),
           count(*) filter (where status = 'rejected')
      into v_mine, v_rej
      from public.provider_claims where user_id = c.user_id and id <> c.id;
    select coalesce(jsonb_object_agg(kind, n), '{}') into v_docs
      from (select kind, count(*) n from public.claim_documents where claim_id = c.id group by kind) x;

    if v_cedula = 'belongs_to_other_doctor' then
        flags := array_append(flags, format('Cédula belongs to a different doctor in our registry (%s)', v_other.display_name));
    elsif v_cedula = 'differs_from_file' then
        flags := array_append(flags, 'Cédula differs from the one(s) on file for this listing''s doctor');
    end if;
    if v_owners > 0 then flags := array_append(flags, format('Listing already has %s owner(s)', v_owners)); end if;
    if v_rivals > 0 then flags := array_append(flags, format('%s other open claim(s) on this listing', v_rivals)); end if;
    if v_mine > 0 then flags := array_append(flags, format('Account has %s other open claim(s)', v_mine)); end if;
    if v_rej > 0 then flags := array_append(flags, format('Account has %s rejected claim(s)', v_rej)); end if;
    if v_since > now() - interval '1 day' then flags := array_append(flags, 'Account created less than a day ago'); end if;
    if not coalesce(v_conf, false) then flags := array_append(flags, 'Account email not confirmed'); end if;
    if v_sim is not null and v_sim < 0.3 and c.claimant_role = 'doctor' then
        flags := array_append(flags, 'Legal name does not resemble the listing''s doctor');
    end if;
    if c.npi is not null and not public.npi_valid(c.npi) then flags := array_append(flags, 'NPI fails its checksum'); end if;

    return jsonb_build_object(
        'computed_at', now(),
        'account_email', v_email,
        'email_confirmed', coalesce(v_conf, false),
        'account_age_days', floor(extract(epoch from now() - v_since) / 86400)::int,
        'email_matches_listing', coalesce(v_email = lower(btrim(p.email)), false),
        'email_domain_matches_website', v_domain is not null and v_site is not null
                                        and not (v_domain = any (free_mail))
                                        and (v_site = v_domain or v_site like '%.' || v_domain),
        'phone_matches_listing', coalesce(length(public.bh_phone(c.phone)) >= 7 and public.bh_phone(c.phone) = p.phone_norm, false),
        'registry_doctor', v_dname,
        'cedulas_on_file', to_jsonb(v_onfile),
        'cedula_check', v_cedula,
        'npi_valid', case when c.npi is null then null else public.npi_valid(c.npi) end,
        'name_similarity', v_sim,
        'listing_owners', v_owners,
        'other_open_claims_on_listing', v_rivals,
        'claimant_open_claims', v_mine,
        'claimant_rejected_claims', v_rej,
        'documents', v_docs,
        'flags', to_jsonb(flags)
    );
end $$;
revoke all on function public._claim_signals(uuid) from public, anon, authenticated;

-- ── Submitting a claim ──────────────────────────────────────────────────────
create or replace function public.claim_submit(
    p_provider       uuid,
    p_role           text,
    p_legal_name     text,
    p_phone          text,
    p_cedula         text    default null,
    p_npi            text    default null,
    p_license_number text    default null,
    p_license_state  text    default null,
    p_rfc            text    default null,
    p_evidence       text    default null,
    p_documents      jsonb   default '[]',
    p_consent        boolean default false
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions, auth, pg_temp
as $$
declare
    v_uid     uuid := auth.uid();
    v_listing public.providers%rowtype;
    v_claim   public.provider_claims%rowtype;
    v_doc     jsonb;
    v_path    text;
    v_kind    text;
    v_has     text[];
    v_cedula  text := nullif(regexp_replace(coalesce(p_cedula, ''), '\D', '', 'g'), '');
    v_npi     text := nullif(regexp_replace(coalesce(p_npi, ''), '\D', '', 'g'), '');
    v_rfc     text := nullif(upper(regexp_replace(coalesce(p_rfc, ''), '[\s-]', '', 'g')), '');
    v_state   text := nullif(upper(btrim(coalesce(p_license_state, ''))), '');
    v_lic     text := nullif(btrim(left(coalesce(p_license_number, ''), 40)), '');
    v_event   text;
begin
    if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
    if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
        raise exception 'email_not_confirmed' using errcode = '28000';
    end if;
    if not coalesce(p_consent, false) then raise exception 'consent_required' using errcode = '22023'; end if;
    if p_role not in ('doctor', 'owner', 'manager') then raise exception 'bad_role' using errcode = '22023'; end if;
    if char_length(btrim(coalesce(p_legal_name, ''))) < 5 then raise exception 'bad_legal_name' using errcode = '22023'; end if;
    if length(public.bh_phone(p_phone)) < 7 then raise exception 'bad_phone' using errcode = '22023'; end if;
    if jsonb_typeof(coalesce(p_documents, '[]')) <> 'array' or jsonb_array_length(coalesce(p_documents, '[]')) > 10 then
        raise exception 'bad_documents' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('claim_submit:' || v_uid::text));

    select * into v_listing from public.providers where id = p_provider and status = 'live';
    if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;

    if exists (select 1 from public.provider_owners where provider_id = p_provider and user_id = v_uid) then
        return jsonb_build_object('status', 'owner', 'provider_id', p_provider);
    end if;

    select * into v_claim from public.provider_claims where provider_id = p_provider and user_id = v_uid for update;
    if v_claim.status = 'approved' then
        return jsonb_build_object('status', 'owner', 'provider_id', p_provider);
    end if;
    if v_claim.status = 'rejected' and v_claim.reviewed_at > now() - interval '30 days' then
        raise exception 'recently_rejected' using errcode = '54000';
    end if;

    if (select count(*) from public.provider_claims
         where user_id = v_uid and provider_id <> p_provider
           and status in ('incomplete', 'pending', 'needs_info')) >= 3 then
        raise exception 'too_many_claims' using errcode = '54000';
    end if;

    -- Per-role, per-country credential.
    if p_role = 'doctor' and v_listing.country = 'MX' and (v_cedula is null or v_cedula !~ '^[0-9]{6,9}$') then
        raise exception 'cedula_required' using errcode = '22023';
    end if;
    if p_role = 'doctor' and v_listing.country = 'US' then
        if not public.npi_valid(v_npi) then raise exception 'npi_invalid' using errcode = '22023'; end if;
        if v_lic is null or v_state is null or v_state !~ '^[A-Z]{2}$' then
            raise exception 'license_required' using errcode = '22023';
        end if;
    end if;
    if v_cedula is not null and v_cedula !~ '^[0-9]{6,9}$' then raise exception 'bad_cedula' using errcode = '22023'; end if;
    if v_npi is not null and not public.npi_valid(v_npi) then raise exception 'npi_invalid' using errcode = '22023'; end if;
    if v_rfc is not null and v_rfc !~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$' then raise exception 'bad_rfc' using errcode = '22023'; end if;

    if v_claim.id is null then
        insert into public.provider_claims (provider_id, user_id, status, history)
        values (p_provider, v_uid, 'incomplete', public._claim_history('[]', 'claimant', 'created', 'incomplete'))
        returning * into v_claim;
    end if;

    -- Attach uploaded files. Each must be this user's own upload for this
    -- listing, already in the private bucket.
    for v_doc in select * from jsonb_array_elements(coalesce(p_documents, '[]')) loop
        v_path := v_doc ->> 'path';
        v_kind := v_doc ->> 'kind';
        if v_kind not in ('government_id', 'cedula', 'license', 'business_proof', 'authorization_letter', 'other')
           or v_path is null
           or v_path not like v_uid::text || '/' || p_provider::text || '/%'
           or not exists (select 1 from storage.objects o where o.bucket_id = 'claim-documents' and o.name = v_path) then
            raise exception 'bad_document' using errcode = '22023';
        end if;
        insert into public.claim_documents (claim_id, user_id, kind, storage_path)
        values (v_claim.id, v_uid, v_kind, v_path)
        on conflict (storage_path) do nothing;
    end loop;

    select coalesce(array_agg(distinct kind), '{}') into v_has from public.claim_documents where claim_id = v_claim.id;
    if not ('government_id' = any (v_has)) then raise exception 'id_document_required' using errcode = '22023'; end if;
    if p_role = 'doctor' and v_listing.country = 'MX' and not ('cedula' = any (v_has)) then
        raise exception 'cedula_document_required' using errcode = '22023';
    end if;
    if p_role = 'doctor' and v_listing.country = 'US' and not ('license' = any (v_has)) then
        raise exception 'license_document_required' using errcode = '22023';
    end if;
    if p_role = 'owner' and not ('business_proof' = any (v_has)) then
        raise exception 'business_document_required' using errcode = '22023';
    end if;
    if p_role = 'manager' and not ('authorization_letter' = any (v_has)) then
        raise exception 'authorization_required' using errcode = '22023';
    end if;

    v_event := case when v_claim.status = 'needs_info' then 'answered'
                    when v_claim.status = 'pending'    then 'amended'
                    when v_claim.status = 'rejected'   then 'resubmitted'
                    else 'submitted' end;

    update public.provider_claims set
        status         = 'pending',
        claimant_role  = p_role,
        legal_name     = btrim(left(p_legal_name, 160)),
        phone          = btrim(left(p_phone, 40)),
        cedula         = v_cedula,
        npi            = v_npi,
        license_number = v_lic,
        license_state  = v_state,
        rfc            = v_rfc,
        -- Keep the survey's facts (written by bh_claim_provider), replace the
        -- claimant's own note on each submission rather than piling them up.
        evidence       = left(concat_ws(E'\n---\n',
                                        case when evidence like '[borderhealth survey]%' then split_part(evidence, E'\n---\n', 1) end,
                                        nullif(btrim(left(p_evidence, 1500)), '')), 2000),
        consent_at     = now(),
        submitted_at   = now(),
        reviewed_at    = null,
        reviewed_by    = null,
        history        = public._claim_history(history, 'claimant', v_event, 'pending')
    where id = v_claim.id;

    update public.provider_claims set signals = public._claim_signals(v_claim.id) where id = v_claim.id;

    return jsonb_build_object('status', 'pending', 'claim_id', v_claim.id, 'provider_id', p_provider);
end $$;
revoke all on function public.claim_submit(uuid, text, text, text, text, text, text, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.claim_submit(uuid, text, text, text, text, text, text, text, text, text, jsonb, boolean) to authenticated;

-- ── The survey path no longer grants anything ───────────────────────────────
-- It records that this person wants the listing (with the survey facts as
-- evidence) and sends them to /claim/<id> to finish. Same signature as 0005.
create or replace function public.bh_claim_provider(
    p_provider   uuid,
    p_submission uuid default null,
    p_evidence   text default null
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_uid   uuid := auth.uid();
    v_resp  public.bh_responses%rowtype;
    v_claim public.provider_claims%rowtype;
    v_note  text;
begin
    if v_uid is null then raise exception 'not_signed_in' using errcode = '28000'; end if;
    if not exists (select 1 from public.providers where id = p_provider and status = 'live') then
        raise exception 'listing_not_found' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.provider_owners where provider_id = p_provider and user_id = v_uid) then
        return jsonb_build_object('status', 'owner', 'provider_id', p_provider);
    end if;

    if p_submission is not null then
        select * into v_resp from public.bh_responses
         where submission_key = p_submission and (user_id is null or user_id = v_uid);
    end if;

    v_note := left(concat_ws(E'\n',
        '[borderhealth survey]',
        case when v_resp.id is not null then
            format('Survey #%s: %s / %s / %s / %s', v_resp.id, v_resp.contact_name,
                   v_resp.contact_org, v_resp.contact_email, v_resp.contact_phone) end,
        nullif(btrim(p_evidence), '')), 2000);

    insert into public.provider_claims (provider_id, user_id, status, evidence, history)
    values (p_provider, v_uid, 'incomplete', v_note,
            public._claim_history('[]', 'claimant', 'started_from_survey', 'incomplete'))
    on conflict (provider_id, user_id) do update
        set evidence = case when provider_claims.status = 'incomplete' then excluded.evidence else provider_claims.evidence end
    returning * into v_claim;

    if v_resp.id is not null then
        update public.bh_responses
           set user_id = v_uid, provider_id = p_provider, claim_id = v_claim.id,
               outcome = case when v_claim.status = 'approved' then 'claimed' else 'claim_pending' end
         where id = v_resp.id;
    end if;

    return jsonb_build_object(
        'status', case when v_claim.status = 'approved' then 'owner' else v_claim.status end,
        'claim_id', v_claim.id, 'provider_id', p_provider);
end $$;
revoke all on function public.bh_claim_provider(uuid, uuid, text) from public, anon;
grant execute on function public.bh_claim_provider(uuid, uuid, text) to authenticated;

-- ── Team notification: when a claim reaches the queue, not on every insert ──
create or replace function public.bh_notify_new_claim()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_email text; v_name text; v_phone text;
begin
    if new.status <> 'pending' or (tg_op = 'UPDATE' and old.status = 'pending') then return new; end if;
    select email into v_email from auth.users where id = new.user_id;
    select name, phone into v_name, v_phone from public.providers where id = new.provider_id;
    insert into public.leads (clinic, contact, email, phone, message, plan)
    values (
        left(coalesce(v_name, 'unknown listing'), 200),
        left(coalesce(new.legal_name, v_email, 'unknown'), 200),
        left(coalesce(v_email, 'unknown@unknown'), 320),
        left(new.phone, 40),
        left(format(E'Claim awaiting review (%s).\nListing: %s\nClaimant: %s <%s>, role %s\nReview it in /admin?tab=claims. Documents are in the admin queue only; never forward them by email.',
                    case when tg_op = 'INSERT' or old.status = 'incomplete' then 'new' else 'resubmitted' end,
                    coalesce(v_name, new.provider_id::text), coalesce(new.legal_name, '-'),
                    coalesce(v_email, '-'), coalesce(new.claimant_role, '-')), 2000),
        'claim'
    );
    return new;
end $$;
revoke execute on function public.bh_notify_new_claim() from public, anon, authenticated;

drop trigger if exists provider_claims_notify_new on public.provider_claims;
create trigger provider_claims_notify_new
    after insert or update of status on public.provider_claims
    for each row execute function public.bh_notify_new_claim();

-- ── Review queue ────────────────────────────────────────────────────────────
create or replace function public.admin_claims_queue()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth, pg_temp
as $$
begin
    perform public._admin_guard();
    return jsonb_build_object(
        'generated_at', now(),
        'counts', (select jsonb_build_object(
            'pending',     count(*) filter (where status = 'pending'),
            'needs_info',  count(*) filter (where status = 'needs_info'),
            'incomplete',  count(*) filter (where status = 'incomplete'),
            'approved_30d', count(*) filter (where status = 'approved' and reviewed_at > now() - interval '30 days'),
            'rejected_30d', count(*) filter (where status = 'rejected' and reviewed_at > now() - interval '30 days'))
            from public.provider_claims),
        'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort, x.submitted_at nulls last, x.created_at desc) from (
            select c.id, c.status, c.claimant_role, c.legal_name, c.created_at, c.submitted_at, c.reviewed_at,
                   p.id provider_id, p.name provider_name, p.city, p.country, p.region,
                   u.email account_email,
                   coalesce(c.signals -> 'flags', '[]') flags,
                   c.signals ->> 'cedula_check' cedula_check,
                   (select count(*) from public.claim_documents d where d.claim_id = c.id) documents,
                   case c.status when 'pending' then 0 when 'needs_info' then 1 when 'incomplete' then 2 else 3 end sort
              from public.provider_claims c
              join public.providers p on p.id = c.provider_id
              left join auth.users u on u.id = c.user_id
             order by sort, c.submitted_at nulls last
             limit 300) x), '[]'));
end $$;

create or replace function public.admin_claim_detail(p_claim uuid)
returns jsonb
language plpgsql volatile security definer
set search_path = public, auth, pg_temp
as $$
declare c public.provider_claims%rowtype; v_signals jsonb;
begin
    perform public._admin_guard();
    select * into c from public.provider_claims where id = p_claim;
    if not found then raise exception 'claim_not_found' using errcode = 'P0002'; end if;
    -- Fresh, so a decision is never made on stale facts (an owner added since, etc.).
    v_signals := public._claim_signals(p_claim);
    update public.provider_claims set signals = v_signals where id = p_claim;

    return jsonb_build_object(
        'claim', to_jsonb(c) - 'signals' || jsonb_build_object('signals', v_signals),
        'listing', (select jsonb_build_object(
            'id', p.id, 'name', p.name, 'address', p.address, 'city', p.city, 'country', p.country,
            'region', p.region, 'phone', p.phone, 'email', p.email, 'website', p.website,
            'source', p.source, 'specialty', p.specialty)
            from public.providers p where p.id = c.provider_id),
        'owners', coalesce((select jsonb_agg(jsonb_build_object('email', u.email, 'role', o.role, 'since', o.created_at))
            from public.provider_owners o left join auth.users u on u.id = o.user_id
            where o.provider_id = c.provider_id), '[]'),
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'path', d.storage_path, 'created_at', d.created_at) order by d.created_at)
            from public.claim_documents d where d.claim_id = c.id), '[]'),
        'other_claims', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'provider_name', p.name, 'created_at', o.created_at))
            from public.provider_claims o join public.providers p on p.id = o.provider_id
            where o.user_id = c.user_id and o.id <> c.id), '[]'),
        'rival_claims', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'legal_name', o.legal_name, 'email', u.email))
            from public.provider_claims o left join auth.users u on u.id = o.user_id
            where o.provider_id = c.provider_id and o.id <> c.id), '[]')
    );
end $$;

-- Approve needs the reviewer to attest to identity and credential, and to
-- have reached the clinic through a channel on the listing (or say, at
-- length, why that was not possible). Reject and needs_info need a message
-- the claimant will read.
create or replace function public.admin_claim_decide(
    p_claim    uuid,
    p_decision text,
    p_message  text  default null,
    p_note     text  default null,
    p_checks   jsonb default '{}'
)
returns jsonb
language plpgsql volatile security definer
set search_path = public, auth, pg_temp
as $$
declare
    c       public.provider_claims%rowtype;
    v_admin uuid := auth.uid();
    v_msg   text := nullif(btrim(left(coalesce(p_message, ''), 1000)), '');
    v_note  text := nullif(btrim(left(coalesce(p_note, ''), 2000)), '');
    v_role  text;
    v_new   text;
begin
    perform public._admin_guard();
    select * into c from public.provider_claims where id = p_claim for update;
    if not found then raise exception 'claim_not_found' using errcode = 'P0002'; end if;
    if c.status not in ('pending', 'needs_info') then
        raise exception 'claim_not_open: it is %', c.status using errcode = '55000';
    end if;

    if p_decision = 'approve' then
        if c.status <> 'pending' then raise exception 'approve_only_pending' using errcode = '55000'; end if;
        if not coalesce((p_checks ->> 'id_matches_name')::boolean, false) then
            raise exception 'check_id_required' using errcode = '22023';
        end if;
        if not coalesce((p_checks ->> 'credential_verified')::boolean, false) then
            raise exception 'check_credential_required' using errcode = '22023';
        end if;
        if not coalesce((p_checks ->> 'contact_confirmed')::boolean, false) and coalesce(char_length(v_note), 0) < 20 then
            raise exception 'contact_or_reason_required' using errcode = '22023';
        end if;
        v_new  := 'approved';
        v_role := case when c.claimant_role = 'manager' then 'staff' else 'owner' end;
        insert into public.provider_owners (provider_id, user_id, role)
        values (c.provider_id, c.user_id, v_role)
        on conflict do nothing;
    elsif p_decision in ('reject', 'needs_info') then
        if coalesce(char_length(v_msg), 0) < 10 then raise exception 'message_required' using errcode = '22023'; end if;
        v_new := case when p_decision = 'reject' then 'rejected' else 'needs_info' end;
    else
        raise exception 'bad_decision' using errcode = '22023';
    end if;

    update public.provider_claims set
        status          = v_new,
        review_note     = v_msg,
        reviewer_note   = coalesce(v_note, reviewer_note),
        reviewer_checks = coalesce(p_checks, '{}') || jsonb_build_object('decided_at', now()),
        reviewed_by     = v_admin,
        reviewed_at     = now(),
        history         = public._claim_history(history, 'reviewer', p_decision, v_new, v_msg)
    where id = p_claim;

    return jsonb_build_object('status', v_new, 'claim_id', p_claim);
end $$;

revoke all on function public.admin_claims_queue() from public, anon;
revoke all on function public.admin_claim_detail(uuid) from public, anon;
revoke all on function public.admin_claim_decide(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.admin_claims_queue() to authenticated;
grant execute on function public.admin_claim_detail(uuid) to authenticated;
grant execute on function public.admin_claim_decide(uuid, text, text, text, jsonb) to authenticated;
revoke all on function public.npi_valid(text) from public, anon;
grant execute on function public.npi_valid(text) to authenticated;
revoke all on function public._claim_history(jsonb, text, text, text, text) from public, anon, authenticated;

commit;
