# Organization badges

Status: built on `feat/hospital-angeles-directory` · Owner: Emilio · Last updated 5 Nov 2026

A badge says an outside organization lists this doctor. It appears on the search card and profile, and in `/api/v1` and JSON-LD.

## Where a badge comes from

```
source run (run_id) → source_entries → doctor_source_ids (matched once) → doctors → doctor_listings → the card
                                                                            └ doctor_affiliations → providers.badges (cache)
```

- A doctor is one row in `doctors` with a random UUID. The UUID is internal: **no form, page or message ever asks a doctor for it.** Doctors are found by cédula or name.
- `providers.badges` is a cache of confirmed, unexpired badges, rebuilt by `refresh_provider_badges` after each run and each review. `provider_list` and `provider_public()` expose it.
- A listing's URL stays `/providers/:id`.

## Kinds

| Group | Organization kinds | Label | Ring colour |
|---|---|---|---|
| Credential | `consejo` | Certified specialty ("Radiología e Imagen") | `--accent` |
| Affiliation | `hospital`, `colegio`, `association` | Hospital site ("Star Médica Ciudad Juárez") | `--affil` |
| Facility | `regulator`, `accreditor` | Not built yet | `--facility` |

## How a badge is earned and lost

| Event | Result |
|---|---|
| A cédula on the record is one we hold, and the name is similar | Confirmed by the system (tier 1) |
| The cédula matches but the name is very different, or cédulas point at two doctors | `/admin` → Verification |
| No cédula, similar name | `/admin` → Verification. A name alone is never confirmed |
| Nothing similar | Unmatched. The doctor is not in MedSociety |
| Missing from two green runs (directory sources) | Lapses; leaves the card |
| Certification past its `valid_to` | Leaves the card at the next rebuild |
| A red run | Nothing changes |

## Display

- **Card:** `CardBadges`: credential tiles, a separator, the first two affiliations, then "+N more". A tile opens its details without opening the profile.
- **Profile:** `ProfileBadges`: every badge under Credentials / Affiliations / Facility.
- **Details:** organization, consejo, certificate, verified on, valid from/to, link to the source.
- **Links:** a badge links to the doctor's own page at the source ("See the source"): Hospital Ángeles' profile, Star Médica's card. **Where a source cannot show the doctor, the badge links to the organization's information page instead** ("What is CONACEM?"), so nobody lands on an empty search. For a new source like that, set `data_sources.doctor_links = false` and `organizations.info_url`.
- **Logos:** a tile shows the organization's logo only when `organizations.logo_permission_at` is set; until then, its initials (HA, SM, CON). Record each organization's OK before setting `logo_url`. Files go in `public/logos/orgs/`, which is git-ignored for now; `scripts/sources/sandbox/logos.sql` turns them on in the sandbox as a test build.
- **Text:** `badges.*` in `src/i18n/locales/{en,es}.json`. **Component:** `src/components/provider/OrgBadges.tsx`.

## Not built yet

A "member of" search filter, facility badges (COEPRIS, CLUES), new listings for unmatched doctors, the Verified badge's new meaning ([ADR 0005](adr/0005-meaning-of-verified.md)), and tier 2 matching (a cédula one digit off).
