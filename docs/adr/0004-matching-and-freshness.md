# 0004. Matching and freshness rules

Status: Proposed · Owner: Emilio · 2 Nov 2026

## Context

Sources rarely share an identifier with us. Names repeat across the directory, sites go down, and organizations update their lists irregularly. A badge that is wrong in either direction (a doctor who left still badged, or a badge removed because a site was down) misleads patients.

## Decision

- **Cédula is the match key.** An exact cédula match against a number we already hold (today in `doctoralia_doctors.cedulas`), plus a name check, confirms automatically.
- **A name match alone goes to human review**, scored by name similarity (`providers.name_norm`, trigram), specialty and city. Nothing name-only is confirmed by the system.
- **A failed run never removes a badge.** A red run keeps the last good result; a badge is never flipped to expired because a source was down or blocked.
- **Two missed runs lapse a badge.** A doctor missing from two consecutive *green* runs of a source loses that badge, and the doctor is told.
- **A run is red** when the source returns nothing, a target page fails, the row count drops more than 30% against the last good run, or most rows are missing a name.

## Alternatives considered

- **Auto-confirm high name similarity.** Rejected by the team: common names in one city would badge the wrong doctor.
- **Lapse on the first miss.** Too jumpy for sites that drop a page for a day.
- **Never lapse, only add.** Badges would outlive the affiliation, which is the failure patients are hurt by.

## Consequences

- Sources without cédulas (Hospital Ángeles, CCPERBC, Baja Health Cluster) produce review work for every match.
- Weekly cadence plus two-miss lapse means a departure shows within about two weeks.
