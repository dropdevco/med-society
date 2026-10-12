# Doctoralia → Ciudad Juárez provider scrape

Collects every provider Doctoralia publishes for Ciudad Juárez — doctors and
clinics — into staging tables, dedupes them against the existing Google-Places
`providers` rows, and promotes the genuinely new ones into the marketplace.

## Before you run it

Read this part. It changes what you can do with the output.

- **robots.txt.** Doctoralia disallows `/buscar?`, `/api/` and `/ajax/`. This
  scraper touches none of them. It enumerates through `sitemap.xml` and the
  path-based landing pages (`/cardiologo/ciudad-juarez`, `?page=N`), which are
  not disallowed, and it fetches profile pages, which are not disallowed.
- **Terms of service.** Doctoralia's ToS prohibit automated extraction
  regardless of robots.txt. Staying inside robots.txt is a courtesy, not a
  permission. This is a business decision, not a technical one.
- **Personal data.** Doctor names, licence numbers, practice addresses and
  patient reviews are personal data under Mexico's LFPDPPP. If these rows end
  up on a public site you are the responsible party (*responsable*) for them:
  you owe an aviso de privacidad and a working path for a doctor to demand
  correction or removal. `doctoralia_doctors.review_status` exists so removal
  is a one-row update rather than a hunt.
- **Rate.** One request every 2.5–4s, single-threaded, no proxies, no attempt
  to defeat bot detection (there is none in front of these paths). Turning that
  up is the fastest way to get the IP blocked. Don't.

## Running it

```bash
npx tsx scripts/doctoralia/scrape.ts discover
```

Reads `sitemap.specialization_city.xml` and `sitemap.facility_specialization_city.xml`,
keeps the 118 landing pages ending in `/ciudad-juarez` (anchored, so
`benito-juarez`, `oaxaca-de-juarez` and Juárez N.L. are excluded), walks each
one's `?page=N` chain, and writes every result card to `out/index.jsonl`.
~15 minutes.

```bash
npx tsx scripts/doctoralia/scrape.ts profiles
```

Fetches each unique entity's profile and parses it into `out/profiles.jsonl`,
printing a field-coverage report at the end. Roughly 3.25s per profile.

Both phases are resumable — kill at any point and re-run. Fetched pages are
gzipped into `.cache/`, parsed records are appended to `out/*.jsonl`, and a
restart skips everything already done. `--refetch` ignores the cache,
`--limit=N` caps the run, `--only=cardiologo` walks a single landing page.

```bash
npx tsx scripts/doctoralia/selftest.ts     # dedupe + price-parsing helpers
```

## Other cities (Tijuana)

Every command takes `--city=tijuana` (or `DOCTORALIA_CITY=tijuana`); output goes
to `out/tijuana/`, the HTTP cache is shared. Tijuana also walks the six
`playas-de-tijuana` landing pages, keeping only cards whose address line says
Tijuana — past its own results that page is padded with Ensenada and Mexicali.

