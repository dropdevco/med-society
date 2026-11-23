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
- The close calls get a person's eyes after the fact (added 18 Nov 2026, migration 0055): /admin → Verification has a "Near the bar" card (every record scored 70–89, linked or waiting, and every cédula conflict) and a side-by-side compare of the record against the doctor. A daily e-mail (`/api/claim-notify?job=review`, to `REVIEW_ALERT_TO`, band `REVIEW_ALERT_BAND`) lists the new ones. A wrong link is put right with `scorer_split` or `scorer_undo_run`; there is no one-click undo of a single link yet.

## Model comparison (17 Nov 2026)

50 queued doctors, spread over Hospital Ángeles, CONACEM, Star Médica and Baja Health Cluster (13, 13, 11, 13), exact and similar names alike. Claude judged them from the same evidence the models saw: 39 the same person, 9 different, 2 too close to call ("Alfonso García Chávez" vs "Dr. Alfonso Garcia", "Daniel A. Maciel Roman" vs "Dr. Daniel Maciel"). Same prompt and output schema for every model, through OpenRouter.

| Model | Links at 80+ | Wrong links | Missed matches | $ per 1,000 items | Avg seconds |
|---|---|---|---|---|---|
| **google/gemini-3.8-flash** (chosen) | 28 | 0 | 11 | 1.70 | 4.0 |
| deepseek/deepseek-v4.1-flash | 32 | 2 | 9 | 0.49 | 4.5 |
| deepseek/deepseek-v4-pro-0813 | 29 | 1 | 11 | 2.74 | 6.4 |
| google/gemini-4-hydrogen | 26 | 1 | 14 | 6.07 | 4.3 |

Every "wrong" link above is one of the two close calls, linked at 85 to 92; no model linked a doctor the judge called different. Gemini 3.8 Flash was the only one to hold back on both, so it was chosen, as the rule above says (fewest wrong links, then misses, then cost). DeepSeek V4.1 Flash is the cheaper option at a quarter of the cost, and links four more true matches, at the price of linking close calls. One DeepSeek V4 Pro answer was not valid JSON. At a bar of 90 neither flash model made a wrong link, but each missed more (13 and 17).

Run again with `npx tsx --env-file=.env.local scripts/sources/compare-models.ts --report --bar=80` (the sample, answer key and answers are in `scripts/sources/.data/scorer/compare/`, not in git).

## First production run (17 Nov 2026)

Run `01a1eab6-8de2-7c24-9a84-6facee5f0000`, Gemini 3.8 Flash, auto-link at 80. It was meant to stop when Emilio asked at about 780 items; the shell stopped but the Node process did not, and it ran on until 18:34 UTC. It scored **1,129 of 1,185** queued items (482 approve, 350 needs a person, 297 reject) and **linked 482**. Listings showing a badge went from 92 to 347. The run is recorded red, "interrupted"; its scores and links stand, and `--undo` takes all 482 back at once. The remaining 56 items are scored by a second run.
