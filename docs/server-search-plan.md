# Server-side directory search: plan

Status: **approved 17 Nov 2026; phase 0 done** (section 14). Phases 1–5 are not built yet.
Depends on PR 28 (`perf/directory-snapshot`, the cached `/api/directory/:region/:part` slices).

## 1. Goal

Today a visitor's browser downloads a whole region before it can show anything: San Diego–Tijuana is 8,571 rows,
8.2 MB of JSON (1.7 MB gzipped), and El Paso–Juárez is 4,064 rows (3.3 MB). The browser then builds the search
index, filters, sorts, counts facets, builds the suggestion vocabulary, finds postal-code centres and picks the home
page rows itself.

After this work the browser receives only what it shows: one page of results, the map pins for them, the facet
counts, and a small region summary. **The results must be the same as today's**, so the existing code in
`src/utils/` stays the specification, and every server answer is checked against it.

| What the browser downloads (San Diego–Tijuana) | Today | After |
|---|---|---|
| Opening the home page | 8.2 MB raw / 1.7 MB gz | region summary 13 KB gz + home rows 36 KB gz |
| A search | (already downloaded) | 30 results 4 KB gz + up to 400 map pins 21 KB gz + facets ~2 KB gz |

Measured on 17 Nov 2026 with the production rows; see section 11.

## 2. Decision: where search runs

**Recommended: in `api/agent.ts`, over an in-memory copy of the region, using the same TypeScript logic as the
browser.** Not in Postgres.

### Why not a Postgres function (full text and trigram)

- **The database is the bottleneck.** It is a small instance: building JSON for 1,000 `provider_list` rows takes
  0.7–0.9 s, and the anon role stops any statement at 3 s. A simplified, single-term version of today's scoring
  (substring on four folded fields, no synonyms, no quality factor, top 30) took **264 ms** on production for
  `dent` in San Diego–Tijuana, using a scan of 8,571 rows. Full scoring (synonym expansion, every term ANDed,
  word-start strength, the quality multiplier, the confidence-weighted rating against the region's mean, the
  generalist penalty, paid placement) plus facets (five more passes, each with one filter released) would be
  several times that, per keystroke, per visitor, on the instance that is already the slow part.
- **Same results would mean a third copy of the ranking**, in SQL, that the TypeScript self-tests cannot compare
  line by line. Postgres full-text search ranks differently (stemming, `ts_rank`) and trigram similarity is not
  today's word-start / substring scoring, so either the results change or the SQL re-implements `scoreDoc`.
- **Today's logic is cheap in memory.** On a laptop, scoring a 8,571-row region takes 15–80 ms per query and facets
  38 ms (section 11). A Vercel function can do that per request without touching the database.

### Why `api/agent.ts`

- Vercel's 12-function limit is reached, so no new file in `api/`. `api/agent.ts` already keeps an in-memory copy of
  each region (`snapshot()`, 10-minute lifetime) and already has a copy of the scoring for the REST and MCP API.
- The region copy will be built from PR 28's cached slices (`/api/directory/:region/0..7`), not from Supabase. The
  edge cache answers those, so a function instance loading a region normally costs the database nothing; the
  database is read at most once per slice per 5 minutes per cache region, as PR 28 already does.

### When to revisit Postgres

If a region grows past ~50,000 rows, or a cold function takes more than ~2 s to build its copy, move the *candidate
selection* into Postgres (stored folded columns plus a `pg_trgm` GIN index, returning ids only) and keep the scoring in
TypeScript. `pg_trgm` and `unaccent` are already installed on production. That would need a migration; the next
free number on production is **0052** (0050 and 0051 came from PR 22 and are applied). This plan needs no migration.

## 3. One copy of the logic, or two

`api/` files are documented as unable to import from `src/` (HANDOFF.md section 6), but nothing records why. The
modules involved (`search.ts`, `filters.ts`, `facets.ts`, `rating.ts`, `geo.ts`, `region.ts`, `discover.ts`,
`images.ts`) use no Vite features, no `import.meta.env` and no React.

**Phase 0 spike:** move one pure module to a top-level `shared/` folder, import it from both `src/` and
`api/agent.ts`, and deploy a preview.