Unattended run (keeps Windows awake, restarts on a crash, logs to `out/tijuana/run.log`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/doctoralia/run-overnight.ps1 -City tijuana
```

~134 landing pages and ~7,600 profiles: about 35 min of discovery plus ~7 h of profiles.

**Emails.** Doctoralia publishes none. `profile.emails` holds the few a provider
typed into their own profile (website field, about, services, Q&A — 7 of 2,794 in
Juárez). The rest come from `emails.ts`, which `run-overnight.ps1` runs after the
scrape: it reads each practice's own website (home page, then up to two
contact-looking pages), honours a site-wide robots.txt block, and writes
`out/<city>/emails.jsonl`. In the Tijuana smoke test 7 of 9 sites gave one.

**Photos.** `profile.photos` lists every image that is the provider's own at
`_large` size — portrait/logo, cover banner, gallery, certificates, news posts —
as URLs on Doctoralia's S3. Nothing is downloaded.

**Re-parsing without the network.** Every fetched page stays in `.cache/`, so a
parser fix never needs a re-scrape: move `out/tijuana/profiles.jsonl` aside and run
`scrape.ts profiles --city=tijuana` again — it is served entirely from cache.

`npx tsx scripts/doctoralia/tijuana-selftest.ts` checks the parser against saved
Tijuana pages (`TIJUANA_SAMPLES=<dir>`) plus a regression over cached Juárez pages.

## Loading it

Run `schema.sql` once in the Supabase SQL editor, then:

```bash
npx tsx scripts/doctoralia/load.ts stage --commit
```

Upserts into `doctoralia_doctors` / `_addresses` / `_services` / `_reviews`.
The full scraped record is also kept in `doctoralia_doctors.raw` so the
projection can be redone without re-scraping.

```bash
npx tsx scripts/doctoralia/load.ts match --commit
```

Compares each entity to every existing `providers` row and writes
`match_method` + `match_confidence` + `review_status`.

```bash
npx tsx scripts/doctoralia/load.ts promote --commit
```

Inserts the `approved` + unmatched entities into `providers` as
`source = 'doctoralia'`. It only ever inserts — no existing row is updated or
deleted. Every phase is a dry run without `--commit`.

## Enriching contact details from Google Places

Doctoralia publishes almost no contact details, so this optional pass asks
Google Places about the same practice at the same coordinates.

Run `schema-enrichment.sql` once, then:

```bash
npx tsx scripts/doctoralia/enrich.ts                  # dry run + cost estimate
npx tsx scripts/doctoralia/enrich.ts --commit --limit=20   # validate on a sample
npx tsx scripts/doctoralia/enrich.ts --commit         # the full pass
npx tsx scripts/doctoralia/enrich.ts apply --commit   # copy onto providers rows
```

**This phase costs money** — roughly US$135 at list price for the full ~2,200
entities. The dry run prints the estimate and makes no API calls. Responses are
cached to disk, so a re-run costs nothing for anything already looked up.

Matching is two-step, because a Doctoralia doctor is a *person* and Google
Places indexes *businesses*:

1. Search the entity's own name. A clinic, or a solo doctor whose consultorio
   carries their name, matches here → **`entity`**. This is a number you can
   honestly publish as theirs.
2. Otherwise search the venue they practise at → **`venue`**. That phone is the
   building's switchboard. It is recorded but **not** written to
   `providers.phone` unless you pass `--venue`, because showing a hospital
   switchboard as a named doctor's direct line misleads the patient.

Both require the Google result to sit within 250m of the scraped coordinates
and clear a 0.6 name-similarity bar. `apply` only ever fills blanks — it never
overwrites a phone or website already on a providers row.

## Media & socials backfill

Photo galleries, the practice's own website and social links, taken from the
profile pages we already cached (`.cache/` holds all ~2,800 profiles, so this
needs **no network**). Needs `providers.socials` and `providers."galleryUrls"`
(migration `0008_provider_media_socials.sql`).

```bash
npx tsx scripts/doctoralia/media-selftest.ts                       # parser checks
npx tsx scripts/doctoralia/backfill-media.ts --offline --limit=25  # sample, cache only
npx tsx scripts/doctoralia/backfill-media.ts --offline             # all cached profiles (~8 min CPU)
npx tsx scripts/doctoralia/load-media.ts                           # DRY RUN: counts only
npx tsx scripts/doctoralia/load-media.ts --apply                   # write to providers
```

`backfill-media.ts` is resumable (skips ids already in `out/media.jsonl`;
`--refetch` redoes everything and ignores the cache, which means live requests).
Without `--offline`, any page missing from the cache is fetched through the same
throttled `politeGet`: 2.5-4s apart, single-threaded, no proxies, none of the
robots.txt-disallowed paths. The ToS and personal-data notes above apply
unchanged. `load-media.ts` only fills blanks: `website` when empty, missing
`socials` keys, `galleryUrls` when empty, and never rows with `source = 'self'`.

Where the data lives on the page: gallery in `<gallery-app :media="[...]">`
(full list; video entries skipped), website in `data-avo-track="doctor-website-link"`
/ `"clinic-website-link"`, socials in `"clinic-social-media-link"` (clinic pages
only) or an embedded Instagram post. Doctoralia's og:image banner and its own
social accounts and share links are excluded.

## How dedupe works

The existing 335 Juárez rows are Google Places *businesses*; most Doctoralia
rows are *people*. Those two sets barely overlap, so the matcher is deliberately
narrow:

- Compares the entity's own name to the provider's name — accent-folded,
  title-stripped (`Dra.`, `Lic.`, `C.D.`…), token-set Jaccard. It never
  compares the clinic label, so "Dra. X, who practises at Hospital Ángeles"
  cannot collapse into the existing "Hospital Ángeles" row.
- Requires ≥0.95 name similarity (any distance under 1km), or ≥0.80 within
  300m, to call it the same entity.
- 0.65–0.80 is parked as `possible` with `review_status = 'pending'` for a human.
- **Phone is not used.** See below.

## Known gaps in the source data

Worth knowing before you build UI on this.

- **Doctor pages carry no direct phone.** The only number in a doctor profile is
  Doctoralia's own 24/7 booking-assistant line, allocated per address (all
  `656 738 xxxx`). It is a Doctoralia routing number, not the practice's line.
  It is stored as `doctoralia_addresses.doctoralia_phone` and deliberately kept
  out of `providers.phone` — writing it there would fill the directory with a
  competitor's booking numbers and poison phone-based dedupe.
- **Clinic pages do carry a real one**, in `data-phone-number` (the markup only
  masks it visually), along with the clinic's own website. Those land in
  `doctoralia_addresses.phone` and `doctoralia_doctors.raw->>'website'`, and
  `promote` writes them straight to `providers.phone` / `.website`. Only clinics
  that have claimed their profile publish them, so expect partial coverage.
- **No email addresses**, for either entity type.
- Most promoted rows therefore land with address, coordinates, specialties,
  rating, photo and cédula but **no contact channel**. Enriching them from
  Google Places (a text search on name + address) is the natural follow-up.
- **Partial reviews.** The profile page embeds ~10 reviews in JSON-LD;
  `review_count` carries the true total. Fetching the rest goes through the
  disallowed `/ajax/` endpoint, so it is out of scope here.
- **Prices are patchy.** Mexican regulation limits public price display, so many
  profiles show "Desde $X" or nothing. `price_text` keeps the verbatim string;
  `price_mxn` + `price_is_from` hold the parsed lower bound.
- **Insurers** are present only where the doctor is bookable through Doctoralia.

## What is surfaced in the app

| Field | Source | Stored in Supabase? |
| --- | --- | --- |
| Insurers accepted | Doctoralia (Vue prop, not the truncated visible list) | Yes — our own scrape |
| Reviews | Google Places, fetched on drawer open | **No** |
| Clinic photos | Google Places, fetched on drawer open | **No** |

Google's Places policies allow only `place_id` to be retained indefinitely.
Photo URLs are signed and expire, and both photos and reviews require the
attribution Google supplies. So they are fetched at render time and cached
in memory for the session only — never written to the database. Insurers and
booking links come from our own scrape and carry no such restriction.

Requesting `photos` puts Place Details in the Enterprise tier (1,000 free
calls/month). Because it is per-drawer-open and session-cached, spend tracks
actual usage — watch it in Cloud Console > Billing > Reports.

## San Diego sweep

The same Google Places sweep, for the US side of San Diego–Tijuana (San Diego,
Chula Vista, National City, Imperial Beach, San Ysidro and whatever else falls
in the box). `--target=san-diego` switches both scripts; without it they do
exactly what they did for Juárez. Targets live in `sweep-targets.ts`. (It is
`--target`, not `--city`: `config.ts` owns `--city` and rejects unknown cities.)

- **Queries.** 68 English categories — the Juárez Doctoralia labels, translated
  and with gender variants merged — run once against the metro, and the 16
  densest (dentist, primary care, urgent care, pharmacy, OB-GYN, …) repeated for
  Chula Vista, National City, Imperial Beach and San Ysidro: 132 queries.
  `--estimate --list` prints them all.
- **Box.** 32.534–32.90 N, -117.30 – -116.90. The box alone does not exclude
  Mexico (the border rises to ~32.55 at Otay Mesa), so a place is kept only if
  it is north of the border survey line, its address reads `…, CA …, USA`, and
  Place Details says country `US`. promote re-checks all of that.
- **Rows.** `google_places_san_diego` (migration `0023`), then `providers` with
  `source 'google'`, `country 'US'`, `city` = Google's locality (`San Diego`,
  `Chula Vista`, …; San Ysidro comes back as `San Diego`), `postalCode` from the
  address, `languages []`, status/tier left at their defaults — the El Paso
  conventions. Specialty: English name/type rules, else the query that found it,
  else `general`. Dedupe against all `providers`: same `googlePlaceId`, same
  phone, or similar name within 150 m.
- `link` / `report` are Doctoralia matching and refuse to run for this target.

```bash
# 0. once: apply supabase/migrations/0023_google_places_san_diego.sql
npx tsx scripts/doctoralia/sweep.ts collect --target=san-diego --estimate   # no network at all
npx tsx scripts/doctoralia/sweep.ts collect --target=san-diego --commit     # PAID: Google Places
npx tsx scripts/doctoralia/promote-google.ts --target=san-diego             # dry run, Supabase reads only
npx tsx scripts/doctoralia/promote-google.ts --target=san-diego --commit    # insert into providers
```

`--estimate` replaces `fetch` with a stub that throws and creates no Supabase
client, so it needs no keys and prints `0 network calls attempted`. The estimate
is list price (~US$40 for 264 searches + 1,584 details); the free monthly
allowance per SKU usually makes the real bill far lower. Try
`--commit --limit=5` first to see a real cost per query.

## Files

| File | What it does |
| --- | --- |
| `config.ts` | URLs, city slug, rate limits, paths |
| `http.ts` | Throttled, cached, backing-off GET |
| `discover.ts` | Sitemap → landing pages → paginated result cards |
| `parse.ts` | Profile HTML → structured record |
| `specialties.ts` | All 118 Doctoralia slugs → our `Specialty` union |
| `scrape.ts` | Two-phase runner + coverage report |
| `load.ts` | Staging upsert, dedupe, promotion |
| `selftest.ts` | Checks for the matching helpers |
| `sweep.ts` | Broad Google Places sweep + free local link |
| `promote-google.ts` | Google-only businesses → providers |
| `enrich.ts` | Targeted per-provider Places lookup (usually unnecessary after a sweep) |
| `schema.sql` | Staging tables + `providers.doctoraliaId` |
| `schema-enrichment.sql` | `google_*` columns on `doctoralia_doctors` |
| `schema-002-address-phone.sql` | adds `doctoralia_addresses.phone` |
| `schema-003-google-sweep.sql` | `google_places_juarez` table |
| `schema-004-provider-extras.sql` | `providers.insurances` (the `bookingUrl` column is dropped by migration 0016) |
| `backfill-extras.ts` | fills those two from the scrape |
| `parse-media.ts` | Pure gallery / website / socials extractor |
| `media-selftest.ts` | Fixtures for `parse-media.ts` |
| `backfill-media.ts` | Cache (or throttled live) -> `out/media.jsonl` |
| `load-media.ts` | `media.jsonl` -> providers, dry run by default |
| `repair-coords.ts` | fixes providers promoted with an out-of-region address |
