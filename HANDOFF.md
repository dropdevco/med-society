# HANDOFF.md

Last rewritten **2026-10-27**. Production (`origin/main`) was at `9cb3e81`; the working branch
`feat/two-border-regions` was at `b921e2a` (7 commits ahead of main, 1 behind). Live counts below came from
the production database on the same day. Check `git log origin/main` and the open PRs before trusting
anything here about "what is deployed".

The planning side (who owns what, decisions, release scoping V1/V2/V3) lives in the **MedSociety Delegation
Plan** page: <https://claude.ai/artifact/41tMqWdGNYi4GLtXfe3sL3>. This file is the engineering side.

## 1. What this is

MedSociety (medsociety.one) is a bilingual (EN/ES) directory and lead marketplace for **cross-border medical
care**, covering two regions:

| Region id | Cities | Live listings (27 Oct) |
|---|---|---|
| `elpaso-juarez` | El Paso, TX and Ciudad Juárez | 4,063 |
| `sandiego-tijuana` | San Diego, CA and Tijuana | 8,550 |

12,613 live listings in total, 1 pending. The region is derived from longitude in the database (west of
-110 is San Diego–Tijuana) and sits in `src/utils/region.ts`.

What exists today:

- **Search-first directory.** Segmented search box over specialty/service/name, side of the border or ZIP,
  insurance; list/map split once a search runs; a "smart search" that describes a symptom and returns doctors
  whose own patient reviews match (`api/ai-search.ts`). Always scoped to one region.
- **Doctor accounts.** Supabase Auth. A doctor claims a listing or publishes a new one (`/borderhealth`
  survey onboarding, `/claim/:id`), then manages it in `/dashboard`: profile, photos, social links, plan,
  team, Insights.
- **Clinic teams.** A clinic links its specialists as their own listings (`clinic_practitioners`) and invites
  staff. Staff (`provider_owners.role = 'staff'`) can do everything an owner can in the dashboard except act
  as a clinician (no forum posting as the listing, no forum e-mail).
- **Paid plans.** Promoted (US$49) and Featured (US$99) sold through GHL payment links, turned into a listing
  tier by `api/billing.ts` and migration `0029`. Still in GHL **test mode**.
- **Patient messages.** A signed-in patient sends one-way questions to a clinic (`api/inquiry.ts`). There is
  no conversation, inbox or reply yet. 0 messages sent in production so far.
- **Forums.** "Ask a Doctor" (patients) and "Med Society" (clinicians only), deployed but unlisted.
- **Admin dashboard** at `/admin` (access is decided by the `app_admins` table): Overview, Form traffic,
  Survey responses, Directory, Accounts & leads, Feedback, Billing, Clinic lookup.
- **Agent surface.** REST, OpenAPI, MCP server, `llms.txt`, prerendered HTML for crawlers (`api/agent.ts`).
- **Survey** at `/borderhealth` and `/research` (UTEP / NSF I-Corps study): 24 responses so far.

Not built yet (see the plan page): e-mail that actually sends in production, conversations between accounts,
appointment booking (ruled out of V1), organization badges, automatic credential checks, doctor websites,
trip planning.

## 2. Release state

