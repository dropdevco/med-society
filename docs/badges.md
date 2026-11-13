# Organization badges

Status: built on `feat/hospital-angeles-directory` · Owner: Emilio · Last updated 6 Nov 2026

A badge says an outside organization lists this doctor. It appears on the search card and profile, and in `/api/v1` and JSON-LD.

## Where a badge comes from

```
source run (run_id) → source_entries → doctor_source_ids (matched once) → doctors → doctor_listings → the card
                                                                            └ doctor_affiliations → providers.badges (cache)
```

- A doctor is one row in `doctors` with a random UUID. The UUID is internal: **no form, page or message ever asks a doctor for it.** Doctors are found by cédula or name.
- `providers.badges` is a cache of confirmed, unexpired badges, rebuilt by `refresh_provider_badges` after each run and each review. `provider_list` and `provider_public()` expose it.
- A listing's URL stays `/providers/:id`.
- **A clinic's badge sits on the listing, not on a doctor** ([ADR 0008](adr/0008-facility-badges.md)): source run → `source_entries` → `facility_source_ids` → `listing_affiliations` → `providers.badges`. `refresh_listing_badges` builds the cache from both kinds.

## Kinds

| Group | Organization kinds | Label | Ring colour |
|---|---|---|---|
| Credential | `consejo` | Certified specialty ("Radiología e Imagen") | `--accent` |
| Affiliation | `hospital`, `colegio`, `association` | Hospital site ("Star Médica Ciudad Juárez"), directory ("Recovery centers") | `--affil` |
| Facility | `regulator`, `accreditor` | Register ("REPSSABI") | `--facility` |

## How a badge is earned and lost

| Event | Result |
|---|---|
| A cédula on the record is one we hold, and the name is similar | Confirmed by the system (tier 1) |
| The cédula matches but the name is very different, or cédulas point at two doctors | `/admin` → Verification |
| No cédula, similar name | `/admin` → Verification. A name alone is never confirmed |
| Nothing similar | Unmatched. The doctor is not in MedSociety |
| Missing from two green runs (directory sources) | Lapses; leaves the card |
| Certification past its `valid_to` | Leaves the card at the next rebuild |
| A clinic's register number is one tied to a listing | Confirmed by the system |
| A clinic matches by name only | `/admin` → Verification → Clinics to review, exact name or not |
| A red run | Nothing changes |
| Removed by hand (`badges:manual remove`) | Hidden; no run brings it back until `restore` |
| Added or changed by hand | Stays as set; runs never overwrite or lapse it |

## Changing a badge by hand

`npm run badges:manual` ([ADR 0010](adr/0010-badges-changed-by-hand.md)). Production reads `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`; set `SOURCES_DB_URL=http://127.0.0.1:54331` for the sandbox. Nothing is written without `--commit`.

```bash
npm run badges:manual -- find "Grand Care"                                  # page IDs by name
npm run badges:manual -- list    --listing=<page ID>                         # what shows, and every badge row behind it
npm run badges:manual -- add     --listing=<page ID> --org=starmedica --label="Star Médica Ciudad Juárez" [--url=https://…] [--valid-to=2028-01-31] [--note="why"] --commit
npm run badges:manual -- change  --listing=<page ID> --org=starmedica [--label=<current>] [--new-label=…] [--url=…] [--valid-from=…] [--valid-to=…] --commit
npm run badges:manual -- remove  --listing=<page ID> --org=conacem [--label=…] [--note="why"] --commit
npm run badges:manual -- restore --listing=<page ID> --org=conacem [--label=…] --commit
npm run badges:manual -- undo    --run=<run ID> --commit                     # printed after every change
```

| Rule | Why |
|---|---|
| The page ID is the UUID in `/providers/<id>`; the doctor's ID is never typed | `doctors.id` is internal |
| A doctor's badge shows on all their listings; COEPRIS and the Padrón stay on the listing | Badges belong to people, facility badges to places |
| `remove` hides a source's badge and deletes one added by hand | A deleted source badge would come back on the next run |
| Only badges added by hand can be changed | A source's next run would overwrite the change |
| A run never overwrites or lapses a badge added by hand | The person's decision stands until they change it |
| `undo` refuses if the badge changed after that run | Undo the later run first |

## Display

- **Card:** `CardBadges`: credential and facility tiles, a separator, the first two affiliations, then "+N more". A tile opens its details without opening the profile.
- **Profile:** `ProfileBadges`: every badge under Credentials / Affiliations / Facility.
- **Details:** organization, consejo, certificate, verified on, valid from/to, link to the source.
- **Links:** a badge links to the doctor's own page at the source ("See the source"): Hospital Ángeles' profile, Star Médica's card. **Where a source cannot show the doctor, the badge links to the organization's information page instead** ("What is CONACEM?"), so nobody lands on an empty search. For a new source like that, set `data_sources.doctor_links = false` and `organizations.info_url`.
- **Logos:** a tile shows the organization's logo only when `organizations.logo_permission_at` is set; until then, its initials (HA, SM, CON). All six organizations are authorized ([Logo use](sources/README.md#logo-use)), and migration 0045 turns them on. For a new organization, record its OK first. Files live in `public/logos/orgs/` and ship with the site; keep them at 324×114 or smaller. A tile falls back to initials if its file fails to load.
- **Text:** `badges.*` in `src/i18n/locales/{en,es}.json`. **Component:** `src/components/provider/OrgBadges.tsx`. **Rules:** `src/utils/orgBadges.ts`.

## Checks

```bash
npm run badges:selftest          # all six badges: group, link, card, JSON-LD, API, both languages
npm run sources:selftest         # parsers, matching, what each source's badge will read
bash supabase/tests/doctors-and-badges/run.sh  # 0042 to 0045 in a throwaway Postgres
```

## Not built yet

A "member of" search filter, facility badges beyond recovery centers (the rest of REPSSABI, CLUES), a "recovery center" specialty and real listings for the centers, new listings for unmatched doctors, the Verified badge's new meaning ([ADR 0005](adr/0005-meaning-of-verified.md)), and tier 2 matching (a cédula one digit off).