- If the preview bundles and runs it, the search, filter, facet, rating and discover logic moves to `shared/` and
  both sides import it. Same results by construction, and the "change one copy, change the other" rule stops
  applying to these files (AGENTS.md and HANDOFF.md get updated).
- If it does not, the server gets copies, as today, and the parity script (section 9) is what keeps them equal.

Either way the parity script is built, because it also checks the HTTP layer (parameter parsing, paging, the map
pins).

### Differences between today's API copy and the website

`runSearch` in `api/agent.ts` does not give exactly the website's answer today. The new website endpoint must use
the website's rules; the public REST/MCP API keeps its documented behaviour unless you decide otherwise (section 13).

| Area | Website (`src/utils`) | `api/agent.ts` today |
|---|---|---|
| Insurance filter | exact name match | folded substring match |
| Language filter | provider lists the language | also requires `languagesConfirmed` |
| Paid placement | always first | optional (`paid_placement`) |
| Postal-code centre | median-based outlier removal, in-region checks (`postalCentroidsOf`) | plain average of rows with an in-region prefix |
| Specialty words searched | key + label in the UI language + English label | key + English + Spanish label |
| Map area | `mapArea` box filter | none |

The search index depends on the interface language (the Spanish UI searches Spanish labels), so the endpoint takes
`lang=en|es` and keeps one index per language, built when first needed.

## 4. The endpoints

All are routes inside `api/agent.ts`, reached through rewrites in `vercel.json` and `vite.config.ts`, the way PR 28
added `/api/directory/:region/:part`. All are `GET`, so the edge cache can answer them.

| Path | Answers | Cache |
|---|---|---|
| `/api/find/:region/results` | one page of results, total, the sort applied, map pins | `s-maxage=60, stale-while-revalidate=600` |
| `/api/find/:region/facets` | facet counts | same |
| `/api/find/:region/names?q=&lang=` | provider names for the suggestion box | same |
| `/api/find/:region/pins` | first 80 results inside a map box (only when "search as I move the map" is off) | same |
| `/api/find/:region/meta?lang=` | the region summary (section 5.4) | `s-maxage=300, stale-while-revalidate=86400` |
| `/api/find/:region/home` | the home page rows | same |

The browser builds query strings in one fixed parameter order, so equal searches hit the same cache entry. The
parameters mirror today's URL (`q`, `spec`, `country`, `rating`, `ins`, `lang`, `verified`, `priced`, `max`,
`sort`, `area`) plus what the browser resolves itself: `near_lat`, `near_lng`, `r` for a postal search, `smart_spec`
for a smart search, `offset`, `limit` (at most 50), and `lang` for the interface language.

Results are the same `provider_list` rows the browser loads today, so `normalizeProvider` and every card keep
working unchanged. No contact fields: the server's copy comes from the anon-readable slices, never from the service
role, and `names` returns only id, name and kind.

## 5. Each piece, moved

### 5.1 Text search, filters, sorting

`applyFilters` runs on the server, unchanged in behaviour: same tokenizer, synonym table, field weights, AND across
terms, quality multiplier, curated `featuredRank` on the default browse, paid placement first, the generalist
penalty when a specialty is selected, and the confidence-weighted rating as the tiebreak. The prior is the mean
rating of the region's whole copy, exactly as `priorMean(allProviders)` is today. The server returns the slice
`[offset, offset + limit)` of the full ordered list plus `total`.

### 5.2 The list

The results list is already virtualised. It gets `total` up front, sizes itself with it, and loads the next page of
30 when the visitor scrolls near the end. The result count shown, `search_performed` and the impression tracking
use `total` and the first page, which are what they read today.

Every response carries `v`, the version of the server's copy (the time its slices were generated). A next page asks
for the same `v`; if the server's copy has changed in between, the response says so and the list restarts from the
top rather than mixing two versions.

### 5.3 Facet counts

`buildFacets` on the server. Today facets ignore the text query and the map box, so the facet request leaves out
`q` and `area`: typing does not refetch facets, and many searches share one cached answer.

### 5.4 Region summary (`meta`)

Built once per region and language, about 13 KB gzipped for San Diego–Tijuana:

