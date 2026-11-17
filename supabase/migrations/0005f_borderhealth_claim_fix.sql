-- Already applied to production as "0005f_borderhealth_claim_fix" (version 20260926075450).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

create or replace function public.bh_claim_provider(
    p_provider   uuid,
    p_submission uuid default null,
    p_evidence   text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_uid       uuid := auth.uid();
    v_email     text;
    v_confirmed boolean;
    v_listing   public.providers%rowtype;
    v_resp      public.bh_responses%rowtype;
    v_has_owner boolean;
    v_auto      boolean := false;
    v_notes     text[] := '{}';
    v_evidence  text;
    v_claim     uuid;
begin
    if v_uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;

    select lower(email), email_confirmed_at is not null
      into v_email, v_confirmed
      from auth.users where id = v_uid;

    select * into v_listing from public.providers where id = p_provider and status = 'live';
    if not found then
        raise exception 'listing_not_found' using errcode = 'P0002';
    end if;

    if p_submission is not null then
        select * into v_resp from public.bh_responses
         where submission_key = p_submission and (user_id is null or user_id = v_uid);
    end if;

    select exists (select 1 from public.provider_owners where provider_id = p_provider)
      into v_has_owner;

    if exists (select 1 from public.provider_owners where provider_id = p_provider and user_id = v_uid) then
        return jsonb_build_object('status', 'owner', 'provider_id', p_provider);
    end if;

    if v_confirmed and v_email is not null and lower(btrim(v_listing.email)) = v_email then
        v_notes := array_append(v_notes, 'account email (confirmed) matches listing email');
        v_auto := not v_has_owner;
    end if;
    if v_resp.id is not null
       and length(public.bh_phone(v_resp.contact_phone)) >= 7
       and public.bh_phone(v_resp.contact_phone) = public.bh_phone(v_listing.phone) then
        v_notes := array_append(v_notes, 'survey phone matches listing phone (unverified)');
    end if;
    if v_has_owner then
        v_notes := array_append(v_notes, 'listing already has an owner');
    end if;

    v_evidence := left(concat_ws(E'\n',
        '[borderhealth] ' || coalesce(array_to_string(v_notes, '; '), ''),
        case when v_resp.id is not null then
            format('Survey #%s: %s / %s / %s / %s', v_resp.id, v_resp.contact_name,
                   v_resp.contact_org, v_resp.contact_email, v_resp.contact_phone) end,
        nullif(btrim(p_evidence), '')
    ), 2000);

    insert into public.provider_claims (provider_id, user_id, status, evidence, reviewed_at)
    values (p_provider, v_uid,
            case when v_auto then 'approved' else 'pending' end,
            v_evidence,
            case when v_auto then now() end)
    on conflict (provider_id, user_id) do update
        set evidence    = excluded.evidence,
            status      = case when provider_claims.status = 'approved' then 'approved' else excluded.status end,
            reviewed_at = coalesce(provider_claims.reviewed_at, excluded.reviewed_at)
    returning id into v_claim;

    if v_auto then
        insert into public.provider_owners (provider_id, user_id, role)
        values (p_provider, v_uid, 'owner')
        on conflict do nothing;
    end if;

    if v_resp.id is not null then
        update public.bh_responses
           set user_id = v_uid, provider_id = p_provider, claim_id = v_claim,
               outcome = case when v_auto then 'claimed' else 'claim_pending' end
         where id = v_resp.id;
    end if;

    return jsonb_build_object(
        'status', case when v_auto then 'approved' else 'pending' end,
        'claim_id', v_claim,
        'provider_id', p_provider
    );
end;
$$;
revoke execute on function public.bh_claim_provider(uuid, uuid, text) from anon;
