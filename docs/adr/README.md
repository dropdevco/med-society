# Architecture decision records

One file per decision that had a real alternative. Each has: Context, Decision, Alternatives considered, Consequences, Status.

| # | Decision | Status |
|---|---|---|
| [0001](0001-separate-source-pipeline.md) | Organization data comes in through a separate pipeline in `scripts/sources/` | Proposed |
| [0002](0002-source-access-policy.md) | Read a source only when it is open or we hold written permission; identify honestly; never work around a block | Proposed |
| [0003](0003-affiliation-data-model.md) | Affiliations live in their own tables, not on `providers` | Accepted, revised by 0007 |
| [0004](0004-matching-and-freshness.md) | Cédula confirms, a name alone goes to review; keep the last good result; lapse after two missed runs | Accepted |
| [0005](0005-meaning-of-verified.md) | What the "Verified" badge means | Proposed, needs Carlos |
| [0006](0006-pipeline-runtime.md) | The pipeline ships as one Docker image and runs weekly on a Hetzner VM | Proposed |
| [0007](0007-people-and-person-badges.md) | Badges belong to doctors (a random internal UUID), not listings; revises 0003 | Accepted |
| [0008](0008-facility-badges.md) | Facility badges sit on the listing; a register number is the match key | Proposed |
| [0009](0009-identity-review-outcome.md) | After the identity review: migrations split, disagreeing names reviewed, decisions final | Proposed |

Status values: Proposed, Accepted, Superseded by NNNN. A decision that contradicts an accepted one supersedes it explicitly; never edit an accepted record to mean something else.