| Piece | State |
|---|---|
| Two regions, account-gated messages | In production (PR #1) |
| Paid plans + PostHog analytics | In production (PRs #4, #5); payments in test mode |
| Contact lockdown (migrations 0032, 0033) | In production, migrations applied (PRs #6, #7) |
| Survey state dropdown | In production (`9cb3e81`) |
| Doctor analytics (Insights, report e-mails) and the agent surface | Open **PR #8**, not deployed. Migration 0031 is already applied to production |
| `/research` defaults to the Spanish provider survey | Open **PR #9** |
| Feedback widget + admin tab | Committed on `feat/feedback-widget`; the files also sit uncommitted in this working tree. Migration 0030 is applied. Not deployed |
| Feedback auto-fix (draft PRs) | Built on `claude/relaxed-raman-6cb1a4`, migration numbered `0033_feedback_autofix.sql`, **not applied**. It clashes with the existing `0033_providers_grant_hardening.sql`, so renumber it before merging. Off until `FEEDBACK_AUTOFIX=on`. See `docs/feedback-autofix.md` on that branch |
| GHL custom fields for survey answers | Open **PR #2** |

Deploys go through GitHub: a push creates a Vercel Preview, a merge to `main` is Production (project
`medsociety-marketplace`, team `dropdevs-projects-25301cf7`, domain `medsociety.one`, canonical host `www`).
The Vercel MCP has no access to this project here; use `gh api repos/dropdevco/medora-marketplace/deployments`
to watch a deploy.

## 3. Stack

- React 19, React Router 7, Vite 8, TypeScript 5.9. Plain CSS with custom properties; no CSS framework.
- Supabase (project `gbfbsecjgjmqoznebwwb`): Postgres + RLS, Auth, Storage (`clinic-photos`), pgvector for
  review embeddings. Client `@supabase/supabase-js`.
- Vercel: static app + serverless functions in `api/`. **11 of the 12 functions the Hobby plan allows are
  used**, which is why `api/agent.ts` is one 2.7k-line file. Four crons in `vercel.json`.
- Google Maps JS API, Places and Geocoding. i18next (EN/ES). `@tanstack/react-virtual` for the list.
- PostHog (product analytics, proxied through `/ingest`), plus Contentsquare and Microsoft Clarity scripts in
  `index.html`.
- GoHighLevel (LeadConnector) for the CRM and billing. Resend is what the code uses to send e-mail today, but
  the team has decided to move every sender to the **GHL e-mail service** (plan task H7). Do not build new
  Resend code.
- OpenRouter / OpenAI embeddings and Claude Haiku for smart search and feedback triage.
- No test framework. Each area has a runnable self-test instead (section 8).

## 4. Setup

```bash
npm install
cp .env.example .env.local   # fill in values, see section 7
npm run dev                  # Vite on port 5174
npm run build                # tsc -b && vite build
npm run lint                 # eslint .; has known errors, see section 10
```

Scripts run with `npx tsx --env-file=.env.local scripts/<name>.ts`. A demo clinic account can be recreated with
`scripts/seed-demo-clinic.ts`; read the script for the login it creates rather than copying credentials from
documents.

## 5. Where things are

```
src/
  App.tsx, main.tsx          routes; entry (i18n, PostHog, client error recorder)
  pages/                     SearchPage, ProviderPage, PricingPage, ContactPage, LoginPage, ClaimPage,
                             DashboardPage, ForumPage, ForumThreadPage, BorderhealthPage, AdminPage
  components/search|discover|map|provider   the directory UI (search box, filters, list, map, profile)
  components/account/        dashboard: profile form, photos, plan panel, StatsPanel (Insights), team
  components/borderhealth/   survey runner, onboarding (claim/publish), tracking
  components/forum/          forum UI and clinician gate
  components/admin/          admin tabs (Billing, Feedback, Directory, Forms, Clinic lookup)
  components/feedback/       the Feedback widget
  hooks/useProviders.ts      loads one region, owns filters as URL params, search index and facets
  lib/                       supabase, auth, billing (payment links), inquiries, forum, providerRead,
                             adminApi, posthog, clientErrors, webmcp
  utils/                     region, search, filters, facets, rating, images, searchTerms (analytics
                             dictionary), structuredData, profileCompleteness
api/                         see section 6
supabase/migrations/         0001..0033, applied by hand to production
scripts/                     doctoralia/ (scrape + load), reviews/ (embeddings), self-tests, one-off tools
docs/                        agent-integration, doctor-analytics, ghl-billing-workflows,
                             privacy-policy-analytics-brief
```

### Search and the region model

`useProviders` loads **one region** from the lean view `provider_list` and keeps `?region=` in the URL.
Picking a place in the other region switches immediately. Heavy Doctoralia fields live in `provider_details`
(migration 0020), reviews come from `provider_reviews()` (0027, names abbreviated in SQL). Filters live in the
URL (`parseFilters` / `serializeFilters`), which decides discover-versus-results mode and makes searches
shareable; do not add a parallel filter state.

Smart search is region-scoped: `match_reviews(query_embedding, p_region, match_count)` (0022), so a Tijuana
review can never rank for a Juárez query. The API requires `region` and answers 400 `bad_region` otherwise.
New cities need an entry in `REGIONS`, a `regionOf` rule and postal prefixes.

### Contact data is not in bulk reads

Migration 0032 revokes anon `SELECT` on `providers.email`, `phone`, `phone_norm`, `website`, `socials`,
`updated_by` and on `provider_details.phones`. One provider's full row comes from the `SECURITY DEFINER`
function `provider_public(p_id)` (per-IP throttle 90/min and 1,500/h, HTTP 429); owners read theirs with
`my_providers(p_ids)`. The client path is `src/lib/providerRead.ts`. Any new read that needs contact fields must
go through these, never `select *`.

### Provider data comes from several paths

All write into `providers` (`source` = `google | manual | doctoralia`, plus self-listings):

- `scripts/seed-providers.ts`: the original Google Places seeder (Juárez).
- `scripts/doctoralia/`: scrape, stage, dedupe, promote for Doctoralia (Juárez and `--city=tijuana`), plus
  backfills for postal code, services, media and extras. **Read `scripts/doctoralia/README.md` first**; it
  documents the robots.txt / ToS / personal-data (LFPDPPP) limits.
- `scripts/doctoralia/sweep.ts` and `promote-google.ts --target=san-diego`: Google Places sweep for the San Diego
  side (about US$42 for the list). San Diego listings have no reviews, so smart search there only
  recommends Tijuana doctors.
- Self-listings from `/borderhealth` arrive as `status = 'pending'` and are approved by hand (section 9).
- Reviews are embedded by `scripts/reviews/enrich.ts` into `review_embeddings`.

## 6. Serverless functions (`api/`)

Every file is **self-contained**: it cannot import from `src/`, so logic that exists in both places is a copy
(search, rating and filters in `api/agent.ts`; shared helpers repeated per file). When you change the one, change
the other and run the self-test.

| File | What it does | Needs |
|---|---|---|
| `agent.ts` | REST `/api/v1/*`, OpenAPI, MCP `/mcp`, `llms.txt`, sitemaps, prerendered HTML for `/`, `/providers/:id`, `/pricing`, `/contact` (only for requests without `Sec-Fetch-Dest`). Docs: `docs/agent-integration.md` | anon Supabase key, `AGENT_API_KEYS` optional |
| `ai-search.ts` | Symptom search: embed, `match_reviews`, one Claude Haiku call to filter, rank | embeddings + LLM keys |
| `billing.ts` | GHL payment webhook, daily sync cron, tier computation edge | `BILLING_WEBHOOK_SECRET`, `GHL_PIT_*`, `CRON_SECRET` |
| `borderhealth-lead.ts` | Survey respondent into GHL as a tagged contact | `GHL_PIT_MEDSOCIETY` |
| `feedback.ts` | Feedback widget intake, evidence-checked triage, e-mail only when corroborated | service role, optional OpenRouter |
| `form-event.ts` | Survey form analytics into `form_events` | service role, `FORM_EVENT_SALT` |
| `forum-notify.ts` | Forum e-mails, daily digest cron, unsubscribe | `CRON_SECRET`, sender |
| `inquiry.ts` | Patient message to a clinic; account required, 5 per 10 min | service role, sender |
| `lead-notify.ts` | Supabase webhook on `leads` to an e-mail (the webhook was never created) | sender, `LEAD_NOTIFY_*` |
| `place-photo.ts` | Redirect proxy for a Google Place cover photo | Maps key |
| `stats.ts` | PostHog to `provider_stats_daily`, then report e-mails (crons 10:00 and 15:00 UTC) | PostHog keys, `CRON_SECRET` |

Crons (`vercel.json`): forum digest 15:00, billing sync 09:00, stats sync 10:00, stats reports 15:00 (UTC). All
four refuse to run without `CRON_SECRET`.

## 7. Environment

`.env.example` lists the names. Server-only values go in Vercel as well as `.env.local`. Anything with a
`VITE_` prefix is bundled into the browser on purpose; `SUPABASE_SERVICE_ROLE_KEY` has no prefix and must never
reach client code (`src/lib/supabase.ts` throws in dev if the anon key decodes to a service role).

**Not set in production as of 19 Oct:** `RESEND_API_KEY`, `LEAD_NOTIFY_FROM`, `LEAD_NOTIFY_TO`,
`LEAD_NOTIFY_SECRET`, `FORUM_NOTIFY_FROM`, `CRON_SECRET`, `BILLING_WEBHOOK_SECRET`. Consequence: no site e-mail
sends, no cron runs, and the claim and new-listing triggers write `leads` rows that nobody is told about. This is
workstream H in the plan. Re-check with `vercel env ls production --scope dropdevs-projects-25301cf7` before
assuming it changed.

Secrets (GHL tokens, service role) are kept in the team password vault. Never paste them into chat, issues or
this file.

## 8. Self-tests

Run these after touching the area they cover:

```bash
npx tsx scripts/agent-selftest.ts       # api/agent.ts vs src/utils drift
npx tsx scripts/billing-selftest.ts     # tier maths, matching, replay safety
npx tsx scripts/feedback-selftest.ts    # escalation rules
npx tsx scripts/stats-selftest.ts       # roll-up and report e-mails (not the PostHog queries)
npx tsx scripts/inquiry-selftest.ts
npx tsx scripts/images-selftest.ts
```

## 9. Operations you will actually do

- **Approve a pending listing:** `update providers set status = 'live' where id = '<id>'`. There is no
  admin queue yet (plan task A2).
- **Approve a claim by hand:** read `provider_claims where status = 'pending'`, then
  `insert into provider_owners (provider_id, user_id) values (...)`. A claim is granted instantly only when the
  confirmed account e-mail equals the listing's e-mail; a phone match is only evidence and goes to review. This
  depends on Supabase Auth "Confirm email" staying ON.
- **Read leads:** `npx tsx --env-file=.env.local scripts/list-leads.ts [status]`.
- **Survey numbers:** `npx tsx --env-file=.env.local scripts/form-stats.ts [daily|sources|audience|visitors|events]`,
  or the `form_*` views in the Supabase SQL editor.
- **Billing:** the admin Billing tab shows plans, unmatched payments and test-mode rehearsal. Setup of the two
  GHL workflows is in `docs/ghl-billing-workflows.md`.
- **Probe a deploy safely:** POST `{}` to `/api/inquiry`; the new code answers 401, old code 400 `bad_name`.
  Never POST a valid body to production: it stores a real message and e-mails the team.

## 10. Rules and gotchas

- **Plan access is computed, not event-driven.** Access is `paid_through + 4 days > now`; tier columns are
  written only by `recompute_provider_plan`. A lost cancel webhook cannot leave anyone on a plan. Matching
  normalises e-mail (gmail dots and `+tags`) and phone (last 10 digits). Unmatched payments go to an admin
  queue. Read the header of `api/billing.ts` and migration `0029` before touching tiers.
- **GHL tags on a paid contact:** `tier-promoted` or `tier-featured`, `medsociety-plan-active` or `-lapsed`,
  `medsociety-market-us` or `-mx`. The plan decided to drop the `medsociety-` prefix on new tags.
- **Messaging requires an account.** `api/inquiry.ts` verifies the Supabase token with Auth, refuses anonymous
  and unconfirmed accounts (401 `auth_required`), and stores `patient_inquiries.user_id`. The patient's draft is
  kept in localStorage for 48 hours across sign-up.
- **Feedback escalation is deliberately strict.** A report is only e-mailed when backed by evidence (a recorded
  error on that page, two or more similar reports in 24 h, or an identical earlier one). A lone report is
  stored and queued in `/admin`. Change it in `shouldEscalate` / `corroborated` and the matching self-test.
- **Insights stay hidden** until a listing clears `stats_settings` (50 views in 30 days and 7 days of data), or
  has a `provider_stats_overrides` row. The search-term dictionary (`src/utils/searchTerms.ts`) holds services
  only: no conditions, nothing reproductive, sexual or mental-health. The public profile still shows a
  placeholder view count from `profileViews()`.
- **Postgres lowercases unquoted column names.** `normalizeProvider` re-maps `googleplaceid`, `reviewcount`,
  `imageurl`, `postalcode`, `pricefrommxn`. A new camelCase field needs a fallback there.
- **Supabase caps a select at 1,000 rows;** `useProviders` pages with `.range()`.
- **Silent fallback to mock data** when Supabase is unreachable or empty (console warning only).
- **Photos are filtered.** Use `portraitUrl()`; a shared Doctoralia "no photo" banner is rejected there. Legacy
  Doctoralia S3 paths have `_small` at 68 px, so `src/utils/images.ts` serves larger files only to 2x screens.
- **The list unmounts, not hides, while the map has the screen** (a hidden virtualized list previously caused a
  "Maximum update depth" loop). Read the comment in `SearchPage.tsx` before changing the toggle.
- **Leads fall back to `mailto:`** on any insert failure with only a `console.warn`. After touching RLS, submit a
  test lead and confirm a row appears.
- **Migration numbering is untidy:** two files share `0015`, `0016`, `0017` and `0026`. All are applied. Check
  `supabase_migrations.schema_migrations` in production for what really ran, and renumber the pending
  auto-fix migration (section 2).
- **The Supabase project holds unrelated tables** (`clients`, `generations`, `approved_images`, `ha_meetings`,
  an empty `feedback`). Do not touch them. The widget table is `site_feedback` for that reason.
- **Three names, one product:** MedSociety (brand), `medsociety-marketplace` (npm and Vercel), `medora-marketplace`
  (repo and local folder). The repository is public on GitHub; the team keeps a private working copy (plan task
  A4) because making it private breaks Claude tooling on non-enterprise accounts.
- **Known debt:** `npm run lint` reports errors (mostly `react-hooks/set-state-in-effect` in data hooks);
  `SearchBar.tsx` is unreferenced; `estimatedViews.ts` is modelled, not measured; the directory has duplicate
  rows; `doctoralia_doctors.google_rating` was never enriched; the main bundle is over 500 kB; no automated UI
  tests.

## 11. Survey links and analytics

Six forms = 3 audiences × 2 languages, all on this site:

```
https://medsociety.one/borderhealth?seg=employer|employee|provider&lang=en|es
https://medsociety.one/research?seg=employer|employee|provider&lang=en|es    (co-branded UTEP / NSF I-Corps)
```

Optional: `&by=<name>` (who shared it), `&utm_source=...&utm_campaign=...`, `&session=test` (dry run, excluded
from every number). Tracking goes `track.ts` to `api/form-event.ts` to `form_events` (migrations 0010–0012; every
view has a `form_slug` column, `research` or `borderhealth`). Finished submissions stay in `bh_responses`
(`answers.utm`, `form_version = 'v2'`, `answers.variant`). The old standalone site at borderhealth.dropdev.co was
left running on purpose and writes to the same `bh_responses` table.

Provider respondents flow into onboarding through RPCs `bh_match_providers`, `bh_claim_provider` and
`bh_submit_listing` (migration 0005). Email-confirmation resume needs `/borderhealth?resume=1` in the Supabase
Auth redirect allowlist.

## 12. Fast orientation for an AI agent

```bash
export PATH="$HOME/.local/bin:$PATH"
graphify query "How does a provider listing get from the database to the search page?"
graphify update .        # after changing code
```

The knowledge graph in `graphify-out/` (about 2,300 nodes) is rebuilt from the AST at no API cost. Good first
questions: what depends on the `Provider` type (`src/types/provider.ts`, the highest-degree node), and what calls
`applyFilters` / `buildFacets` (`src/utils/filters.ts`, `facets.ts`).
