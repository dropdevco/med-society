# Source pipeline

Reads outside directories (hospitals, consejos, colegios, associations, regulators) every week, so MedSociety can show which organizations a doctor really belongs to. Decisions behind it: [ADR 0001–0006](../../docs/adr/README.md). Which sources we may read: [the register](../../docs/sources/README.md). Phase status: [the roadmap](../../docs/roadmap/verification-and-badges.md).

## Run it

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

Exit codes: `0` green, `2` red (the run is still written), `1` could not run.

## What a run does

1. **Access check.** The adapter must be `open`, or `permission` with the letter recorded.
2. **robots.txt**, read fresh each run for `MedSocietyBot`. A disallow ends the run red.
3. **Fetch** each target with `lib/http.ts`: identifies as `MedSocietyBot/1.0 (+https://www.medsociety.one; info@dropdev.co)`, waits ~3–4 s between requests, backs off on 429/5xx. A 401/403 ends the run red as **blocked**; nothing retries it with other tools ([ADR 0002](../../docs/adr/0002-source-access-policy.md)).
4. **Parse** with the adapter, then merge duplicates by external id.
5. **Judge** green or red against the last good run ([ADR 0004](../../docs/adr/0004-matching-and-freshness.md)): a failed or empty target, a drop over 30%, or mostly nameless rows make it red.
6. **Write** the run to `.data/<source>/runs/<run-id>.json`, with entries, per-target counts, and doctors added and removed since the last good run. A red run is kept for inspection but never becomes the baseline.

Loading into the database and matching to listings (`--commit`) arrive with roadmap phase 2.

## Layout

```
run.ts                      CLI and the run loop
lib/types.ts                SourceAdapter, SourceEntry, Target
lib/http.ts                 polite, honest GET; BlockedError
lib/robots.ts               robots.txt reader (RFC 9309)
lib/judge.ts                green/red rules; duplicate merging
lib/snapshot.ts             run files; last good run; diff
adapters/index.ts           every adapter the CLI knows
adapters/hospital-angeles.ts
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
