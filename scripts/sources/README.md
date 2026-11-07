# Source pipeline

Reads outside directories (hospitals, consejos, colegios, associations, regulators) every week, so MedSociety can show which organizations a doctor really belongs to. Decisions behind it: [ADR 0001–0006](../../docs/adr/README.md). Which sources we may read: [the register](../../docs/sources/README.md). Phase status: [the roadmap](../../docs/roadmap/verification-and-badges.md).

## Run it

First time on a machine (not needed in Docker): `npx playwright install chromium` downloads the browser the Star Médica and CONACEM adapters drive.

```bash
npm run sources -- --list                          # sources the pipeline knows
npm run sources -- --source=hospital-angeles       # one run: fetch, parse, judge, write
npm run sources:selftest                           # parser, judge and robots checks; no network
npm run sources:check                              # type-check this folder
```

The same in Docker, on any machine (runs land in `scripts/sources/.data/` through a volume):

```bash
docker compose build sources
docker compose run --rm sources --source=hospital-angeles
```

Exit codes: `0` green, `2` red (the run is still written), `1` could not run. `--all` runs every source and returns the worst code.

### Into the database

Needs migration `0035` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.

```bash
npx tsx --env-file=.env.local scripts/sources/backfill-doctors.ts --commit   # once: a doctor for every Doctoralia person
npx tsx --env-file=.env.local scripts/sources/run.ts --all --load            # load each source's last good run, no scraping
npx tsx --env-file=.env.local scripts/sources/run.ts --all --commit          # scrape, then load
```

A run's rows all carry its run ID. A source record is matched once: a cédula we hold confirms it, anything else waits in `/admin` → Verification, and later runs reuse the decision (`lib/load.ts`, `lib/match.ts`). The timer loads each run when `SOURCES_LOAD=1` is set. See [docs/badges.md](../../docs/badges.md).

### Local sandbox

A throwaway copy of the database for testing anything above without touching production. Needs Docker.

```bash
bash scripts/sources/sandbox/up.sh                                # Postgres + API, with migrations 0035 to 0037
npx tsx scripts/sources/sandbox/proxy.ts                          # leave running
export SOURCES_DB_URL=http://127.0.0.1:54331
npx tsx --env-file=.env.local scripts/sources/sandbox/seed.ts     # copies listings and Doctoralia names (read-only on production)
npx tsx --env-file=.env.local scripts/sources/backfill-doctors.ts --commit
npx tsx --env-file=.env.local scripts/sources/run.ts --all --load
VITE_SUPABASE_URL=http://127.0.0.1:54331 VITE_SUPABASE_ANON_KEY=sandbox npx vite --port 5176   # the site, reading the sandbox
npx tsx scripts/sources/sandbox/recovery-listings.ts              # test listings for the recovery centers, then load the sources again
bash scripts/sources/sandbox/down.sh                              # remove it all
```

`bash supabase/tests/0035/run.sh` is the quicker check: the migration against made-up data, 29 checks.

## Weekly timer and health dashboard

```bash
docker compose up -d scheduler dashboard     # timer + http://localhost:5180, restart with Docker
docker compose stop scheduler dashboard      # stop both
npm run sources:schedule                     # the timer in the foreground; add -- --now to run a cycle at once
npm run sources:dashboard                    # the dashboard without Docker
```

