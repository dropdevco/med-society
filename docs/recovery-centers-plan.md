# Recovery centers: marking and promoting them (PLAN, nothing applied)

Status 2026-11-09 (updated after implementation; ids re-checked against the staging tables, all 27 found). Staged by the sweep (PR #18): `google_places_tijuana` 72 rows, `google_places_juarez` +67 (24 new). Nothing is in `providers` yet. No migration below is applied.

## 1. How to mark them

What exists today: `providers.specialty` is a closed list; recovery centers are `general`, which maps to the `routine` archetype in `ARCHETYPE_OF` (`src/utils/siteBrief.ts`) and `SITE_ARCHETYPE_OF` (`api/agent.ts:2854`). The `stay` archetype exists but no specialty maps to it. The renderer already honours `c.brief.archetype` first (`api/agent.ts:3138`), so **a site never needs a marker**; the marker is for discovery and for preselecting the Website tab form.

| Option | Schema | Search / sitemap / agent API | Website form | Verdict |
| --- | --- | --- | --- | --- |
| A. `providers.kind text null` (`'stay'`) | 1 nullable column, metadata-only add (no rewrite of 12.6k rows) + a column grant | Filterable everywhere; sitemap/agent need the new column in their select lists and `provider_public`/`my_providers` | `archetype = brief.archetype ?? (kind==='stay' ? 'stay' : ARCHETYPE_OF[specialty[0]])` in both files | **Recommended** |
| B. Side table `provider_kind(provider_id pk, kind)` | No change to `providers` | Every list/search needs a join or second query; agent API and sitemap each need an extra read | Form/renderer do one extra lookup by id | Safe but adds a join to the hot path for 40 rows |
| C. Tag in existing columns (e.g. `service_names` contains `recovery_house`) | None | Works with array filters, but pollutes visible service text and is invisible to type checks | Needs a magic string in both archetype maps | Fragile; avoid |
| D. New value in `specialty` | None in DB, but changes the `Specialty` union, i18n names, filters, sitemap, agent `SPECIALTY_IDS` | Touches every consumer | Easy | Rejected: bigger blast radius than A |

Why A: one-line queries (`where kind='stay'`), one source of truth, and the `brief.archetype` override still wins per site. Cost: `0032` revoked column-level reads for anon, so **a new column is unreadable by anon until granted**; the migration must grant it. Keep `SITE_ARCHETYPE_OF` and `ARCHETYPE_OF` in step (self-contained copies).

Draft migration (NOT applied; number it after the latest at merge time):

```sql
-- 00xx_providers_kind.sql
alter table public.providers add column if not exists kind text
  check (kind is null or kind in ('stay'));
create index if not exists providers_kind_idx on public.providers (kind) where kind is not null;
-- 0032 made anon/authenticated reads column-by-column; a new public column needs its grant.
grant select (kind) on public.providers to anon, authenticated;
-- If provider_public()/my_providers() list columns explicitly, add kind there too.
```

Code that would change with A (separate PR): the two archetype maps (default from `kind`), the provider type + select lists in `api/agent.ts` and `src/utils` loaders, optional "Recovery house" filter chip, `promote-google.ts`.

## 2. How promotion works

Extend `scripts/doctoralia/promote-google.ts` (it already reads `target.table` and inserts `source:'google'` rows; row shape in lines ~277-305). Needed changes:

1. Accept `--target=tijuana-recovery|juarez-recovery`; `buildStaticQueries` already feeds the `found_via` specialty fallback.
2. **Allow-list, not "everything staged"**: `--only=<place_id,...>` or a file of place ids (section 4). Default for these targets = dry run printing the list.
3. Dedupe, in order: same `googlePlaceId`; same `phone_norm`; same `name_norm` + `city_norm` (these normalised columns exist). Any hit = skip and report, never update.
4. Field mapping (same as other Google rows): `name`, `address`, `lat/lng`, `rating`, `reviewCount`, `phone`, `website`, `googlePlaceId`, `source:'google'`, `country:'MX'`, `city:'Tijuana'|'Juárez'`, `specialty:['general']`, `languages:[]`, `kind:'stay'` (once A exists), `email:null`.
5. **`status:'pending'`** (allowed values: live/pending/hidden) so nothing is public before a human looks; flip to `live` per row after review. Today's script leaves status to the default `live`; for these targets set it explicitly.
6. One existing row to touch separately: Better Than Ever (`6f1f2c83-…`) has no `googlePlaceId` but is in the Tijuana staging table as `ChIJ19bJrWZJ2YARL4pQm98DBCM`. Backfill it by hand and set `kind='stay'`. It is a paying client's row, so this is a single named `update`, run only with the user's go-ahead. Likewise `Exclusive care recovery house` (Juárez, `de42ad23-…`) gets `kind='stay'`.

## 3. Border filters

- Tijuana (done in PR #18): `requireMx` drops anything north of the border survey line or with a US-style address. 0 results were dropped in the full run, so no San Diego leak was observed.
- Juárez (**done in this PR**): the box 31.58-31.83 N includes El Paso (31.76 N), and the English queries returned 3 El Paso places (Las Palmas Rehabilitation Hospital, Mountain View Health and Rehabilitation, R&R Rest and Recover Massage). `juarez-recovery` now has `requireMx` with a new `isUsAddress()` (TX/NM/CA/AZ + ZIP or "USA", never when the address says Chih./México/Juárez), applied to search results and again to the Details address. The survey-line check applies to Tijuana only (it models the Pacific coast, not the Rio Grande). The 3 El Paso rows already staged are not on the allow-list, and `promote-google.ts` re-checks `isUsAddress` per candidate.

## 4. Hand-picked review list

Confidence: **clear** = name says recovery house/home/center and the place is a stay; **possible** = needs a look; **not** = exclude. All need a quick Maps/website check before `live`.

Tijuana (staging `google_places_tijuana`):

| Name | place_id | Reviews | Why | Confidence |
| --- | --- | --- | --- |
| Bella Recovery House | ChIJBctCOOc32YARwRKB51EGcTs | 747 | name, website, Zona Centro | clear |
| Cocoon Recovery Home | ChIJuckNdf9L2YARBWVtI24oGmI | 637 | name, health type, website | clear |
| Recovery House Tijuana | ChIJTyaUqOVJ2YARTuGh2dBQ6cc | 454 | name, lodging type | clear |
| Zen & Healthy Recovery | ChIJHSzXvV1J2YARZI0Q214gikY | 235 | lodging, found via bariatric query | clear |
| Dollhouse Recovery TIJUANA MEXICO | ChIJoTiyEjUu2YARUoMalF4flJE | 118 | name, website | clear |
| Luma Recovery House | ChIJTd-JxvVH2YARR2SkiCFiL4Y | 71 | name, website | clear |
| Princess palace recovery | ChIJd4oXFIE32YARvmxHOxehFVo | 62 | name, website | clear |
| Palmas Recovery | ChIJe0EF-TJJ2YARdnIOBcfIjGw | 34 | lodging + doctor type | clear |
| Epione Recovery House | ChIJ_Z1oQrY32YAROJtEgySbNnc | 28 | name (no website) | clear |
| eva surgery recovery house | ChIJJzrLbslL2YARsYZ3E6tCbn4 | 26 | name says surgery, website | clear |
| RECOVERY HOUSE VIVE | ChIJ272FOwBJ2YARXngL4suPq2o | 25 | name, lodging | clear |
| Bella Luna Recovery Home & Spa | ChIJVWj9FgBH2YARDqr7-SkXbZI | 24 | name "Recovery Home", spa+lodging | clear |
| RECOVERY BOUTIQUE | ChIJ5fsTXCdJ2YARyeOgSW1nyVk | 21 | lodging, website | clear |
| Recovery House LULUK | ChIJF-N2Uv5L2YARNOqx1EGrOv4 | 21 | name, lodging | clear |
| Top Doctors recovery house and Spa | ChIJv-JuNQRJ2YARxjwwNjpWlKo | 19 | name | clear |
| Beauty Recovery Home and Spa | ChIJ_Rvp5aFJ2YAR3H6o-dEfIeM | 18 | name, in a tower (check it is a stay) | possible |
| Excellence Recovery House | ChIJ0VspYgA52YAR2POMi3e7HJg | 15 | name, lodging | clear |
| Magnolia Recovery House | ChIJVbfhgCVJ2YARP7yR5q_HE-g | 12 | name; address is an office suite | possible |
| Phoenix Recovery Home | ChIJEfWwrRhL2YARczg6dy6oN6o | 9 | name | clear |
| SALUS surgery recovery | ChIJd0UDMDc32YARGak0_nD7ljo | 8 | name, website | clear |
| Bloom Recovery House | ChIJnUjq6hxJ2YARDTahm_7h6BE | 8 | name | clear |
| Beauty Care Recovery House | ChIJARwu4x1I2YARqhydtvV2MJk | 6 | name, same street as Bloom | clear |
| BAJA PREMIUM RECOVERY | ChIJyQW7ROVJ2YARzzQtFFY4jG0 | 3 | name; 3 reviews only | possible |
| Casa Recuperación | ChIJY3VBCiY22YARxQpw9ZFnJ4E | 18 | generic name, 3.9 stars, could be addiction recovery | possible |
| Casa Del Angel Wellness Spa and Recovery | ChIJ53DV40lJ2YARGwMQXb0QYT0 | 15 | spa + lodging, website; stay unclear | possible |
| IOM Recovery & Health Center | ChIJEwFBeTZH2YARmi195PynsPw | 33 | "health center" in an office suite | possible |
| Better Than Ever the Recovery Center | ChIJ19bJrWZJ2YARL4pQm98DBCM | 35 | already in providers (backfill place id) | existing |

(Place ids are as stored in `google_places_tijuana`; the promote script reads them from the table, not from this doc.)

Juárez (staging `google_places_juarez`): Casa Nefertiti - Recovery Home (`ChIJF7lv9Mtb54YRORA0v40B7ho`, website, 17 reviews): **clear**. 360 Rehab Center (`ChIJbUIE1mpb54YRWGSz0D3ZrTg`, no website, same street as Casa Nefertiti): possible. Refugio del Desierto (`ChIJFdbwogVn54YRGxhstQLNf_c`, lodging): possible, probably a retreat, low. ARIA Medical Center (`ChIJMc7KHgBb54YRUvM2K_3IMNs`, hospital): not, a hospital, not a stay. Existing: Exclusive care recovery house (already listed).

**Exclude:** El Paso places (US); Glam Spa Center (spa, mall unit); Lotus Med Group "Hiperbarica" (hyperbaric clinic, name only mentions Recovery); bariatric and plastic-surgery clinics (CAMI, Centro Quirúrgico EMA, Élite plastic surgery group, MEDICAL HOUSE Aesthetic Clinic, Mexico Bariatric Center, Renew Bariatrics, etc.: surgeons, not stays; most are already or should be filed as their own specialty); physiotherapy centers; addiction rehab (Clínica Nuevo Ser, Clínica Baja del Sol); airport and veterinary results.

## 5. Risks and rollback

- **Wrong listing goes live**: it starts `pending`; if one slips through, `update providers set status='hidden' where id=...` (reversible) or delete if it has no leads/owners. Every inserted row has `source='google'`, so a batch can be found and removed by `googlePlaceId in (...)`.
- **Paying clinics**: only Better Than Ever (and no other paid row) is touched, by a single named update (googlePlaceId + kind). Its site at betterthanever.medsociety.one already works through `brief.archetype`, so the marker must not change its rendering. Check `doctor_sites` after any archetype-map change.
- **Archetype drift**: `src/utils/siteBrief.ts` and `api/agent.ts` hold separate copies; change both in one PR and run the site selftests.
- **Anon read grant**: forgetting the `grant select (kind)` makes `select *` fail for anon on the whole directory (see 0032). Test with an anon key before deploy.
- **Contact data**: recovery houses are businesses, but Google phone/website still fall under the existing contact lockdown (0032); they inherit the same protections as other Google rows.
- **Spend/data**: Places fields are staged only in the two staging tables (the repo's existing practice); nothing new is retained beyond `googlePlaceId` on providers rows.
- **Rollback of the sweep**: `delete from google_places_tijuana` and the 24 new `google_places_juarez` rows (by `found_via`) if unwanted; both tables are service-role only.

## Implemented in PR #18 (code only)

- `sweep-targets.ts` / `sweep.ts`: Juárez border filter (above).
- `scripts/doctoralia/recovery-allowlist.ts`: the hand-picked ids (20 Tijuana + Casa Nefertiti) and TS ports of `bh_norm` / `bh_phone`.
- `promote-google.ts`: `--target=tijuana-recovery|juarez-recovery` -> allow-list only; skip on same googlePlaceId, phone_norm, or name_norm+city_norm (never updates); inserts `status:'pending'`, `specialty:['general']`, `kind:'stay'`; dry run prints INSERT/SKIP per candidate; `--commit` refuses to run until `providers.kind` exists.
- `supabase/migrations/0040_providers_kind.sql` (draft, not applied): column + check, partial index, `grant select (kind)`, `provider_list` view recreated with `kind` appended.
- `kind` is read by: `api/agent.ts` (Row + `SITE_ARCHETYPE_OF` fallback: brief.archetype, then kind, then specialty), `src/utils/siteBrief.ts` `archetypeFor()` used by `SiteBriefForm`, `normalizeProvider`, `Provider` type. The owner dashboard gets `kind` from `my_providers` (`to_jsonb(p)`), so no RPC change; `provider_list` needs the view change above for directory/agent list reads.

## Production steps, in order (none run yet; each needs the user's yes)

1. Apply `0040_providers_kind.sql` (shown in the repo file). Verify: `select count(*) from providers where kind is not null;` returns 0, and an anon-key `select kind from provider_list limit 1` works.
2. Dry-run (read-only, can run any time): `npx tsx scripts/doctoralia/promote-google.ts --target=tijuana-recovery` and `--target=juarez-recovery`.
3. Insert as pending: same commands with `--commit` (21 inserts, `status='pending'`).
4. Mark the two existing rows (each is a single named row):
```sql
update providers set kind = 'stay', "googlePlaceId" = 'ChIJ19bJrWZJ2YARL4pQm98DBCM'
 where id = '6f1f2c83-ca5c-418e-88f9-0e42ef7fb808' and "googlePlaceId" is null;  -- Better Than Ever (paying client)
update providers set kind = 'stay' where id = 'de42ad23-4358-4e2e-bf8a-f0a04111bbd2';  -- Exclusive care recovery house
```
5. After review, per listing: `update providers set status = 'live' where id = '...' and kind = 'stay';`.
Rollback: `update providers set status='hidden' where kind='stay' and source='google' and status='pending';` or `delete from providers where "googlePlaceId" in (<allow-list ids>) and source='google' and status='pending';`; the column rollback is at the bottom of the migration.

## Open questions I could not settle

- Better Than Ever must still render exactly as today: its site stores `brief.archetype`, which wins over `kind`. Confirm in `doctor_sites.content` before step 4.
- 4 of the 21 allow-listed rows have neither phone nor website (VIVE, LULUK, Excellence, Phoenix), 5 more have a phone but no website, and 6 carry US numbers (+1 619 / 858 / 559): normal for medical-tourism houses, but they will look odd as "Tijuana" listings with no Mexican number.
- The allow-list is the 20 "clear" Tijuana rows I judged by name/type/reviews; nobody has opened their Maps pages yet.

## Decisions for the user
1. Marker: A (`providers.kind`) recommended. Yes/no, and who applies the migration.
2. Promote the 20 "clear" Tijuana names + Casa Nefertiti as `pending` first, or hold until the 5-6 "possible" names are checked?
3. Approve the Better Than Ever place-id backfill + `kind='stay'`.
4. Fix the Juárez border filter now (small) before any Juárez promote.
