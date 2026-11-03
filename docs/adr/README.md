# Architecture decision records

One file per decision that had a real alternative. Each has: Context, Decision, Alternatives considered, Consequences, Status.

| # | Decision | Status |
|---|---|---|
| [0001](0001-separate-source-pipeline.md) | Organization data comes in through a separate pipeline in `scripts/sources/` | Proposed |
| [0002](0002-source-access-policy.md) | Read a source only when it is open or we hold written permission; identify honestly; never work around a block | Proposed |
| [0003](0003-affiliation-data-model.md) | Affiliations live in their own tables, not on `providers` | Proposed |
| [0004](0004-matching-and-freshness.md) | Cédula confirms, a name alone goes to review; keep the last good result; lapse after two missed runs | Proposed |
| [0005](0005-meaning-of-verified.md) | What the "Verified" badge means | Proposed, needs Carlos |
| [0006](0006-pipeline-runtime.md) | The pipeline ships as one Docker image and runs weekly on a Hetzner VM | Proposed |
| [0007](0007-people-and-person-badges.md) | Badges belong to people (our own person ID), not listings; revises 0003 | Proposed, for review with Carlos |

Status values: Proposed, Accepted, Superseded by NNNN. A decision that contradicts an accepted one supersedes it explicitly; never edit an accepted record to mean something else.
