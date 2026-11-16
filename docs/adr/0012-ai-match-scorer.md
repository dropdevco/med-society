# 0012. An AI scorer rates name-only matches, in shadow mode first

Status: Accepted (Emilio, 16 Nov 2026) · Owner: Emilio · Leaves [0004](0004-matching-and-freshness.md) in force until shadow mode ends

## Context

About 1,100 doctor and clinic matches wait in `/admin` → Verification because their sources publish no cédula: Hospital Ángeles, CONACEM, the clinic registers, and soon Baja Health Cluster's 106 doctors, of whom 5 show a cédula. [ADR 0004](0004-matching-and-freshness.md), accepted by Carlos, says a name alone never confirms. The action items of 16 Nov say the same.

Emilio wants a matcher that weighs everything we know: name, specialty, city, cluster, the other doctors with that name, and the cédulas and badges already held. When the evidence is strong it should link the record to the doctor's UUID automatically, above a score of about 80. One example is a unique name and specialty within one cluster. Every link must be reversible by run ID, and a UUID that turns out to hold several people must be splittable.

## Decision

- **Build the scorer now, in shadow mode.** For each queued record it gathers the evidence, asks Claude (Opus 5.5, through OpenRouter as the rest of the project does; Emilio, 16 Nov 2026) for a score from 0 to 100, a verdict (approve, reject or needs-human) and a short reason, and stores them with a run ID and time. **It links nothing.** `/admin` shows the score and reason beside each item; a person still decides.
- **Auto-linking at 80 or above is one setting, off by default.** It is turned on only after a person has checked a sample of about 50 scored records against their own decisions. Turning it on is a change to ADR 0004 and is recorded here when it happens. Even then, a cédula conflict always goes to a person.
- **Every link is reversible.** An auto-link writes its own run ID. Undoing that run restores every row it touched. A split tool takes a run ID and a UUID and moves the records that run attached into new UUIDs, as many as there were people.
- **Records still unresolved go on an outreach list,** to ask the organization by e-mail or phone.
- **Data sent to the model is the organization's public directory record and our listing's public fields.** No contact data, no patient data.

## Alternatives considered

- **Auto-link at 80 from day one.** Fastest, but it overrides ADR 0004 before anyone has seen how the scores behave on our data. Shadow mode costs a few weeks of clicks.
- **Recommend only, forever.** Safe, but at about 1,100 items the queue is the bottleneck.
- **A fixed rule (unique name and specialty within a cluster) without AI.** Predictable, and worth keeping as one of the facts the scorer sees, but it misses the cases a person would catch: shortened names, a second surname dropped, a specialty written two ways.

- **The Anthropic SDK with its own API key.** The API would guarantee the answer's format, but it adds a second AI key to hold and rotate. OpenRouter is already how `api/ai-search.ts` and the review scripts reach Claude, it supports the same structured output, and the scorer validates every field of every answer before storing it anyway.

## Consequences

- `OPENROUTER_API_KEY` is needed where the scorer runs: `.env.local` on a laptop, a secret of `med-society-ops` on Actions. On 16 Nov 2026 it was set only in Vercel, so the scorer had not yet made a live call.

## How it is built (16 Nov 2026)

- Migration `0048_match_scores.sql`: `match_scores` (one row per item scored, with the run, model, reason and the exact fields the model saw), `match_links` (what each auto-link changed), and `scorer_auto_link`, `scorer_undo_run`, `scorer_split`, callable by the service role only. Both review queues return the latest score as `ai_score`.
- `npm run sources:score` scores the queue (50 items by default, `--limit=all` for every one), `--sample=<run>` writes the sheet for the check of about 50, `--outreach` lists what is still unresolved, `--undo=<run>` and `--split=<run> --doctor=<uuid> --group=…` reverse a run's links. `--dry` and `--try=N` write nothing.
- Auto-linking is the environment setting `SCORER_AUTO_LINK_AT` (for example `80`). Unset, the scorer links nothing.
- Scores are evidence, not decisions: `doctor_source_ids.decided_by` stays empty until a person or, later, the enabled auto-link decides.
- When auto-linking is turned on, this ADR is updated with the date, the sample result and who agreed.
