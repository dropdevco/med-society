# 0006. Pipeline runtime: one Docker image, weekly on a Hetzner VM

Status: Proposed · Owner: Emilio · 2 Nov 2026

## Context

The pipeline must run on any team member's machine and unattended in the cloud. Some sources need a real browser (Playwright). Runs are short and weekly, so always-on capacity is wasted. The repository is public.

## Decision

- Ship the pipeline as **one Docker image** built from the repo's `Dockerfile`; `docker compose run sources --source=<slug>` behaves the same on a laptop or a server. Run output goes to a mounted volume.
- The weekly timer is **part of the image**: a `scheduler` service (`scripts/sources/schedule.ts`) that sleeps until Mondays 06:00 America/Mexico_City, runs every source, and catches up a missed slot at start-up. `docker compose up -d scheduler dashboard` starts the timer and the local health dashboard the same way on a laptop or a server.
- In production it runs on **one small Hetzner Cloud VM** with Docker's `restart: unless-stopped`. Secrets come from an env file on the VM, never the image.
- The image starts from a plain Node image now and moves to the Playwright image when the first browser-rendered source (Star Médica) lands.

## Alternatives considered

- **GitHub Actions on a schedule.** The repo is public, so workflow logs, which include source names, counts and errors, would be public too.
- **A team member's laptop.** No uptime, and the weekly cadence would depend on someone remembering.
- **Vercel cron.** Function limits and no browser (see 0001).
- **A host timer (systemd, cron, Windows Task Scheduler).** Works, but each machine is set up differently and a missed slot (machine off) is simply skipped. The in-image timer behaves the same everywhere and catches up; the VM only needs Docker. A systemd timer remains a fallback if the long-running process proves unreliable.

## Consequences

- One more piece of infrastructure to own: the VM, its env file, and updates of the image.
- A red run is visible in `/admin` once the database tables exist (0003); e-mail alerts follow when the site has a sender (plan task H1/H7).
