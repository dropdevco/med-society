# Clinics, their teams and their doctors

How a clinic brings its people and its doctors onto MedSociety, end to end. The decision record is [ADR 0013](adr/0013-clinic-listings.md). The database is `supabase/migrations/0020b_clinic_teams.sql` (production since 10 Oct 2026) plus `0049_clinic_listings.sql`.

## The pieces

| What | Where |
|---|---|
| Who runs a listing (owner, or staff = front desk) | `provider_owners.role` |
| Which doctors practise at a clinic | `clinic_practitioners` (`status` active/pending, `managed`) |
| E-mail invitations (token shown once, stored hashed) | `provider_invites` |
| Doctors a source says work at a clinic | `clinic_practitioner_suggestions` (team-only) |
| Clinic or doctor | `providers.kind` (`'clinic'`, `'stay'`, or null for one doctor) |
| Public roster | `provider_team(id)` RPC, anon |

## Dashboard, Team tab (`ClinicTeamPanel`)

- **People.** Invite by e-mail as staff, or as owner (owners only). Change roles, remove people, leave. Every invite comes back as a link with Copy and WhatsApp buttons, even when the e-mail could not be sent.
- **Doctors.**
  - Search the directory first (`bh_match_providers`), then "Add". If the doctor already runs their listing, the link waits for them (pending); otherwise it shows at once.
  - Linking never gives the clinic editing rights.
  - "Create profile" makes a new listing at the clinic's address. The clinic can edit it (`managed`), and it gets a `doctors` row.
  - "Invite the doctor" sends a claim invite; see below.
- **Suggestions.** "Doctors we think work here" come from Doctoralia doctor pages that name the clinic exactly. Each one has Add or Not here.
- **Clinics where you practise** (on a doctor's own listing): accept or decline a clinic, let it edit the profile, or leave.

A doctor with a pending clinic link also sees a banner with Accept / Decline on their Overview. They get an e-mail too, if GHL is configured.

The **Profile** tab starts with "This listing is: a clinic / one doctor" (`set_listing_kind`).

## Invitations

`/invite/:token` (`InvitePage`) shows what the invite is for, then asks you to sign up or sign in with the invited address.

- **A team invite** adds a `provider_owners` row when accepted.
- **A doctor's claim invite** opens an incomplete claim instead, with "invited by clinic X" in its history, and sends the doctor to `/claim/:id`. From there it is an ordinary claim: ID, cédula or NPI, and a person approves it in `/admin?tab=claims`.

E-mail: `api/team-invite.ts` sends through GHL, the same direct send as `api/claim-notify.ts`. It needs `GHL_PIT_MEDSOCIETY`, plus `SUPABASE_SERVICE_ROLE_KEY` for link notices, and optionally `TEAM_EMAIL_FROM`.

## Public pages

`ProviderView` switches on `kind`.

**A clinic** (`ClinicView`) shows, in order:
1. Header: "N doctors · M specialties".
2. "What we treat": specialty chips, which filter the doctors list.
3. "Our doctors": cards linking to each doctor's own page, in one grid (a heading per specialty once there are more than 12).
4. The message form, with an optional doctor choice saved as `patient_inquiries.practitioner_id`.
5. "Treatments our doctors offer".
6. Photos, insurance and reviews.

**A doctor** gets their usual page, plus a "Practises at" card in the sidebar.

Crawlers and agents get the same split from `api/agent.ts`:
- JSON-LD: `MedicalClinic` with `member` for a clinic, `memberOf` for a doctor.
- A "Doctors at this clinic" section.
- `doctors` / `practises_at` in `/api/v1/providers/{id}`.

## Tests

```bash
bash supabase/tests/clinic-teams/run.sh   # 0020b + 0049 in a throwaway Postgres: roles, links, invites, roster, backfill
npx tsx scripts/agent-selftest.ts         # includes clinic JSON-LD, server and client
```
