# 0003. Affiliations in their own tables

Status: Proposed (applies from roadmap phase 2) · Owner: Emilio · 2 Nov 2026

> **Revised by [0007](0007-people-and-person-badges.md) (proposed):** affiliations attach to a person, not a listing. `provider_affiliations` below becomes `people`, `person_identifiers`, `entry_matches`, `provider_people` and `person_affiliations`. The run-ID rules here are unchanged. The full draft is in [`docs/roadmap/phase-2-database-proposal.md`](../roadmap/phase-2-database-proposal.md).

## Context

A doctor can belong to several hospitals, consejos, colegios and associations, each confirmed by a different source, on a different date, with its own validity and review decision. A clinic or hospital can also be a MedSociety listing itself.

## Decision

Six tables, added in one migration (number checked against production's `schema_migrations` first):

- `organizations`: slug, name, kind (`hospital|consejo|colegio|association|regulator|accreditor`), country, website, logo_url, logo_permission_at, provider_id (when the organization is itself a listing).
- `data_sources`: one per source, with access (`open|permission|manual|export`), permission date, scope and vault reference, cadence, last good run.
- `source_runs`: every run, green or red. **Primary key `id uuid` is the run ID the pipeline generates (UUIDv7)**, plus `started_at`, `finished_at`, status, counts and reasons.
- `source_entries`: every row a source has published, keyed by (source, external_id), with `first_seen_run_id`, `last_seen_run_id` and missed-run count.
- `source_observations`: one row per entry per run (`run_id`, `entry_id`, `observed_at`, the row as published that day), so "was this doctor listed on that date, and what did the source say" is a lookup, not a reconstruction.
- `provider_affiliations`: provider ↔ organization, with status (`pending_review|confirmed|rejected|lapsed`), match method and score, evidence, **the `run_id` that created it and the `run_id` that last confirmed it**, who decided and when; unique per provider and organization.

### Run IDs

Every run gets one **UUIDv7** when it starts, and every record the pipeline writes carries it (`runId` plus `observedAt` in the run files; `run_id` columns in the database). UUIDv7 is unique without coordination between machines and ordered by time, so indexes on it stay compact as history grows. `source_observations` grows by the size of every source each week; index it on `(run_id)` and `(entry_id, observed_at)`, and partition it by month once it passes a few million rows.

RLS is on. Anonymous users read organizations and confirmed affiliations only, through `provider_list` and `provider_public()`. Writes go through the service role (pipeline) and `admin_*` SECURITY DEFINER functions guarded by `_admin_guard()`.

## Alternatives considered

- **Columns or a jsonb array on `providers`.** Loses the per-source history, the review trail and missed-run counting; every new kind of badge would be a schema change on the busiest table.
- **One generic `badges` table.** Mixes the organization's identity with the evidence, so a renamed hospital or a new logo would have to be fixed on every row.
- **Timestamp or sequential run IDs.** A timestamp collides when two machines or two sources start in the same second; a database sequence needs a connection before a run can name itself, and runs also happen offline on a laptop. A random UUIDv4 is unique but scatters index inserts.

## Consequences

- `provider_list` (migration 0021) is re-created to expose confirmed affiliations to the search page; `provider_public` gains them too.
- Matching and review state is queryable for the admin dashboard and auditable per decision.
