# 0013. A clinic is a listing marked as one, and shows its doctors' own listings

Status: Proposed · Owner: Carlos · 17 Nov 2026

## Context

A clinic usually has several doctors and several focuses. Until now a clinic and a doctor got the same page, and nothing in the data said which a listing was. `providers.kind` only knew `'stay'`.

The team tables (`clinic_practitioners`, `provider_invites`) and their RPCs have been in production since 10 Oct 2026 (`0020b_clinic_teams`), but their UI was never shipped. A review on 16 Nov 2026 found two holes in them:

- `owns_provider()` ignores role, so front-desk staff could promote themselves to owner, and so reach Med Society.
- Linking any unclaimed listing made it `managed`, which let a clinic edit it at once and then invite any e-mail to own it. That bypassed the human claim review of PR #24 (`0047_claim_verification`).

[ADR 0007](0007-people-and-person-badges.md) already says clinic listings reach their doctors through `clinic_practitioners`.

## Decision

- **Clinic marker.** `providers.kind = 'clinic'` (`0049_clinic_listings`). Null still means one doctor, or not known.
  - The backfill marks three groups: Doctoralia facility pages; Google listings that are not linked to a doctor and whose name does not start with Dr/Dra; and any listing that already has linked doctors.
  - Owners and staff can switch their own listing (`set_listing_kind`). `'stay'` stays an admin decision.
- **One URL, two layouts.** A clinic keeps `/providers/:id`, because `providers.id` never changes.
  - `ProviderView` picks the clinic layout when `kind = 'clinic'`: focus areas, the doctors (each linking to their own listing), and the message form with a "which doctor" choice.
  - A doctor's page shows "Practises at" instead.
  - The public roster is read through `provider_team(id)`: active links to live listings only, and no contact fields.
- **Each doctor stays their own listing** (the decision of 10 Oct). Doctors stay searchable by specialty, keep their own reviews, and their badges keep hanging off `doctors`.
- **Linking never grants editing.**
  - `managed` is true only for a listing the clinic created (`practitioner_create`), or when the doctor's own owner opts in.
  - A doctor who already runs their listing must accept a link before it shows (`'pending'`).
- **Owning a listing always goes through claim review.** A clinic's "claim your listing" invite opens an incomplete `provider_claims` row, with the clinic noted in its history. The doctor finishes it at `/claim/:id`, and a person approves it in `ClaimsPanel`.
- **Roles mean something.** Only an owner changes roles, removes an owner or invites one. Staff do everything else.
- **Suggestions, never auto-links.** Doctoralia doctor pages that name a clinic exactly go into `clinic_practitioner_suggestions`. Only the clinic's team sees them, and nothing is public until the team adds one.

## Alternatives considered

- **A roster of names stored on the clinic** (not listings). Simpler, but those doctors would not be searchable, would have no reviews and no badges, and would duplicate the 8,400 Doctoralia doctors who are already listings.
- **A separate `/clinics/:id` URL.** It would break existing links and need a second set of rewrites, sitemap entries and JSON-LD for the same row.
- **Auto-linking from Doctoralia.** It would give fuller pages on day one, but a wrong link puts a doctor on a clinic they don't work at, in public.
- **Trusting a clinic's invite as proof** (0020b as first written). It is faster, but a clinic could hand any listing to any e-mail.

## Consequences

- Migration `0049` replaces seven 0020b functions. Its rollback re-runs them.
- `patient_inquiries.practitioner_id` records the chosen doctor.
  - `api/inquiry.ts` sends that field only when a doctor was picked.
  - Apply 0049 before deploying, or an inquiry that names a doctor would fail to insert.
- The search-card "Clinic" tag reads `kind` from `provider_list`, which already includes it. A doctor count on cards would need `provider_list` to grow, and is left for later.
- `api/agent.ts` and `src/utils/structuredData.ts` both type a clinic as `MedicalClinic`, with `member` (its doctors) and `memberOf` (a doctor's clinics). `scripts/agent-selftest.ts` checks that they agree.
