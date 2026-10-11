# HANDOFF.md

## 1. Purpose

MedSociety is a bilingual (EN/ES) healthcare-provider directory and lead-generation marketplace for the El Paso, TX / Ciudad Juárez, Mexico border region. It is **search-first**: `/` opens on a segmented search box (specialty/service/name, side of the border or ZIP, insurance) over rows of browsable providers — no map loads until a search actually runs. Once a search is active, a sticky toolbar (collapsed search pill, specialty rail, quick filter chips, a full filter modal) sits above a list/map split, and hovering a result card lights its pin on the map. A `/sales` landing page pitches the product to clinics/providers who would pay to be listed or "promoted" (see the `promoted`/`verified` flags on `Provider`, and the "Get listed free" lead pipeline in section 9). There is no user-facing account system or payment flow in the code yet.

Provider data comes from **two independent ingestion paths** that both write into the same Supabase `providers` table (see section 5.1): an older Google Places seeder, and a newer Doctoralia scrape that did most of the recent growth (757 → 4,067 rows).

## 2. Status

- **Active.** Branch `feat/post-meeting-overhaul`, six commits on top of `30a78ff`,
  acting on the Med Society UI review. Not yet merged to `main`.
- Two migrations have been **applied to the live project** (`gbfbsecjgjmqoznebwwb`)
  and are checked in under `supabase/migrations/`:
  - `0002_provider_tiers.sql` — splits `verified` (paid) from `licensed` (cédula),
    adds `tier` and `featuredRank`, nulls eight junk `00000` postal codes.
  - `0003_clinic_accounts.sql` — `provider_owners`, `provider_claims`,
    `provider_photos`, the `clinic-photos` storage bucket, and the column-grant
    edit whitelist on `providers`.
- A demo clinic account exists for testing the portal:
  `demo-clinic@medsociety.one` / `medsociety-demo-2026`, owner of
  "Dr. Jose Luis Hernández Batista". Recreate with
  `npx tsx scripts/seed-demo-clinic.ts`.

### 2.1 What the review changed

| Feedback | Where it landed |
|---|---|
| Map needs colour, Airbnb-style | `MapView.tsx` `lightMapStyles` / `darkMapStyles`; pins tinted by specialty via `utils/specialtyColors.ts` |
| Cluster circles disliked, too many pins | Supercluster removed; viewport cull + 80-pin cap |
| List should follow the visible map area | "Search as I move the map" toggle, on by default, persisted |
| Scrollable specialty row needs an arrow | `components/search/ScrollRail.tsx` |
| Remove the border tagline | `discover.heroTitle` replaced; `index.html` title and meta |
| Good photos hardcoded to the top | `providers.featuredRank`, seeded for 36 rows |
| Verified reserved for paid tier | `verified` follows `tier`; cédula moved to `licensed` |
| Providers page → nav CTA | `/sales` → `/pricing`, filled CTA in `Navbar` |
| Search bar fires on click | `SearchHero.pick()` stages, `submit()` commits |
| Postal search returns nothing | `utils/postalGeocode.ts`, country-aware |
| Everything shows 5 stars | `utils/rating.ts`: unrated is not 0, sort is confidence-weighted |
| Photos missing / no full view | card `onError` fallback, drawer portrait, `PhotoLightbox.tsx` |
| Fake profile views as a hook | `utils/estimatedViews.ts` — **clinic dashboard only, never public** |
| What can a clinic do once claimed | `/login`, `/claim/:id`, `/dashboard` |
| Anything worth taking from pricing.medsociety.one | Three tiers + five add-ons, on `/pricing`, bilingual |

