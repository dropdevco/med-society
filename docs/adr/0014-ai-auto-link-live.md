# 0014. AI matches at 80 or above become badges on the site

Status: Accepted (Emilio, 17 Nov 2026) · Owner: Emilio · Supersedes in part [0004](0004-matching-and-freshness.md) ("a name alone never confirms") and [0012](0012-ai-match-scorer.md) (shadow mode until a checked sample). **Carlos accepted 0004; he has not yet seen this change.**

## Context

On 17 Nov the PR had to go live by midday with the AI matching on, showing badges on the site and the confidence in the database. About 1,100 name-only matches waited in `/admin` → Verification, and with no reviewer working the queue, almost no source badge reached the site: Star Médica's 90, plus 2 Baja Health Cluster doctors confirmed by cédula.

ADR 0004 says a name alone never confirms a match. ADR 0012 kept the AI scorer in shadow mode until a person had checked about 50 scores against their own decisions. The notes from the 17 Nov meeting say the same ("keep the scorer in shadow mode until the model is picked and the review flow works"). Emilio chose to go live anyway, and to pick the model by comparing Gemini and DeepSeek on a 50-doctor sample judged by Claude in place of a person.

## Decision

- **A match the scorer approves at 80 or above is linked, and its badge shows on the site like any confirmed badge.** The setting is `SCORER_AUTO_LINK_AT=80`. The site does not mark these badges differently; the score, verdict, reason and model are in `match_scores` and in `/admin` → Verification.
- **A cédula conflict is never auto-linked** (tier 1 stays with a person), and neither is a clinic. Both rules are in `scorer_auto_link`.
- **Every link stays reversible.** Each one is in `match_links` with the run that made it and the rows as they were. `npm run sources:score -- --undo=<run>` puts a whole run back; `--split=<run> --doctor=<uuid> --group=…` separates people one run merged.
- **The model is chosen on the 50-doctor sample** (`scripts/sources/compare-models.ts`): the fewest wrong links at the bar comes first, then the fewest missed matches, then cost. The result and the chosen model are recorded below.

## Alternatives considered

- **Keep shadow mode (ADR 0012).** Safest, and what the meeting notes said, but no new badges would reach the site today.
- **Show AI matches with a label and their confidence ("AI match 91%").** Lets patients tell an AI match from a confirmed one. Not chosen: Emilio wanted them to read as normal badges.
- **A person checks the 50 before going live.** The check ADR 0012 asked for; replaced by Claude's judgement to meet the deadline. A person should still check the sample sheet (`--sample=<run>`) and the first links.

## Consequences

- Some badges on the site rest on a name, specialty and city, not on a cédula. The wrong-link rate measured on the sample is the expected error; it is recorded below.
- Carlos should be told: this reverses the rule he accepted in 0004.
- "Verified" ([0005](0005-meaning-of-verified.md)) is still undecided; an AI-linked badge must not count as verified until it is.

## Model comparison (17 Nov 2026)

To be filled in from the comparison run.
