# Doctor analytics: how it fits together and how to switch it on

```
browser ── PostHog events ──▶ PostHog
                                 │  nightly  GET /api/stats?job=sync     (HogQL over the last 2 days)
                                 ▼
                    Supabase: provider_stats_daily, market_demand_daily
                                 │
              ┌──────────────────┴───────────────────┐
              ▼                                       ▼
   my_provider_stats(listing)                 GET /api/stats?job=reports
   → dashboard "Insights" tab                 → monthly / weekly emails
   (what the plan allows, decided in SQL)
```

## Switch-on checklist

1. **Apply the migration** `supabase/migrations/0031_provider_stats.sql` in the Supabase SQL editor.
   It adds five tables, the `reports` email preference and three functions. It does not touch
   existing data.
2. **PostHog → personal API key** (Settings → Personal API keys, scope "Query: read") and the
   project number from the PostHog URL. Add to Vercel:
   `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` (and `POSTHOG_API_HOST` for an EU project).
   `STATS_NOTIFY_FROM` is optional (falls back to the forum/lead sender).
3. **Deploy.** `vercel.json` already schedules the two jobs (sync 10:00 UTC, reports 15:00 UTC).
4. **Check the pipe** (needs `CRON_SECRET`):
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" "https://www.medsociety.one/api/stats?job=sync&days=2"
   curl -H "Authorization: Bearer $CRON_SECRET" "https://www.medsociety.one/api/stats?job=reports&dry=1"
   ```
   `sync` returns how many events it read and rows it wrote; `dry=1` lists emails that would go
   out and sends nothing. To backfill after an outage: `&days=30` (max 45).
5. **Watch it fill.** Events start the moment this deploys; nothing can be backfilled from before.

## Showing numbers to doctors

Nothing shows until a listing clears the bar in `stats_settings` (default **50 views in 30 days**
and **7 days** of data collected). Until then the dashboard says "collecting your numbers", never
an estimate. To change it:

```sql
update public.stats_settings set min_views_30d = 100, min_days = 14 where id = true;
```

Force one listing on or off (for example a showcase clinic, or one with bad data):

```sql
insert into public.provider_stats_overrides (provider_id, show) values ('<listing id>', true)
on conflict (provider_id) do update set show = excluded.show;
```

## What each plan sees (enforced in `provider_stats_payload`, not in the page)

| Plan | Dashboard | Email |
|---|---|---|
| Basic | One number: views, last 30 days | Monthly (1st) |
| Promoted | Views, visitors, contacts by type, inquiries, sources, change vs previous 30 days, "views since you joined" | Monthly (1st) |
| Featured | Everything above, plus daily trend, funnel (shown → opened → viewed → contacted → inquired), average position, percentile among same-specialty listings in the region, busiest hours and weekdays, country/device/language, which profile sections visitors reach, what people search for, CSV export | Weekly (Mondays) |

Suggestions ("seen but never contacted", "your visitors browse in Spanish but your profile
doesn't say you speak it"…) are rules in `src/utils/statsInsights.ts`.

## Notes

- Visits by a listing's own signed-in owners are excluded from its numbers.
- `/api/stats?job=reports` also emails `LEAD_NOTIFY_TO` when a patient inquiry has been "new" for
  over a day, since the team contacts the clinic on the patient's behalf.
- Event volume: one event per search for impressions (not one per listing), and a listing is
  counted once per visitor per half hour. Check PostHog's monthly event count after a week.
- What gets sent to PostHog, and what must never be: see the top of `src/lib/posthog.ts` and
  `docs/privacy-policy-analytics-brief.md`.
- Tests for the pure parts: `npx tsx scripts/stats-selftest.ts`.

## Operating it, and what went wrong at launch (17 Nov 2026)

- **"Collecting since" is a setting.** `stats_settings.collecting_since` (migration `0048_stats_collecting_since`,
  set to 2026-11-17) is the date the readiness check and the previous-period comparison count from. A listing
  forced on in `provider_stats_overrides` is judged by its own first day instead. Do not backfill rows
  older than that for real listings. (Two migration files are numbered 0048: this one and
  `0048_claim_emails`. Both are applied under different names; harmless, but pick a free number next time.)
- **Run the sync by hand** with the `www` host. The apex `medsociety.one` redirects and drops the
  `Authorization` header, which shows as `401 Unauthorized`. A browser address bar cannot send the header
  either. In PowerShell `curl` is an alias, so use `curl.exe` and `$env:CRON_SECRET`, or
  `node --env-file=.env.local -e "fetch(url,{headers:{Authorization:'Bearer '+process.env.CRON_SECRET}})..."`.
- **Which PostHog key.** Querying needs a **personal API key** (`phx_…`, scope Query: read). A `phs_…`
  project secret key (feature flags) and the `phc_…` project token are rejected with
  `Personal API key found in request Authorization header is invalid`. The key in Vercel is
  sensitive: it cannot be read back, only replaced.
- **Failures seen on the first live runs, both fixed:**
  1. `OFFSET is not supported on queries made with a personal API key`: `hogqlAll` in `api/stats.ts` now pages
     by timestamp (PR #26).
  2. The sync found 0 events because the browser calls `/ingest/e/` and `/ingest/flags/` (trailing slash)
     were not proxied and fell through to the SPA. The rewrites in `vercel.json` now capture
     `:path(.*)` (PR #27). Check after any change to rewrites:
     `curl -s -D - -o /dev/null https://www.medsociety.one/ingest/e/` must answer `400 request missing data payload`,
     not `text/html`.
- **See what PostHog holds** (events, per day, channels, countries, top listings; read only, dev traffic
  excluded): `node --experimental-strip-types --env-file=.env.local scripts/posthog-summary.ts 30`
  with `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID` in `.env.local` (`npx tsx` works too).
- **Not exercised yet:** contact taps and inquiries from the live site, `?job=reports&dry=1`, the report
  e-mails themselves, the Insights tab with real data (needs 50 views / 30 days), the demand and
  benchmark sections (they need real searches, and a benchmark needs 5 live listings of the same
  specialty in the region).
- **Test account.** carlosglzg02@gmail.com's listing "Carlitos Health" (`aa87a26b-aa77-4261-8e1d-d228e334d20c`)
  has a comped Featured plan, an override row and 65 days of synthetic rows in `provider_stats_daily`.
  Remove before any demo that must show only real numbers:
  `delete from provider_stats_daily where provider_id = 'aa87a26b-aa77-4261-8e1d-d228e334d20c'; delete from provider_stats_overrides where provider_id = 'aa87a26b-aa77-4261-8e1d-d228e334d20c';`
  and set its comp subscription to `lapsed` then `select recompute_provider_plan(id)`.
