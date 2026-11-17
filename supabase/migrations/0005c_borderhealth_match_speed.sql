-- Already applied to production as "0005c_borderhealth_match_speed" (version 20260926075057).
-- Copied from production's schema_migrations so the repo can rebuild the schema.
-- Do not apply it again.

alter table public.providers
    add column if not exists name_norm  text,
    add column if not exists city_norm  text,
    add column if not exists phone_norm text;

create or replace function public.providers_norm_trg()
returns trigger
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
    new.name_norm  := public.bh_norm(new.name);
    new.city_norm  := public.bh_norm(new.city);
    new.phone_norm := public.bh_phone(new.phone);
    return new;
end;
$$;

drop trigger if exists providers_norm on public.providers;
create trigger providers_norm
    before insert or update of name, city, phone on public.providers
    for each row execute function public.providers_norm_trg();

update public.providers
   set name_norm = public.bh_norm(name), city_norm = public.bh_norm(city), phone_norm = public.bh_phone(phone);

create index if not exists providers_name_norm_trgm
    on public.providers using gin (name_norm extensions.gin_trgm_ops);
create index if not exists providers_phone_norm_idx on public.providers (phone_norm);

create or replace function public.bh_match_providers(
    p_name  text,
    p_org   text,
    p_phone text default null,
    p_email text default null,
    p_city  text default null
)
returns table (
    id         uuid,
    name       text,
    address    text,
    city       text,
    country    text,
    specialty  text[],
    "imageUrl" text,
    owned      boolean,
    score      real,
    reasons    text[]
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
    with q as (
        select nullif(public.bh_norm(p_name), '')  as n,
               nullif(public.bh_norm(p_org), '')   as o,
               case when length(public.bh_phone(p_phone)) >= 7 then public.bh_phone(p_phone) end as ph,
               nullif(lower(btrim(p_email)), '')    as em,
               public.bh_norm(p_city)                as c
    ),
    scored as (
        select p.*,
               (q.ph is not null and p.phone_norm = q.ph)          as m_phone,
               (q.em is not null and lower(btrim(p.email)) = q.em)             as m_email,
               greatest(
                   coalesce(extensions.similarity(p.name_norm, q.n), 0),
                   coalesce(extensions.similarity(p.name_norm, q.o), 0),
                   case when length(q.n) >= 5 then coalesce(extensions.strict_word_similarity(q.n, p.name_norm), 0) * 0.9 else 0 end,
                   case when length(q.o) >= 5 then coalesce(extensions.strict_word_similarity(q.o, p.name_norm), 0) * 0.9 else 0 end
               )                                                                as m_name,
               (q.c <> '' and p.city_norm <> '' and (p.city_norm like '%' || q.c || '%'
                               or q.c like '%' || p.city_norm || '%')) as m_city
        from public.providers p, q
        where p.status = 'live'
    ),
    ranked as (
        select s.id, s.name, s.address, s.city, s.country, s.specialty, s."imageUrl",
               exists (select 1 from public.provider_owners o where o.provider_id = s.id) as owned,
               (s.m_name
                 + case when s.m_phone then 1 else 0 end
                 + case when s.m_email then 1 else 0 end
                 + case when s.m_city  then 0.1 else 0 end)::real as score,
               array_remove(array[
                   case when s.m_phone then 'phone' end,
                   case when s.m_email then 'email' end,
                   case when s.m_name >= 0.5 then 'name' end,
                   case when s.m_city then 'city' end
               ], null) as reasons
        from scored s
        where s.m_phone or s.m_email or s.m_name >= 0.5
    ),
    deduped as (
        select distinct on (lower(r.name), lower(r.address)) r.*
        from ranked r
        order by lower(r.name), lower(r.address), r.owned desc, r.score desc
    )
    select * from deduped
    order by score desc
    limit 5;
$$;
