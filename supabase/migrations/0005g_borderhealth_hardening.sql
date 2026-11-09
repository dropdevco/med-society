-- Already applied to production as "0005g_borderhealth_hardening" (version 20260926081142).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

create or replace function public.bh_submit_listing(
    p_submission  uuid,
    p_name        text,
    p_specialty   text[],
    p_city        text,
    p_country     text,
    p_address     text default null,
    p_phone       text default null,
    p_email       text default null,
    p_website     text default null,
    p_description text default null,
    p_lat         double precision default null,
    p_lng         double precision default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
declare
    v_uid     uuid := auth.uid();
    v_country text := upper(coalesce(p_country, 'MX'));
    v_city    text := coalesce(nullif(btrim(left(p_city, 80)), ''), 'Ciudad Juárez');
    v_lat     double precision := p_lat;
    v_lng     double precision := p_lng;
    v_spec    text[];
    v_site    text := nullif(btrim(left(p_website, 300)), '');
    v_id      uuid;
    v_resp    public.bh_responses%rowtype;
begin
    if v_uid is null then
        raise exception 'not_signed_in' using errcode = '28000';
    end if;
    if coalesce(length(btrim(p_name)), 0) < 3 or length(p_name) > 160 then
        raise exception 'bad_name' using errcode = '22023';
    end if;
    if v_country not in ('MX', 'US') then
        raise exception 'bad_country' using errcode = '22023';
    end if;

    perform pg_advisory_xact_lock(hashtext('bh_submit_listing:' || v_uid::text));

    if p_submission is not null then
        select * into v_resp from public.bh_responses
         where submission_key = p_submission
         for update;
        if v_resp.id is not null and v_resp.user_id is not null and v_resp.user_id <> v_uid then
            v_resp := null;
        end if;
        if v_resp.id is not null and v_resp.outcome = 'listing_pending' and v_resp.provider_id is not null then
            return jsonb_build_object('status', 'pending', 'provider_id', v_resp.provider_id,
                                      'response_id', v_resp.id, 'repeat', true);
        end if;
    end if;

    select p.id into v_id
      from public.providers p
      join public.provider_owners o on o.provider_id = p.id and o.user_id = v_uid
     where p.status = 'pending' and p.source = 'self'
       and p.name_norm = public.bh_norm(p_name)
       and p.updated_at > now() - interval '10 minutes'
     limit 1;
    if v_id is not null then
        if v_resp.id is not null then
            update public.bh_responses
               set user_id = v_uid, provider_id = v_id, outcome = 'listing_pending'
             where id = v_resp.id;
        end if;
        return jsonb_build_object('status', 'pending', 'provider_id', v_id,
                                  'response_id', v_resp.id, 'repeat', true);
    end if;

    if (select count(*) from public.providers p
          join public.provider_owners o on o.provider_id = p.id
         where o.user_id = v_uid and p.status = 'pending') >= 3 then
        raise exception 'too_many_pending' using errcode = '54000';
    end if;

    select coalesce(array_agg(distinct k), '{}') into v_spec
      from unnest(coalesce(p_specialty, '{}')) k
     where k in ('dentist', 'orthodontist', 'plastic_surgery', 'aesthetician', 'obgyn',
                 'physical_therapy', 'massage', 'optometry', 'general', 'pediatrics',
                 'cardiology', 'urgent_care', 'mental_health', 'pharmacy', 'telehealth');
    if coalesce(array_length(v_spec, 1), 0) = 0 then
        v_spec := array['general'];
    end if;
    v_spec := v_spec[1:5];

    if v_site is not null and v_site !~* '^https?://' then
        v_site := case when v_site ~* '^[a-z0-9.-]+\.[a-z]{2,}(/.*)?$' then 'https://' || v_site end;
    end if;

    if v_lat is null or v_lng is null
       or v_lat not between 25 and 35 or v_lng not between -110 and -100 then
        v_lat := null; v_lng := null;
        select c.lat, c.lng into v_lat, v_lng from (values
            ('juarez',    31.6904, -106.4245),
            ('paso',      31.7619, -106.4850),
            ('chihuahua', 28.6320, -106.0691)
        ) as c(k, lat, lng)
        where public.bh_norm(v_city) like '%' || c.k || '%'
        limit 1;
        v_lat := coalesce(v_lat, case when v_country = 'US' then 31.7619 else 31.6904 end);
        v_lng := coalesce(v_lng, case when v_country = 'US' then -106.4850 else -106.4245 end);
    end if;

    insert into public.providers (
        name, specialty, country, city, address, lat, lng,
        phone, email, website, description, source, status, updated_at, updated_by
    ) values (
        btrim(p_name), v_spec, v_country, v_city,
        coalesce(nullif(btrim(left(p_address, 300)), ''), v_city),
        v_lat, v_lng,
        nullif(btrim(left(p_phone, 40)), ''), nullif(lower(btrim(left(p_email, 160))), ''),
        v_site, nullif(btrim(left(p_description, 2000)), ''),
        'self', 'pending', now(), v_uid
    ) returning id into v_id;

    insert into public.provider_owners (provider_id, user_id, role) values (v_id, v_uid, 'owner');

    if v_resp.id is not null then
        update public.bh_responses
           set user_id = v_uid, provider_id = v_id, outcome = 'listing_pending'
         where id = v_resp.id;
    end if;

    return jsonb_build_object('status', 'pending', 'provider_id', v_id, 'response_id', v_resp.id);
end;
$$;

revoke all on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) from public, anon;
grant execute on function public.bh_submit_listing(uuid, text, text[], text, text, text, text, text, text, text, double precision, double precision) to authenticated;

revoke insert on public.provider_claims from anon, authenticated;
grant insert (provider_id, user_id, evidence) on public.provider_claims to authenticated;

revoke execute on function public.providers_norm_trg() from public;