- the suggestion vocabulary minus provider names: 18 specialties, the top 400 services, 12 cities, 145 insurers,
  with counts (`buildVocabulary`);
- postal codes with their trusted centre and count (`postalCentroidsOf`, the version with outlier removal). This
  replaces `knownPostalCodes` and lets a postal search resolve its centre instantly, as today;
- the region's map bounds (today `boundsOf(allProviders)` in `MapView`);
- `v`.

The filter rail's specialty order and insurer list read from it, as they read from the vocabulary today.

### 5.5 Suggestions

`suggest()` stays in the browser, so specialties, services, cities, insurers and postal codes are suggested instantly
from `meta`. Only provider names (8,571 of them, 412 KB gzipped) stay on the server: `names` returns the best 8 for
what is typed, ranked the way `suggest` ranks them (word-start first, then shorter name, then id order, which is the
order the browser holds them in today). The browser adds them to the vocabulary and runs the unchanged `suggest`,
so the merged list is the one today's code produces. Requests wait ~120 ms after the last keystroke.

The "found in the other city" hint (`useOtherRegionMatches`) can use `names` for the other region instead of its own
`ilike` query on `provider_list`, which takes that query off the database too.

### 5.6 Postal and distance searches

Unchanged for the visitor. The browser resolves the code's centre from `meta` (instant) or from the geocoder (as
today, including the "which side of the border?" choice), then sends `near_lat`, `near_lng` and `r`. The URL still
says `near=32300`, so a shared link behaves as now. The card's distance is computed in the browser from the
centre and the row, as today.

### 5.7 The map

The map draws at most 80 pins: the first results, in result order, that fall inside the camera. `results` returns,
next to the page of rows, up to 400 **pins** (id, position, and the few fields the marker and its info window
show), in result order.

- With "search as I move the map" on (the default), every pan is a new search with `area`, so every result is in
  frame and the first 80 pins are exactly today's.
- With no map box (the region-wide view), the map is framed on the whole region, so again the first pins are today's.
- With "search as I move the map" off and the camera moved, the browser asks `pins` for the first 80 results inside
  the new box, which is today's rule applied on the server.

A hovered card always has its pin, as today, because the card's own row is held.

The map also *frames* itself on the results: the box around all of them, minus the outermost 1% once there are 50 or
more (`framingBoxOf`, now in `src/utils/mapBounds.ts`). The browser no longer holds all the results, so `results`
returns that box as `frame` (none when the search has a map area).

### 5.8 Home page rows

`buildDiscoverRows` on the server, per region: seven rows, 90 providers, 36 KB gzipped, cached at the edge for 5
minutes. The hand-picked ids stay in the same file as the rows.

### 5.9 Smart (AI) search

No change to `/api/ai-search`. Today a smart search ignores the text and lists the providers, under every other
filter, that have any of the specialties the AI answer named. The browser now sends those as `smart_spec=a,b` with
no `q`; the server applies them as one more filter. As today, nothing is listed until the answer arrives.

### 5.10 Selecting a provider

`SearchPage` looks providers up in `allProviders` (map pin clicks, `providerById`). It will look in the rows and pins
it holds, and fetch the one provider through `src/lib/providerRead.ts` if it holds neither.

## 6. URL and shareable links

No change. The URL stays the single source of truth for the filters; `parseFilters` and `serializeFilters` stay as
they are, and the request is derived from the parsed filters. A link copied today opens the same results after the
change. The engine switch (section 8) is never written into the URL.

## 7. Caching, from the outside in

