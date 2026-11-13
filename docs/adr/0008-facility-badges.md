# 0008. Facility badges sit on the listing, and a register number is the match key

Status: Proposed · Owner: Emilio · 6 Nov 2026

## Context

Post-operative recovery centers are a real risk for patients: local reports count about 97 in Tijuana, with only 5 to 8 certified or regulated. Three sources can show which ones are on record: COEPRIS's REPSSABI register, the state's Padrón Estatal de Salud, and the Baja Health Cluster directory.

These are places, not people. [ADR 0007](0007-people-and-person-badges.md) already says facility badges stay on clinic listings, but everything built so far runs through `doctors`. A clinic has no cédula, so the match key of [ADR 0004](0004-matching-and-freshness.md) does not apply either.

## Decision

- **A facility badge belongs to a listing:** `listing_affiliations`, provider × organization × label, with the same run IDs, validity and lapse rules as `doctor_affiliations`. `facility_source_ids` holds the match decision, once per source record.
- **`data_sources.entity`** says whether a source describes doctors or facilities. The loader takes the matching path.
- **The REPSSABI register number is the facility's cédula.** A record that shows a number we already tied to a listing confirms itself. **A name alone goes to review**, as for doctors.
- **Only "confirmed" and "rejected" are final.** Unlike doctors, unmatched and probable facility records are asked again each run, because a listing may have been added since.
- **`refresh_listing_badges`** rebuilds `providers.badges` from both kinds, so a listing can carry both.
- **Recovery centers only, for now.** The REPSSABI adapter keeps class 623111 in the Tijuana area; the rest of the register's 276 records are left for later.

## Alternatives considered

- **A `doctors` row per clinic.** No new tables, but it breaks "a doctor is a person", and every clinic would enter the doctor matcher.
- **Name match confirms when exact.** Quicker, but two businesses can share a name, and ADR 0004 says a name is never proof.
- **Filtering the whole register by a list of names we like.** The class code is the regulator's own; a hand list would go stale and hide our judgement in code.

## Consequences

- A badge needs a listing, and none of these centers has one. Adding them is catalog work (David); the sandbox creates them from the register as a test build.
- The listing has no "recovery center" specialty yet, so they are found by name.
- The migration is separate (0044), so Carlos's review of the doctor tables stands. It needs 0042 and 0043 applied first.
- The Padrón's link is the proof for REPSSABI where it exists, because COEPRIS's own QR links answered a database error on 6 Nov 2026. See [the source page](../sources/coepris-bc.md).
