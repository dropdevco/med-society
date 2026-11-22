# 0015. Specialty certifications come only from CONACEM; other consejos and colegios are dropped

Status: Accepted (Milo, 21 Nov 2026) · Owner: Emilio

## Context

The plan for credential badges (roadmap phase 7+, [ADR 0001](0001-separate-source-pipeline.md)) was to read consejos (specialty boards) and colegios (professional colleges) one by one as letters arrived: CMCPER and CCPERBC first, then CMGO, CMRI, CMMI and the ADM dental council. Most need a letter, an export or an assisted lookup; CMGO moved behind a login and ADM's robots.txt bars AI agents.

CONACEM is the umbrella committee over the medical specialty consejos. Its lookup already runs weekly (`scripts/sources/adapters/conacem.ts`, permission received 4 Nov 2026) and returns the certificate number and validity for any specialist, whatever their consejo.

On 21 Nov 2026 Milo asked to drop the consejo and colegio scraping and use CONACEM instead.

## Decision

- **Specialty certification badges come from CONACEM only.** No adapter is built for an individual medical consejo.
- **Colegio membership is not collected.** No colegio adapter is built; `organizations.kind = 'colegio'` stays in the schema, unused.
- The consejo and colegio rows in [the source register](../sources/README.md) are marked **Dropped** with this ADR as the reason. The letters already asked for need not be chased.

## Alternatives considered

- **Keep the per-consejo plan.** It would cover what CONACEM does not, but each consejo is a separate letter, format and failure, and most of the medical ones repeat CONACEM's data.
- **CONACEM first, consejos only for the gaps** (dentistry, colegios). Rejected for now to keep the pipeline small; it is the obvious path back if dentists' certifications become a priority.

## Consequences

- **Dentists get no certification badge.** Dental specialty boards (ADM and others) are not, as far as we know, under CONACEM. This is an assumption to check against CONACEM's list of consejos; the Baja Health Cluster dentists are affected.
- **No "member of colegio X" badge.** CCPERBC's plastic surgeons, and any colegio, show nothing for membership.
- One source to keep healthy for every specialist's certification: when CONACEM's run is red, no certification is refreshed. Badges keep their last known validity dates until the run is green again.
- CONACEM's lookup works by surname pair and asks only about doctors in the hospital sources' latest good runs (Hospital Ángeles, Star Médica). A doctor known only from another source gets no certification until the lookup is widened to them.