1. **Edge (Vercel's cache):** every endpoint is a cacheable `GET` (section 4). Popular searches ("dentist, Mexico")
   and the home page are answered without running the function.
2. **Function memory:** each instance holds one copy per region, refreshed every 5 minutes in the background (the
   old copy keeps answering while the new one builds). A copy needs the 8 slices from the edge plus ~0.45 s of
   parsing and indexing (measured locally; the Vercel CPU may be slower).
3. **Browser:** answers already seen this session are kept in memory, so Back is instant; `meta` is kept in IndexedDB
   and shown immediately on the next visit while a fresh copy loads (replacing today's whole-region IndexedDB cache).

## 8. Fallback and rollout switch

- `VITE_SEARCH_ENGINE=client|server` sets the default; `?engine=client|server|compare` overrides it for one visit
  and is never written into shared URLs.
- With `server`, if a request fails (error status, network failure, or no answer in 4 s), the page switches to the
  current path for the rest of the visit: load the region from the slices and search in the browser. Today's code is
  kept intact until phase 5.
- `compare` runs both and logs every difference in the console (ids and order, total, facets). It is how the team
  checks parity on real searches in a preview.

## 9. Proving the results are the same

1. **`scripts/search-parity.ts`** (new). Loads a region's real rows into a git-ignored folder (doctor data never goes
   into git), runs today's browser modules and the server handler over the same rows, and compares, for every
   sample query, in both languages: the full ordered id list (not only the first page), `total`, the sort applied,
   facet counts, `meta` (vocabulary, postal centres, bounds), the merged suggestions, the pins, and the home rows.
   It exits non-zero on any difference and prints the first differing positions.
2. **Sample queries** (kept in the script, about 60):
   - specialty words in both languages: `dentist`, `dentista`, `pediatra`, `pediatría` and `pediatria`;
   - synonyms and stems: `muela`, `gineco`, `ginecologo`, `oido`, `brackets`;
   - half-typed words: `dent`, `orto`, `ginec`, `card`;
   - names and clinics: `dra ana`, `poliplaza`, a hospital name, a misspelling with no match;
   - several words: `dentista centro`, `implantes dentales tijuana`;
   - stopwords only (`the doctor`), one letter (`x`), digits (`22000`), an insurer's name;
   - filters alone and combined: specialty + country, rating 4.5+, insurer, language, verified, priced + maximum
     price, postal code + radius (a code we hold, and coordinates from the geocoder), a map box, every sort, and a
     smart search with two AI specialties.
3. **`scripts/agent-selftest.ts`** gets synthetic versions of the same checks, with no network, so they run on
   every change to either copy.
4. **Live check:** the parity script can also call a deployed preview and compare with the browser modules over the
   slices of the same `v`.
5. **`?engine=compare`** on a preview, used by hand on the searches people actually run (section 8).

## 10. Phases

Each phase is a separate PR and leaves the site working.

| Phase | What | Visible to visitors |
|---|---|---|
| 0 | PR 28 merged. Shared-module spike (section 3). Parity script with the browser side and the sample queries. **Done except merging PR 28** (section 14). | no |
| 1 | Server engine in `api/agent.ts`: region copy from the slices, results, facets, meta, names, pins, home; rewrites; self-test and parity checks pass. Deployed but unused. | no |
| 2 | Browser: a `useDirectorySearch` hook behind the switch; `SearchPage` uses pages of results, pins, `meta`, server home rows and merged suggestions. Default stays `client`. | only with `?engine=server` |
| 3 | `compare` on a preview, then default `server` on production. Watch function errors and duration (Vercel), and search timings (PostHog). | yes |
| 4 | Other-city hint through `names`. Remove the whole-region IndexedDB cache. | yes |
| 5 | After a stable release: remove the client search path from the default bundle, keep the slices for the server copy. Update AGENTS.md, HANDOFF.md, `docs/agent-integration.md`. | no |

## 11. Measurements behind this plan

Production rows, 17 Nov 2026. Times are from a laptop running `tsx`, today's `src/utils` code, averaged over 5 runs.

| Step, San Diego–Tijuana (8,571 rows) | Time |
|---|---|
| Fetch all rows straight from Supabase (18 keyset pages of 500, sequential) | 10.1 s (494 ms median per page) |
| Parse the JSON / normalise the rows | 108 ms / 35 ms |
| Build the search index (one language) | 285 ms |
| One search: `dentist` / `dent` / `dra ana lopez` / `ortodoncia` | 76 / 76 / 45 / 38 ms |
| No text (best-rated order) / dentists in Mexico | 54 / 15 ms |
| Facet counts | 38 ms |
| Suggestion vocabulary / one `suggest` call | 58 / 2 ms |
| Home rows | 27 ms |
| Simplified one-term scoring in Postgres (`dent`, top 30) | 264 ms execution |

| Payload, San Diego–Tijuana | Raw | Gzipped |
|---|---|---|
| Whole region (today) | 8,234 KB | 1,683 KB |
| Region summary (vocabulary without names, postal centres) | 60 KB | 13 KB |
| All provider names | 1,182 KB | 412 KB |
| 30 result rows | 20 KB | 4 KB |
| 400 map pins | 57 KB | 21 KB |
| Home rows (7 rows, 90 providers) | 146 KB | 36 KB |

## 12. Risks

- **Cold function instances.** The first request on a new instance builds the region copy (~0.5–1 s plus fetching the
  slices). The edge cache hides this for popular searches; the 4 s fallback covers the worst case. Measure in phase 3.
- **Memory.** One region with its index used ~170 MB of heap locally, including the raw JSON, which the server can
  drop after normalising. Within Vercel's default function memory.
- **Typing latency.** Each keystroke becomes a request (debounced). Suggestions for specialties, services and places
  stay instant because they run in the browser from `meta`.
- **Preview deployments** may be behind Vercel deployment protection, which would block the function from fetching
  its own slices. The server falls back to reading Supabase directly with keyset pages, as PR 28 does.
- **Scraping.** The endpoints are public, but so is the whole directory through the slices today; `limit` is capped
  at 50 and the existing per-instance rate limiter applies.

## 13. Decisions

1. ~~Approve the approach~~: approved 17 Nov 2026.
2. **Open — the public REST/MCP API:** keep its current rules (insurance substring match, confirmed languages only),
   or switch it to the website's rules so both always agree?
3. **Open — shared module:** the spike worked (section 14). Move the search logic to `shared/` and drop the
   copy-and-compare rule for these files?

## 14. Phase 0 results (17 Nov 2026)

**Shared-module spike: works.** Branch `spike/shared-import` (throwaway, not for merging) added
`shared/spike/index.ts`, which imports `./fold.js`, and imported it from `api/agent.ts` as
`'../shared/spike/index.js'`. Its Vercel preview answered `GET /api/agent?route=spike-shared` from the shared code
(`"Pediatría Juárez"` → `"pediatria juarez"`), and the rest of the function (`/openapi.json`) was unaffected. A Vite
build of the same layout also resolves the `.js` specifiers to the `.ts` files.

The likely reason for the old "cannot import" rule: `package.json` has `"type": "module"`, so the function runs as
native ESM, and a relative import without an extension (`'../shared/search'`, the style `src/` uses) fails at
runtime with `ERR_MODULE_NOT_FOUND`. The rule for shared code is therefore: **every relative import inside `shared/`,
and every import of `shared/` from `api/`, ends in `.js`**. `tsconfig.api.json` must include `shared`.

**Parity harness: built** (`scripts/search-parity.ts`, `scripts/search-parity/`). It computes the page's answer
with the page's own modules for 62 sample searches per region and language, plus the region summary (vocabulary,
postal centres, bounds, prior, suggestions for 29 typed prefixes, home rows), and compares a candidate engine's
answers field by field. Engines today: the saved `baseline`; phase 1 adds the server engine in process and a live
deployment. To do that without copying page code into the script, three private helpers moved, unchanged, to
`src/utils`: `postalCentroidsOf` (`postalCentroids.ts`), `boundsOf` and `framingBoxOf` (`mapBounds.ts`), and
`effectiveSort` is now exported from `filters.ts`.

```bash
npx tsx scripts/search-parity.ts --selftest
npx tsx --env-file=.env.local scripts/search-parity.ts --fetch
npx tsx scripts/search-parity.ts
npx tsx scripts/search-parity.ts --candidate=baseline
```

**Baseline on production rows** (4,064 and 8,571 rows; 62 cases × 2 languages × 2 regions plus the region
summaries): 252 of 252 checks agree run to run. Computing all answers takes 2–5.5 s per region and language on a
laptop.

Things the baseline shows about today's search, recorded here and **not** changed, since the server must match them:

- `dra ana` matches 6,905 of San Diego–Tijuana's 8,571 listings: `ana` is a substring of "Tijuana" in the city and
  address fields.
- `22000` typed as text matches 1,375 listings through their addresses; as a postal search it is 5,158 within 5 km.
- `sort=distance` with no location keeps "distance" as the applied sort and falls through to the rating order.
