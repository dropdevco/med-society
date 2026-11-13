# 0001. A separate pipeline for organization sources

Status: Proposed · Owner: Emilio · 2 Nov 2026

## Context

Organization badges (plan stream J) and credential checks (stream E) need data from many outside sites: hospital doctor directories, consejos, colegios, associations and regulators. Each source is read weekly, compared with the last run, matched to our listings and reviewed. The repo already has one importer, `scripts/doctoralia/`, built for a one-off bulk load of listings from one site.

## Decision

Build a new pipeline in `scripts/sources/`: one shared core (polite fetch, robots check, run judge, snapshots, later matching and loading) and one small adapter per source. It imports nothing from `scripts/doctoralia/`.

## Alternatives considered

- **Extend `scripts/doctoralia/`.** Its job is creating listings from one site, with its own staging tables and phases. Bending it into a multi-source, recurring badge feed would couple two unrelated lifecycles.
- **Vercel functions.** 11 of the 12 functions the Hobby plan allows are used, functions time out long before a browser-rendered source finishes, and they cannot hold Playwright.
- **Supabase Edge Functions.** Same runtime limits, no headless browser, and harder to run on a laptop.

## Consequences

- Adding a source means writing one adapter file and its self-test cases; the core does not change.
- Two importers exist side by side. Doctoralia remains the source of listings; `scripts/sources/` only links listings to organizations.
- The pipeline needs its own runtime (see 0006).
