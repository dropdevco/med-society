# 0009. What changed after the doctor identity review

Status: Proposed · Owner: Emilio · 9 Nov 2026 · Amends [0007](0007-people-and-person-badges.md)

## Context

Carlos agreed to the random UUID, the cédula table and the source-ID table, and asked that doctors are never asked for the UUID. A five-seat agent council reviewed the same proposal on 4 Nov. The council's position is a recommendation: David or Carlos decide. It also could not see the ADRs, the pipeline or the migration, and much of what it wanted to postpone has been built since at Emilio's direction.

The main risk it named is showing one doctor's credentials on another doctor's page.

## Decision

1. **The identity tables are their own migration.** `0042` holds the five doctor tables and what they point at, with no RPCs. `0043` onward holds sources, badges and the review functions. Carlos can apply and review them separately.
2. **Our migrations are 0042 to 0045.** They were first numbered 0039 to 0042. On 12 Nov 2026 production already held `0039_provider_service_names`, `0039_google_places_tijuana`, `0040_providers_kind` and `0041_plan_change_requests`, so they moved up. Check production's `schema_migrations` and the open PRs again on the day they are applied.
3. **Tier 1 stays strict and tier 3 stays loose,** as the council asked; both were already built this way. A cédula confirms only when the name also agrees, and `name_key` and specialty are hints, not gates.
4. **Records that share a cédula but disagree on the name wait for a person.** The backfill groups records by connected components. If a record's name differs from the group's lead, after removing titles, accents, case and word order, it is held: no listing and no cédula attached until a reviewer confirms it in `/admin`.
5. **`listings_for_cedula` and `doctor_credential_status` are removed** until something needs them. The lookup would let any signed-in user map cédulas to listings without a rate limit.
6. **A decision is final.** Confirming or rejecting a match that was already decided is refused, because rejecting a confirmed match would leave its badge showing.
7. **Every backfill can be removed by its run ID,** and a failed one removes itself. A half-written backfill would otherwise create every doctor twice on the retry.
8. **Not adopted, and raised for David and Carlos:**
   - *Doctoralia doctors without a cédula are created only on first match.* The backfill still creates all of them, because the matcher searches doctors and name matches depend on it.
   - *CONACEM waits until January.* It is built, with written permission.
   - *No written permission for Hospital Ángeles.* The council could not see the letter of 30 Oct, recorded in the [register](../sources/README.md).

## Alternatives considered

- **One migration, as Carlos first reviewed it.** Rejected: the tables can be approved without the functions, and they are the part hardest to change later.
- **Tables only, with every function postponed to after the Hospital Ángeles review.** Rejected: the badges are built and tested on those functions. Moving them to a later file gets the same review order.
- **Treat a word-order or shortened-name difference as the same name.** Rejected for now. 95 people are affected out of 8,582 records, so a person can check them; the risk of a wrong merge is the costly one. It can be loosened from what the review finds.
- **Leave multi-name groups out of the database and use a spreadsheet.** Rejected: `/admin` already records who decided and when.

## Consequences

- Reviewers have 97 more records to decide, under "Doctoralia: names that disagree". Their listings show no badges until then.
- A bulk "confirm exact names" cannot take a held record: held records never reach the 0.99 it needs.
- `doctor_credential_status` must come back in its own migration when CONACEM and CMRI statuses are compared side by side.
- The local registry gives one stable UUID per Hospital Ángeles record, but nothing reads it yet: the review does not create new doctors today.
