# 0003. Affiliations in their own tables

Status: Proposed (applies from roadmap phase 2) · Owner: Emilio · 2 Nov 2026

## Context

A doctor can belong to several hospitals, consejos, colegios and associations, each confirmed by a different source, on a different date, with its own validity and review decision. A clinic or hospital can also be a MedSociety listing itself.

## Decision

Five tables, added in one migration (number checked against production's `schema_migrations` first):

- `organizations`: slug, name, kind (`hospital|consejo|colegio|association|regulator|accreditor`), country, website, logo_url, logo_permission_at, provider_id (when the organization is itself a listing).
- `data_sources`: one per source, with access (`open|permission|manual|export`), permission date, scope and vault reference, cadence, last good run.
- `source_runs`: every run, green or red, with counts and the reason.
- `source_entries`: every row a source has published, with first/last seen run and missed-run count.
- `provider_affiliations`: provider ↔ organization, with status (`pending_review|confirmed|rejected|lapsed`), match method and score, evidence, who decided and when; unique per provider and organization.

RLS is on. Anonymous users read organizations and confirmed affiliations only, through `provider_list` and `provider_public()`. Writes go through the service role (pipeline) and `admin_*` SECURITY DEFINER functions guarded by `_admin_guard()`.

## Alternatives considered

- **Columns or a jsonb array on `providers`.** Loses the per-source history, the review trail and missed-run counting; every new kind of badge would be a schema change on the busiest table.
- **One generic `badges` table.** Mixes the organization's identity with the evidence, so a renamed hospital or a new logo would have to be fixed on every row.

## Consequences

- `provider_list` (migration 0021) is re-created to expose confirmed affiliations to the search page; `provider_public` gains them too.
- Matching and review state is queryable for the admin dashboard and auditable per decision.
