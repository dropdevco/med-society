# 0002. Source access policy

Status: Proposed · Owner: Emilio · 2 Nov 2026

## Context

Many sources we want are run by small organizations or government offices. Some publish openly, some block automated readers (CONACEM returns 403), some sit behind a CAPTCHA (SEP) or a login (CMGO). The 30 Oct meeting proposed rotating tools whenever a site blocks us. Badges are evidence shown to patients and may be disputed by doctors, so how the evidence was obtained matters.

## Decision

1. A source is built only when it is **open** (its robots.txt and terms allow reading) or we hold **written permission** that covers it. Each source's status is recorded in the register, [`docs/sources/README.md`](../sources/README.md).
2. The pipeline identifies itself: `MedSocietyBot/1.0 (+https://www.medsociety.one; info@dropdev.co)`. It honours robots.txt for that agent, waits between requests and backs off on 429/5xx.
3. It never works around a CAPTCHA, a login or a block. A 401/403/429 that persists, or a robots.txt disallow, ends the run **red** and logs the source's contact for a person to follow up.
4. Sources that refuse automation are handled by people: an assisted lookup in the review queue, a document the doctor uploads (SEP Constancia), or an export the organization sends.

## Alternatives considered

- **Rotate tools, IPs or browser fingerprints when blocked.** Rejected: it defeats the site owner's explicit decision, makes the evidence indefensible if a doctor disputes a badge, carries legal exposure, and breaks every week.
- **Open sources only.** Too narrow: the strongest signals (hospital rosters, CONACEM, SEP) come from organizations that will share with permission.

## Consequences

- Some sources arrive late or never; the review queue and doctor uploads cover the gap.
- Permission letters are tracked like code: date, scope, conditions, where the signed copy is kept (the team vault, never this public repo).
- Note: the older Doctoralia scraper sends a desktop-Chrome user agent. This pipeline does not.
