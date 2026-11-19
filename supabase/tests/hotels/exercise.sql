-- Made-up hotels. Each check prints t; refused actions print a NOTICE.
insert into public.app_admins values ('00000000-0000-4000-8000-00000000aaaa');

-- Around a point in Zona Río, Tijuana: two live hotels (about 0.2 km and 1.8 km away), a pending one
-- right next to it, a live one 30 km away in Rosarito, and one in Juárez.
insert into public.hotels (id, name, city, lat, lng, status, amenities) values
  ('00000000-0000-4000-8000-0000000000c1', 'Hotel Cerca',    'Tijuana',       32.5290, -117.0230, 'live',    '{clinic_shuttle}'),
  ('00000000-0000-4000-8000-0000000000c2', 'Hotel Medio',    'Tijuana',       32.5230, -117.0050, 'live',    '{}'),
  ('00000000-0000-4000-8000-0000000000c3', 'Hotel Borrador', 'Tijuana',       32.5272, -117.0222, 'pending', '{}'),
  ('00000000-0000-4000-8000-0000000000c4', 'Hotel Lejos',    'Rosarito',      32.3600, -117.0550, 'live',    '{}'),
  ('00000000-0000-4000-8000-0000000000c5', 'Hotel Juárez',   'Ciudad Juárez', 31.7200, -106.4300, 'live',    '{}');

select 'region comes from longitude' as check,
  (select bool_and(region = case when city = 'Ciudad Juárez' then 'elpaso-juarez' else 'sandiego-tijuana' end) from public.hotels) as ok;

do $$ begin insert into public.hotels (name, city, lat, lng, amenities) values ('Mal', 'Tijuana', 32.5, -117, '{spa_magic}');
  raise exception 'unknown amenity accepted'; exception when check_violation then raise notice 'ok: unknown amenity refused'; end $$;
do $$ begin insert into public.hotels (name, city, lat, lng, booking_url) values ('Mal', 'Tijuana', 32.5, -117, 'javascript:alert(1)');
  raise exception 'non-https booking url accepted'; exception when check_violation then raise notice 'ok: non-https booking url refused'; end $$;

-- A visitor sees only live hotels and cannot write.
set role anon;
select 'anon sees the 4 live hotels only' as check, (select count(*) = 4 from public.hotels) as ok;
select 'hotels_near: nearest first, pending and far ones left out' as check,
  (select array_agg(hotel->>'name' order by distance_km) = array['Hotel Cerca', 'Hotel Medio']
     from public.hotels_near(32.5272, -117.0222, 5, 8)) as ok;
select 'hotels_near: distance is in km' as check,
  (select distance_km between 0.1 and 0.4 from public.hotels_near(32.5272, -117.0222, 1, 8)) as ok;
select 'hotels_near: limit is respected' as check, (select count(*) = 1 from public.hotels_near(32.5272, -117.0222, 1, 50)) as ok;
do $$ begin insert into public.hotels (name, city, lat, lng) values ('Spam', 'Tijuana', 32.5, -117);
  raise exception 'anon inserted a hotel'; exception when insufficient_privilege then raise notice 'ok: anon cannot insert'; end $$;
reset role;

-- A signed-in non-admin reads the same and writes nothing.
set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-00000000bbbb', false);
select 'non-admin sees the 4 live hotels only' as check, (select count(*) = 4 from public.hotels) as ok;
do $$ begin insert into public.hotels (name, city, lat, lng) values ('Spam', 'Tijuana', 32.5, -117);
  raise exception 'non-admin inserted a hotel'; exception when insufficient_privilege then raise notice 'ok: non-admin cannot insert'; end $$;
update public.hotels set name = 'Hacked' where id = '00000000-0000-4000-8000-0000000000c1';
delete from public.hotels where id = '00000000-0000-4000-8000-0000000000c2';
reset role;
select 'non-admin update and delete touched nothing' as check,
  (select count(*) = 5 and bool_and(name <> 'Hacked') from public.hotels) as ok;

-- An admin sees drafts, publishes one and hides another.
set role authenticated;
select set_config('test.uid', '00000000-0000-4000-8000-00000000aaaa', false);
select 'admin sees all 5, drafts included' as check, (select count(*) = 5 from public.hotels) as ok;
insert into public.hotels (name, city, lat, lng, status) values ('Hotel Nuevo', 'Tijuana', 32.5280, -117.0200, 'pending');
update public.hotels set status = 'live' where id = '00000000-0000-4000-8000-0000000000c3';
update public.hotels set status = 'hidden' where id = '00000000-0000-4000-8000-0000000000c2';
reset role;
select 'admin writes landed' as check,
  (select count(*) = 6 from public.hotels) and (select status = 'live' from public.hotels where id = '00000000-0000-4000-8000-0000000000c3') as ok;
select 'updated_at moves on update' as check,
  (select updated_at >= created_at from public.hotels where id = '00000000-0000-4000-8000-0000000000c3') as ok;
set role anon;
select 'published draft now nearest, hidden one gone' as check,
  (select array_agg(hotel->>'name' order by distance_km) = array['Hotel Borrador', 'Hotel Cerca']
     from public.hotels_near(32.5272, -117.0222, 5, 8)) as ok;
reset role;
