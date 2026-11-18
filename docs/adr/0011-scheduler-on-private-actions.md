# 0011. The weekly run moves to GitHub Actions in a private repository

Status: Accepted (Emilio, 16 Nov 2026) · Owner: Emilio · Supersedes the runtime part of [0006](0006-pipeline-runtime.md)

## Context

[ADR 0006](0006-pipeline-runtime.md) put the weekly scheduler on a Hetzner VM. Nobody set the VM up, so as of 16 Nov 2026 no source runs unattended. GitHub Actions was rejected in 0006 because this repository is public: run logs, which carry source names, counts and errors, would be public too.

Two more facts shape the choice. Actions runners start empty every time, and the pipeline kept each source's run history on disk (`scripts/sources/.data`). It judges a run against the last good one: a drop of more than 30% turns it red. And on a public repository, artifacts and caches are not a safe place for doctor data either.

## Decision

- **A private repository, `dropdevco/med-society-ops`, runs the weekly job on GitHub Actions.** It checks out this public repository at `main`, installs it, and runs every source with loading on. Its logs and secrets stay private. The service-role key is a secret of that repository only, added by a person; nothing prints it.
- **Run history comes from the database when the disk has none.** `source_runs` and `source_observations` already hold every loaded run and its records, so a fresh runner rebuilds the last good run from them. The disk copy stays for laptops and the sandbox.
- **The Docker image and `schedule.ts` stay** for local runs and as a fallback host. `docker compose up -d scheduler` still works and now loads each run (`SOURCES_LOAD=1`).

## Alternatives considered

- **Hetzner VM, as in 0006.** Cheap and keeps history on disk, but it is one more machine to own, and it was never set up.
- **Actions in this public repository.** Logs become public, and run history kept as artifacts or caches could be read by anyone who can see the repository or open a pull request.
- **Supabase scheduled functions or Vercel cron.** No real browser, which Star Médica and CONACEM need, and short time limits.

## Consequences

- Someone with org rights creates `med-society-ops` and adds its secrets: `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_URL`.
- A source's first run on a fresh runner judges against the database copy. If the database has no green run for it, the run counts as a first run, as on a new laptop.
- Actions' `schedule` trigger can start late under load; a weekly cadence tolerates that. `workflow_dispatch` lets a person start a run by hand.
