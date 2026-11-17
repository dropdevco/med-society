# 0005. What "Verified" means

Status: Proposed, needs a decision from Carlos · Owner: Emilio · 2 Nov 2026

## Context

Two records disagree:

- **The code** makes Verified a paid-plan badge: migration `0002_provider_tiers.sql` sets `verified = (tier <> 'basic')`, `0029_plan_billing.sql` turns it on when a plan is paid, and `api/agent.ts` tells AI tools the badge "is part of a paid plan".
- **The delegation plan, decision D5**, says Verified is free for any doctor confirmed on CONACEM or SEP, and that a paid plan does not buy it.

The site's "Verified credentials" filter (`verified=1`) already filters on `licensed`, a scraped cédula flag, not on `verified`.

## Decision (proposed)

Follow D5. `verified` becomes a credential state, set only by a stored passing check (SEP Constancia folio, CONACEM/consejo confirmation, or a cédula-confirmed source). Paid plans keep their own visible marks: Promoted and Featured. Billing stops writing `verified`.

## Alternatives considered

- **Keep Verified as paid and call the credential something else** ("Credentials checked"). Avoids touching billing, but contradicts D5, and a patient reads "Verified" as a credential, not a purchase.
- **Show both under one badge.** The ambiguity is the problem being fixed.

## Consequences

- `0029`'s `recompute_provider_plan` stops setting `verified`; a new migration resets it from stored check results.
- `api/agent.ts` glossary and output schema, `ProviderCard.tsx` and `ProviderView.tsx` copy change.
- Paying customers who show Verified today lose it unless they pass a check. Carlos decides how to tell them.
- Badges in roadmap phase 5 wait for this decision.