Appointment booking was explicitly out of scope (David's call), and there is
still no payment flow — upgrading opens the inquiry form.

## 3. Stack

From `package.json` (exact versions as pinned, `^` = minor/patch float allowed by npm):

- React `^19.2.4` + React DOM `^19.2.4`, React Router `^7.13.1`
- Vite `^8.0.0` + `@vitejs/plugin-react` `^6.0.0`, TypeScript `~5.9.3`
- Supabase JS client `@supabase/supabase-js` `^2.99.2` (Postgres backend + auth-capable, but auth is unused here)
- `@googlemaps/js-api-loader` `^2.0.2` + `@types/google.maps` `^3.58.1` (Google Maps JS API, Places, Geocoding)
- `@tanstack/react-virtual` `^3.13.23` (window-virtualized provider list — see `useWindowVirtualizer` in `SearchPage.tsx`)
- `i18next` `^26.0.4`, `react-i18next` `^17.0.2`, `i18next-browser-languagedetector` `^8.2.1` (EN/ES localization)
- `lucide-react` `^0.577.0` (icons)
- `supercluster` `^9.0.0` (marker clustering on the map — only loaded once a search puts the map on screen, see 5.2)
- Lint: ESLint `^9.39.4` flat config + `typescript-eslint` `^8.56.1`, `eslint-plugin-react-hooks` `^7.0.1`, `eslint-plugin-react-refresh` `^0.5.2`
- No test framework is present in dependencies.
- No `.nvmrc` and no `engines` field in `package.json` — Node version is UNKNOWN (checked both, neither exists).
- Deployed on Vercel (`vercel.json` present with an SPA rewrite rule).

## 4. Setup & Commands

```bash
npm install
cp .env.example .env.local   # then fill in the values (see section 8)
npm run dev                  # vite dev server, fixed port 5174 (vite.config.ts)
npm run build                # tsc -b && vite build
npm run lint                 # eslint .
npm run preview              # serve the production build locally
```

- **No test script defined** — `package.json` has no `test` entry and no test framework is installed.
- Provider data scripts (run with `tsx`/`node` directly, not wired into `npm run`) fall into two families — see section 5.1 for which one actually populated most of the current directory:
  - **Google Places seeder (older, smaller path):** `scripts/seed-providers.ts` — scrapes Google Places, seeds/upserts into Supabase `providers`, caches raw API responses in `scripts/.cache/` (gitignored). `scripts/list-providers.js`, `scripts/find-clinic.js`, `scripts/find-dentist.js`, `scripts/check-null-ids.js` are ad hoc query/debug utilities against the same table; each hand-parses `.env.local` itself (no dotenv dependency).
  - **Doctoralia scrape (newer, most of the directory):** `scripts/doctoralia/` — a full scrape → stage → dedupe → promote pipeline, plus two backfills (`backfill-postal.ts`, `backfill-services.ts`) that populate `postalCode`/`services`/`priceFromMxn` on top of it. **Read `scripts/doctoralia/README.md` before touching any of this** — it documents the robots.txt/ToS/personal-data constraints the scraper operates under, and is kept current independently of this file.
  - `scripts/list-leads.ts` — reads the lead-capture pipeline (section 9) with the service-role key.

## 5. Architecture Map

```
src/
  App.tsx                  Router root: "/" -> SearchPage, "/sales" -> SalesPage
  main.tsx                 Entry point; initializes i18n before render
  index.css, App.css        Global styles (plain CSS, CSS custom properties, no CSS framework)
  types/provider.ts         Provider, Specialty, ProviderFilters, SortMode + SpecialtyLabels (source of truth for the domain model)
  lib/supabase.ts           Browser Supabase client (anon key only) + dev-time safety check against accidentally using the service-role key
  data/providers.ts         mockProviders — fallback dataset used when Supabase is unreachable/unconfigured or empty
  hooks/useProviders.ts     Fetches + normalizes providers from Supabase (paginated past the 1000-row cap, camelCase<->lowercase column fixup), owns ProviderFilters as URL search params, builds the search index/facets/vocabulary, applies filters+sort
  hooks/useGoogleReviews.ts Loads Google Places reviews for a provider (falls back to mockGoogleReviews)
  pages/SearchPage.tsx      The whole "/" screen: discover rows before a search, sticky toolbar + list/map split after one. See 5.2.
  pages/SalesPage.tsx       Marketing/pitch landing page for prospective paying clinics
  components/search/SearchHero.tsx        The three-segment search box (what / where / insurance); the redesign's centerpiece
  components/search/SearchPill.tsx        Collapsed one-line restatement of the active search, shown in the sticky toolbar
  components/search/CategoryRail.tsx      Specialty icon rail (Airbnb-style category shortcuts)
  components/search/FilterChipRow.tsx     The 4-5 filters people change mid-search, as horizontal chips
  components/search/FilterModal.tsx       Every filter, in a modal, at every breakpoint — wraps FilterBar
  components/search/FilterBar.tsx         The actual filter controls (specialty, insurance, language, rating, availability, price) rendered inside FilterModal
  components/search/FilterSummary.tsx     Result count, sort dropdown, and removable chips for active filters — sits above the results list
  components/search/SearchBar.tsx         Superseded by SearchHero; currently unreferenced, see section 10
  components/discover/Discover.tsx        Pre-search browse rows ("Top-rated dentists in Ciudad Juárez", etc.) built by utils/discover.ts
  components/map/MapView.tsx              Google Maps wrapper; lazy-loaded (see 5.2), Supercluster clustering, light/dark map styles, hover-to-highlight a marker
  components/provider/ProviderCard.tsx    List row for a provider (results view)
  components/provider/ProviderTile.tsx    Grid tile for a provider (discover-row view)
  components/provider/ProviderDrawer.tsx  Detail panel/drawer for a selected provider
  components/provider/ServiceList.tsx     Renders Provider.services (name/price) inside the drawer
  components/provider/ReviewCarousel.tsx  Renders GoogleReview[] from useGoogleReviews
  components/layout/Navbar.tsx            Top nav — route links, EN/ES toggle (always shows both, active one highlighted), light/dark toggle
  utils/search.ts           Tokenizing + a folded search index (buildSearchIndex/scoreDoc) — accent/case-insensitive matching
  utils/facets.ts           Suggestion vocabulary for the search box + live facet counts (how many results survive if you add filter X)
  utils/filters.ts          matchesFilters/applyFilters — the actual filter+sort pass over the provider list; defaultFilters
  utils/geo.ts              Haversine distanceKm, postal-code pattern/validation, radius options (browser-safe; scripts/doctoralia/load.ts has its own copy to avoid dragging server credentials into the client bundle)
  utils/discover.ts         Builds the pre-search browse rows from the loaded directory
  utils/images.ts           portraitUrl() strips the shared Doctoralia "no photo" placeholder image out of Provider.imageUrl (see 5.3); hueOf() gives each provider a stable fallback color
  utils/analytics.ts        trackProviderClick() — currently a console.log stub, not yet wired to Supabase (see section 10)
  i18n/index.ts, i18n/locales/{en,es}.json  i18next setup + translation strings
scripts/
  doctoralia/                Scrape -> stage -> dedupe -> promote pipeline + postal/services backfills. Own README.md — read it first.
  seed-providers.ts           Google Places -> Supabase seeder (server-only service-role key)
  list-providers.js, find-clinic.js, find-dentist.js, check-null-ids.js  One-off Supabase query/debug scripts
  list-leads.ts                Reads the lead-capture pipeline locally (section 9)
clinics_export.csv           Tracked in git; a flat export of provider/clinic rows (name, specialty, phone, address, rating, etc.) — public business directory data, not sensitive
public/                      Static assets served as-is (favicon/logo etc.)
dist/                        Build output (gitignored territory; present locally from a prior `npm run build`)
```

### 5.1 Two ingestion paths into one table

`providers.source` distinguishes rows by origin (`'google' | 'manual' | 'doctoralia'`):

- **`scripts/seed-providers.ts`** (Google Places) is the original seeder — a smaller, older set of rows, mostly `source = 'google'`.
- **`scripts/doctoralia/`** is a full pipeline (`scrape.ts` → `load.ts stage` → `load.ts match` → `load.ts promote`) that scraped Doctoralia's Ciudad Juárez listings, deduped against the existing Google rows, and promoted the new ones — this is what took the directory from 757 to 4,067 rows. `scripts/doctoralia/enrich.ts` optionally back-fills contact details from Google Places for rows Doctoralia doesn't publish a phone number for (this step costs real money — its own doc block has the estimate). `backfill-postal.ts` and `backfill-services.ts` then ran once, after promotion, to populate `postalCode` (parsed out of `address`) and `services`/`priceFromMxn` (parsed out of scraped price text) — these two are what make ZIP/radius search and price filtering possible today.
- Read `scripts/doctoralia/README.md` before running any part of this — it documents the robots.txt/ToS scope, the personal-data (LFPDPPP) obligations that come with scraped doctor data, matching/dedupe thresholds, and known gaps (no doctor-level phone numbers, patchy prices, partial reviews).

### 5.2 The search-first split, and why the map is lazy

`SearchPage.tsx` reads `searching = filters.search !== '' || countActiveFilters(filters) > 0` and renders one of two trees:

- **Not searching:** `Discover.tsx` — horizontal browse rows, each a *preview of a real search* (clicking a row's title applies its filters). No map component is even imported on this path.
- **Searching:** a sticky toolbar (`SearchPill` + `CategoryRail` + `FilterChipRow`, with `FilterModal` behind the "Filtros" button) above a list/map split. `MapView` and `ProviderDrawer` are both `React.lazy()`-loaded — the Google Maps SDK + Supercluster only download once a search actually needs them.

Hovering (or focusing) a `ProviderCard` calls `onHover(id)`, which flows into `MapView`'s `hoveredId` prop and repaints just that one marker gold — that's the mechanism behind "hovering a result highlights its pin on the map."

Below ~1180px width the list and map take turns (a floating "Mapa"/"Lista" button toggles `view`) instead of splitting the screen — see the `ms-results` breakpoints in `index.css`. **Gotcha:** the list is unmounted (not `display:none`) while the map has the screen, because a hidden virtualized list still reports its height to `ResizeObserver`, which was previously firing a render loop ("Maximum update depth exceeded") — see the comment above `{view === 'list' && (...)}` in `SearchPage.tsx` before changing that toggle.

### 5.3 Provider photos are mostly a shared placeholder

Roughly two-thirds of scraped rows have `imageUrl` set, but a large share of those all point at the *same* Doctoralia Open Graph banner — the image that site serves when a profile has no real photo. `utils/images.ts`'s `portraitUrl()` filters that placeholder out; anything it rejects falls back to a specialty-tinted monogram tile (`hueOf()` picks a stable color per provider id) in both `ProviderCard` and `ProviderTile`. If provider photos ever look broken or oddly repetitive, check this filter before assuming the scrape failed.

## 6. Entry Points — Read These First

1. `src/types/provider.ts` — the `Provider` shape is the app's god node; every component, hook, and script depends on its exact fields.
2. `src/hooks/useProviders.ts` — data source (Supabase vs. mock fallback), URL⇄filters serialization, and where search index/facets/filtering are wired together.
3. `src/pages/SearchPage.tsx` — composes the whole primary screen and holds the searching/not-searching split; read this before touching layout or the map/list toggle.
4. `src/utils/filters.ts` and `src/utils/facets.ts` — the actual filter/sort/count logic; almost every UI control in `search/` calls into one of these.
5. `scripts/doctoralia/README.md` — how most of the current directory got here, and the constraints (legal, rate-limit, data-quality) that shape what you can safely do with it.
6. `src/lib/supabase.ts` — explains the anon-key/service-role-key security model; read before touching any DB code.
7. `src/pages/SalesPage.tsx` — the business/monetization pitch; useful for understanding "promoted"/"verified" provider fields.

## 7. Conventions & Gotchas

- **Postgres lowercases unquoted column names.** `useProviders.ts`'s `normalizeProvider()` manually re-maps `googleplaceid` → `googlePlaceId`, `reviewcount` → `reviewCount`, `imageurl` → `imageUrl`, `postalcode` → `postalCode`, `pricefrommxn` → `priceFromMxn` when reading rows back from Supabase. Adding a new camelCase field to `Provider` needs a matching fallback here or it will silently read as `undefined` from the DB.
- **Supabase caps a single `select` at 1000 rows.** `useProviders.ts` pages through with `.range()` in a loop — the directory (4,067 rows) is larger than one page. If a "provider count looks wrong" bug ever shows up, check that loop before assuming the query itself is broken.
- **Filters live in the URL, not in component state.** `useProviders.ts` parses `ProviderFilters` from `useSearchParams()` and serializes back to it on every change (`parseFilters`/`serializeFilters`). This is also what decides discover-vs-results mode (section 5.2) and makes every search shareable/bookmarkable — don't introduce a parallel filter `useState` anywhere.
- **Two key tiers, don't mix them:** `VITE_*`-prefixed vars are bundled into client JS by Vite and are intentionally public (protected by Google Maps referrer restrictions and Supabase Row Level Security). `SUPABASE_SERVICE_ROLE_KEY` has no `VITE_` prefix on purpose — it bypasses RLS and must only be read via `process.env` in Node scripts, never in browser code. `src/lib/supabase.ts` has a dev-time runtime check that throws if the anon key JWT actually decodes to a `service_role` payload.
- **Silent fallback to mock data:** if Supabase env vars are missing, the query errors, or the table is empty, `useProviders.ts` silently falls back to `mockProviders` from `src/data/providers.ts` (with a console warning only). A developer debugging "why don't my seeded providers show up" should check the browser console first, not assume the UI reflects the DB.
- **`trackProviderClick()` is a no-op stub** (`src/utils/analytics.ts`) — it only `console.log`s in dev; it does not persist click counts to Supabase despite `Provider.clicks` existing as a field. Don't assume click analytics are live.
- **Provider photos are filtered, not raw** — see section 5.3 before assuming `provider.imageUrl` is safe to render directly; use `portraitUrl()`.
- Inline styles (JS objects), not Tailwind/CSS-in-JS library, are used throughout `SalesPage.tsx`/`SearchPage.tsx`/the `search/` and `discover/` components — CSS custom properties (`var(--navy)`, `var(--gold)`, etc.) defined in `index.css` drive the theme, including the `ms-*` layout classes for the search-first shell.
- Product/brand name is **"MedSociety"** (see `index.html` `<title>`, `hello@medsociety.one` contact email in `SalesPage.tsx`) while the npm package is named `medsociety-marketplace` and the repository folder is `medora-marketplace` — three different names for the same product; don't assume they're different projects.
- `index.html` embeds third-party analytics scripts directly (Contentsquare and Microsoft Clarity tags) — not environment-gated, they load in every environment including local dev.

## 8. External Dependencies & Environment

- **Supabase** (Postgres + client SDK) — the `providers` table is the primary data store; `leads` (section 9) and the `doctoralia_*` staging tables (section 5.1) live alongside it.
  - `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — browser-side, RLS-protected.
  - `SUPABASE_SERVICE_ROLE_KEY` — server/script-only, bypasses RLS, used by `scripts/seed-providers.ts`, everything under `scripts/doctoralia/`, `scripts/list-leads.ts`, and the debug scripts.
- **Google Maps Platform** (Maps JavaScript API, Places API, Geocoding API — all must be enabled in Google Cloud Console).
  - `VITE_GOOGLE_MAPS_API_KEY` — browser-side; intended to be locked down with HTTP referrer restrictions per the comment in `.env.example`. Only loaded once a search puts `MapView` on screen (section 5.2).
  - Also reused server-side by `scripts/seed-providers.ts` and `scripts/doctoralia/enrich.ts` (as `process.env.VITE_GOOGLE_MAPS_API_KEY`) to call the Places Text Search / Place Details REST APIs directly. `enrich.ts` is the one that costs real money per run — read its dry-run cost estimate before using `--commit`.
- **Resend** — transactional email for the lead-notification webhook (section 9). `RESEND_API_KEY`, `LEAD_NOTIFY_SECRET`, `LEAD_NOTIFY_TO`, `LEAD_NOTIFY_FROM` — server-only, set in Vercel, not just `.env.local`.
- **Contentsquare** and **Microsoft Clarity** — third-party session-analytics scripts hardcoded in `index.html` with embedded tracking IDs (not env vars).
- **Vercel** — deployment target; `vercel.json` only configures SPA fallback routing, no other Vercel-specific config found.
- All env var names above are documented with setup instructions in `.env.example`. `.env.local` exists locally and is correctly gitignored (verified not tracked by git); do not commit it. `supabase/.temp/` (Supabase CLI local state) is also gitignored now — see section 10.

## 9. Lead Capture Pipeline

The "Get listed free" CTAs on `/sales` all open `src/components/sales/InquiryModal.tsx`
(a plain HTML form, no third-party embed). Flow:

```
InquiryModal  →  src/lib/leads.ts  →  Supabase public.leads  →  Database Webhook
                        │                                              │
                        └─ on any insert error: mailto: fallback       └─ POST /api/lead-notify
                           to hello@medsociety.one                        → Resend email
```

- Schema + RLS: `supabase/migrations/0001_leads.sql`. Anon may INSERT only — there is no
  select policy, so the public key cannot read the pipeline back.
- Read the pipeline locally: `npx tsx --env-file=.env.local scripts/list-leads.ts [status]`
  (needs `SUPABASE_SERVICE_ROLE_KEY`; the anon key is deliberately blind here).
- Notification: `api/lead-notify.ts` — its header comment carries the full Vercel + Supabase
  webhook setup. Authenticated by an `x-webhook-secret` header, not a signature.
- **Gotcha:** `submitInquiry()` falls back to `mailto:` on *any* insert failure and only
  `console.warn`s. A broken table or policy therefore looks like a working site while
  quietly costing leads — after touching RLS, submit a test lead and confirm a row appears
  rather than a mail client opening.

This pipeline is unaffected by the search-first redesign — no changes here since it was last documented.

## 10. Known Issues & TODOs

**Added by the post-review work:**
- `npm run lint` reports 34 errors. 31 predate this branch; the 3 added are all
  `react-hooks/set-state-in-effect` in data hooks (`useSession`, `useMyClinic`,
  `ClinicPhotoManager`), the same shape as the pre-existing violations in
  `useGoogleReviews` / `useGooglePhotos`. Fixing the class properly means a
  data-fetching library, not a local edit.
- Claim approval is manual SQL. There is no admin UI:
  `insert into provider_owners (provider_id, user_id) values (...)` after
  reading `provider_claims where status = 'pending'`.
- `estimateViews()` is modelled, not measured. Replace it with real `clicks`
  once `analytics.ts` persists them, and delete the module.
- The directory holds duplicate rows (e.g. "International X Dental Clinic"
  appears twice with identical review counts). Dedupe was out of scope here.
- `doctoralia_doctors.google_rating` is empty for all 2,794 rows — enrichment
  never ran. Running it would give real decimal ratings for Doctoralia
  providers at the cost of ~2,700 Places Details calls.
- The clinic dashboard cannot edit specialty, hours or insurances yet; the
  columns are granted, the form does not surface them.



- `src/utils/analytics.ts` contains an explicit `// TODO: swap with Supabase increment when live` — click tracking is a stub only, not persisted.
- `src/components/search/SearchBar.tsx` is superseded by `SearchHero.tsx` and is currently unreferenced by anything — a candidate for deletion, left in place only because it wasn't the redesign's job to remove other people's uncommitted work.
- `README.md` is still the unmodified default Vite/React template README — it documents template boilerplate (ESLint config expansion advice), not this project.
- No automated tests exist for any part of the app.
- The production bundle emits a "chunk larger than 500kB" warning from Vite (`index-*.js` is ~585kB raw / ~171kB gzipped) — `MapView` and `ProviderDrawer` are already split out via `React.lazy()` (section 5.2), so further splitting would need to go inside the main bundle (e.g. the i18n locale JSON, or route-level splitting for `/sales`).

## 11. Fast Orientation for a New Agent

```bash
export PATH="$HOME/.local/bin:$PATH"
graphify query "How does provider data flow into the search-first UI?"
graphify god-nodes --top 15
cat graphify-out/GRAPH_REPORT.md
```

The graph was refreshed at commit `acc6da7` (this same commit) via `graphify update .` — 688 nodes, 1207 edges. Run `git rev-parse HEAD` and compare to whatever commit `graphify-out/GRAPH_REPORT.md` says it was built from before trusting it deeply; if HEAD has moved since, run `graphify update .` again first.

**Best first questions to ask the graph once it's fresh:** *"What does `Provider` connect to, and which components would break if I changed its shape?"* (still the single highest-degree node — see the `normalizeProvider()` gotcha in section 7) and *"What calls `applyFilters`/`buildFacets`, and what would break if their signature changed?"* (the new choke point introduced by the redesign — nearly every `search/` component and `SearchPage.tsx` itself depends on it).

## Form links and analytics (/borderhealth)

Six forms = 3 audiences x 2 languages, all the same MedSociety page (no external forms):

    https://medsociety.one/borderhealth?seg=employer&lang=en   (and lang=es)
    https://medsociety.one/borderhealth?seg=employee&lang=en   (and lang=es)
    https://medsociety.one/borderhealth?seg=provider&lang=en   (and lang=es)

Optional params: `&by=<name>` (who shared it; shows up in the source report),
`&utm_source=...&utm_campaign=...`, `&session=test` (dry run, excluded from all numbers).

Tracking: src/components/borderhealth/track.ts -> api/form-event.ts -> table `form_events`
(migration 0010). Needs SUPABASE_SERVICE_ROLE_KEY (and optionally FORM_EVENT_SALT) in Vercel.
Read it: `npx tsx --env-file=.env.local scripts/form-stats.ts [daily|sources|audience|visitors|events]`
or the views form_summary, form_step_funnel, form_daily, form_by_source, form_audience,
form_visitors, form_visits in the Supabase SQL editor. Finished submissions stay in `bh_responses`.

### /research (primary study URL)
`/research?seg=employer|employee|provider&lang=en|es` is the same in-app survey with Mike Loya Center (UTEP) + NSF I-Corps branding and no MedSociety navbar/onboarding. It is fully tracked: every view (`form_summary`, `form_daily`, `form_by_source`, `form_audience`, `form_step_funnel`, `form_visitors`) has a `form_slug` column (`research` vs `borderhealth`), and `bh_responses.form_slug` marks submissions. Migration `0011_form_slug.sql`. The old vercel.json proxy to borderhealth.dropdev.co was removed.

### UTMs and the employee/patient card
Native submissions now write `answers.utm`, `answers.form_version = 'v2'` and `answers.variant` (`research`|`medsociety`) into `bh_responses`, so the old per-channel SQL works. `form_visits` / `form_by_source` also carry `utm_medium`, `utm_content`, `utm_term` (migration 0012). The employee card is "Employee or patient" and its industry and work-location questions have a "No trabajo actualmente / I do not currently work" option (key `not_working`).
