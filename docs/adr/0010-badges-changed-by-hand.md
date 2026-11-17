# 0010. Badges can be added, changed and removed by hand, and a run leaves those alone

Status: Proposed · Owner: Emilio · 12 Nov 2026

## Context

Until reviewers work through the queue, and whenever a source is wrong about one doctor, someone needs to fix a single badge quickly: add one an organization confirmed by e-mail, correct an end date, or take down one that should not show. The only paths so far were a source run and the `/admin` review, and a review decision is final ([ADR 0009](0009-identity-review-outcome.md)). Rejecting the match is not possible once confirmed, and an edit to a source's badge would be overwritten by the source's next run.

## Decision

- **A local command, `npm run badges:manual`,** finds a listing by name or page ID and lists, adds, changes, removes, restores or undoes a badge. It writes nothing without `--commit`. The doctor's internal UUID is worked out by the command and never typed.
- **Every change is a run of a `manual` source,** with a UUIDv7 run ID and a UTC time. The row before and after is kept in `source_runs.counts`, which only the service role reads, so `undo --run=` puts it back. A note goes in `reasons`, never in the badge, because badges are public.
- **Removing a source's badge hides it** (`status = 'hidden'`). A hidden badge never shows, and a source run never brings it back. `restore` shows it again. A badge added by hand is deleted instead.
- **A badge added by hand is never overwritten or lapsed by a run.** Only a badge added by hand can be changed; to change a source's badge, hide it and add your own.
- **A doctor's badge shows on every listing of that doctor;** regulator and accreditor badges stay on the listing.

## Alternatives considered

- **Edit rows in the Supabase SQL editor.** No record of who changed what, easy to miss the badge cache rebuild, and the next run would undo the change.
- **Let a reviewer reject a confirmed match in `/admin`.** Rejected in ADR 0009: it left the badge showing. Hiding is a separate, reversible state.
- **Delete a source's badge.** The next green run would create it again.
- **A screen in `/admin`.** Better later; the command is enough while one person makes these changes.

## Consequences

- Hidden and hand-added badges need a person to revisit them; `list` shows them with their source and status.
- The command uses the service role key, so it runs only on a trusted machine with `.env.local`.
- Migrations 0043 and 0044 gain the `hidden` status, the `manual` source, and the guards that keep runs off those rows.
