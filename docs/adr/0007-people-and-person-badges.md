# 0007. Badges belong to people, not listings

Status: Proposed, for review with Carlos · Owner: Emilio · 3 Nov 2026 · Revises the table list in [0003](0003-affiliation-data-model.md)

## Context

A MedSociety listing (`providers` row) is not always a person. Google Places rows are mostly clinics, Doctoralia rows mostly doctors, self-listings either; no column says which, and the directory has duplicate rows. Credentials (cédula, board certification) and hospital affiliations belong to a human being. If badges hang off listings, a doctor with two listings shows badges on one and not the other, and a clinic can inherit a doctor's hospital badge.

`clinic_practitioners` (production, applied as `clinic_teams`) already links a clinic listing to its practitioners' own listings. It is empty today.

## Decision

- **A `people` table with our own ID** for every real doctor. The ID is never taken from a source. A cédula is not the ID (one doctor can have several, and sources mistype them); CURP is never stored.
- **`person_identifiers`** holds each person's cédulas, Doctoralia ID and other source identifiers, unique per (kind, value) so one cédula can never belong to two people.
- **A source entry is matched to a person once** (`entry_matches`): a cédula match confirms automatically, a name match waits for review, and every later run of that entry reuses the decision and only renews "last confirmed".
- **A doctor's listing links to its person** (`provider_people`); duplicate listings of one doctor point at the same person. Clinic listings reach their doctors through the existing `clinic_practitioners`.
- **Affiliations are person × organization** (`person_affiliations`), carrying the `run_id`s that created and last confirmed them. Facility badges (COEPRIS, CLUES) stay on clinic listings.
- **Badges render from a cache** on `providers.badges` (jsonb), rebuilt by the pipeline after each run, so search pages do not join six tables per view. The tables stay the source of truth.
- **Unmatched entries** become a new person and a `pending`, unclaimed listing only from sources whose permission covers display (Hospital Ángeles does), and only after a dedupe pass. Other sources only confirm badges on people we already have.

## Alternatives considered

- **Affiliations on listings** (0003 as first written). Simpler, but wrong for duplicates and clinics, and verification (stream E) is about a person.
- **Cédula as the person key.** Not every doctor publishes one, some have several, and typos would split or merge people.
- **Re-match every run.** Would re-queue the same doctors for review every week.
- **Compute badges in `provider_list` with joins.** Correct but adds load to the busiest read path, which already needed protection (PR #11).

## Consequences

- New tables owned by the pipeline; one new column and a view re-create on the app side (`providers.badges`, `provider_list`), coordinated with Carlos.
- The review queue (roadmap phase 4) decides `entry_matches`, not badges directly.
- A person can later be linked to a MedSociety account (a doctor claiming their listing) without changing badges.