**Timer** (`schedule.ts`): sleeps until the next slot, **Mondays 06:00 America/Mexico_City** by default, then runs every source one after another. One failing source never stops the others. If the machine was off at the slot, a source with no run since the last slot is caught up at start-up; a manual run counts. Change the slot with `SOURCES_RUN_DAY` (`0`–`6` or `MON`…`SUN`), `SOURCES_RUN_TIME` (`HH:MM`) and `SOURCES_TZ` (IANA zone). It writes `schedule.json` in the data folder (next run, heartbeat every 10 minutes, last cycle with each source's run ID).

**Dashboard** (`dashboard/`): read-only, bound to this machine only (`127.0.0.1:5180`). Shows the timer with a live countdown and the last cycle; per source its status, the reasons for a red run, the last good run still in use, each website it reads with its last fetch, entries per run, added/removed, run history with run IDs, and the **full contents of the last scrape** with search. It reads what runs have written and never contacts a source. It calls the scheduler stopped after 30 minutes without a heartbeat. Today it reads the run files; when runs are loaded into Supabase (phase 2), `lib/history.ts` reads the database instead and the page stays the same.

## What a run does

1. **Access check.** The adapter must be `open`, or `permission` with the letter recorded.
2. **robots.txt**, read fresh each run for `MedSocietyBot`. A disallow ends the run red.
3. **Fetch** each target with `lib/http.ts`: identifies as `MedSocietyBot/1.0 (+https://www.medsociety.one)`, waits ~3–4 s between requests, backs off on 429/5xx. A 401/403 ends the run red as **blocked**; nothing retries it with other tools ([ADR 0002](../../docs/adr/0002-source-access-policy.md)).
   Adapters that need a real browser or run lookups implement `collect()` instead and use `lib/browser.ts` (Playwright Chromium, same pacing, `MedSocietyBot` in the user agent and an `X-Client: MedSocietyBot` header). Only a permission whose `waives` lists `block` may use the plain Chrome identity, and only one listing `robots` skips robots.txt.
4. **Parse** with the adapter, then merge duplicates by external id.
5. **Judge** green or red against the last good run ([ADR 0004](../../docs/adr/0004-matching-and-freshness.md)): a failed or empty target, a drop over 30%, or mostly nameless rows make it red.
6. **Write** the run to `.data/<source>/runs/<started-at>_<run-id>.json`, with entries, per-target counts, and doctors added and removed since the last good run. A red run is kept for inspection but never becomes the baseline.

## Run IDs

Every run gets a **UUIDv7** run ID the moment it starts (`lib/snapshot.ts`, `uuidv7()`), and **every record carries it**: each entry in a run file has `runId` and `observedAt` (when its page was fetched), each target has `fetchedAt`, and the run has `startedAt` and `finishedAt`. In the database the same ID becomes `source_runs.id` and the `run_id` on every row the run writes ([ADR 0003](../../docs/adr/0003-affiliation-data-model.md)). Never generate a record without it: it is how any row, at any volume, is traced back to the run, the time and the source that produced it.

Loading into the database and matching to listings (`--commit`) arrive with roadmap phase 2.

## Layout

```
run.ts                      CLI and the run loop
schedule.ts                 the weekly timer
dashboard/server.ts         local health dashboard (read-only)
dashboard/index.html        its page
lib/types.ts                SourceAdapter, SourceEntry, Target
lib/schedule.ts             weekly slot maths in a named time zone
lib/history.ts              past runs for the dashboard (files now, Supabase later)
lib/http.ts                 polite, honest GET; BlockedError
lib/robots.ts               robots.txt reader (RFC 9309)
lib/judge.ts                green/red rules; duplicate merging
lib/snapshot.ts             run files; last good run; diff
lib/names.ts                splits a Mexican name; name_key
lib/match.ts                the match decision (pure)
lib/load.ts                 a run into the database
lib/db.ts                   service-role client; paging helpers
backfill-doctors.ts         one-off: Doctoralia people into doctors
sandbox/                    local throwaway database
lib/browser.ts              Playwright launcher with identity and pacing
adapters/index.ts           every adapter the CLI knows, in run order
adapters/hospital-angeles.ts  static HTML, two city pages
adapters/starmedica.ts      real browser, one search per specialty (100-result cap)
adapters/conacem.ts         lookups by surname pair for doctors the hospital sources list
selftest.ts                 synthetic fixtures only
```

## Add a source

1. Add its row to [`docs/sources/README.md`](../../docs/sources/README.md). If it needs permission, stop until the letter is recorded there.
2. Write `docs/sources/<slug>.md`: what it is, the URLs, fields, quirks.
3. Write `adapters/<slug>.ts` exporting a `SourceAdapter` (targets + a pure `parse(html, target)`), and register it in `adapters/index.ts`.
4. Add parser cases to `selftest.ts` with **made-up** names and numbers. Real doctor data never goes into git; `.data/` is ignored.
5. Run `npm run sources:selftest`, `npm run sources:check`, then one live run, and read the counts against what the site shows.

## Environment

| Variable | Default | Use |
|---|---|---|
| `SOURCES_DATA_DIR` | `scripts/sources/.data` (`/data` in Docker) | Where runs are written |
| `SOURCES_MIN_DELAY_MS` | `3000` | Minimum wait between requests |
| `SOURCES_RUN_DAY` | `1` (Monday) | Timer day, `0`–`6` or `MON`…`SUN` |
| `SOURCES_RUN_TIME` | `06:00` | Timer time, 24-hour |
| `SOURCES_TZ` | `America/Mexico_City` | Time zone the day and time are read in |
| `SOURCES_DASHBOARD_HOST` | `127.0.0.1` (`0.0.0.0` inside Docker, published to loopback only) | Dashboard bind address |
| `SOURCES_DASHBOARD_PORT` | `5180` | Dashboard port |
