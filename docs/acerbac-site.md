# ACERBAC site (draft)

Site for the Asociación de Centros de Recuperación de Baja California (Tijuana), a trade body for
post-surgery recovery houses. Copy in `src/components/acerbac/content.ts` (ES default, EN mirror).

## Where it is served
- `acerbac.medsociety.one`: `middleware.ts` (`APP_SITES`) rewrites every page path to
  `/index.html` and lets built files (`/assets/…`, `/fonts/…`) through; `src/utils/hostSite.ts`
  sees the host and `App.tsx` renders only `AcerbacPage`, with no directory meta, agent bridge,
  nav, footer or feedback widget. Links to the directory become absolute (`directoryUrl`).
  The app-site check runs before doctor sites, so a `doctor_sites` row named `acerbac` can never
  take the subdomain over.
- `medsociety.one/acerbac`: the same page inside the app.
- Locally: `http://acerbac.localhost:5174/` (middleware does not run under Vite; the host check
  in the app does).

**To go live:** `acerbac.medsociety.one` was added to the Vercel project `medsociety-marketplace` on 2026-11-18 (verified, TLS issued)
(the Porkbun `*` CNAME points at Vercel). Until this branch is deployed it returns 404 from the old middleware.

## Status
`noindex`. Every `TODO(acerbac)` in `content.ts` needs the association's answer before launch.

## Certified centers list
`AC_CENTERS` holds the five centers the association named as "certificados" to Diario Tijuana on
25 June 2025 (president then: Dr. Eugenio Carrasco; the article calls it the "Asociación de
Centros de Recuperación Posquirúrgica de Baja California" and never says "ACERBAC"): Alice, Zen
and Healthy Recovery, Baja Premium Care, Bella Recovery House, Better than Ever. Zen & Healthy
Recovery also states ACERBAC membership on its Baja Health Cluster listing. In July 2026 Marla
Luna said five centers are affiliated and certified, but did not name them.

Three are in our directory and link to their listing (matched by name in Tijuana): Zen & Healthy
Recovery, Bella Recovery House, Better Than Ever the Recovery Center. Alice and Baja Premium Care
are not listed yet. None of the five has a photo in our data, so cards show a monogram.
**Photos:** only ones the center or ACERBAC sends with permission. Never copy one from a center's
site or socials (copyright, and ADR 0002 for outside sources).

## Who certifies
The 2025 article says the association is "respaldada por COEPRIS" (Baja California's state
health-risk commission). Confirmed by the project owner (2026-11-19): COEPRIS, not COFEPRIS. The
page says the association is "backed by" COEPRIS; the certify step still carries a TODO for the
criteria and validity of the seal, which only ACERBAC can supply.

## Source of the copy
Public press only, 2025–2026: board 2026–2028 led by Marla Luna (AFN Tijuana); framework
agreement with Cotuco and the Baja Health Cluster (Uniradio, Diario Tijuana); municipal
regulation of recovery centers and the "fewer than 7 of ~97 certified" figure (El Imparcial,
UnoTV); the June 2025 member list (Diario Tijuana). Counts differ by outlet, so none is shown.

## Open questions for ACERBAC
- Brand, logo, socials, own domain; contact e-mail and WhatsApp (`AC_EMAIL`, `AC_WHATSAPP`).
- The current certified list, a photo of each center with permission.
- The criteria, fee and validity of the seal.
- Membership requirements and fee.
- Whether "Certified" can be shown as a badge. It must not reuse "Verified" (ADR 0005 is open).

## Not built yet
Membership form storing to Supabase, report form (currently `mailto:`), privacy notice,
listings for Alice and Baja Premium Care.

## Indexing, listings, photos and contact (second pass)

- **Indexing.** `acerbac.medsociety.one` is indexable. `middleware.ts` rewrites every page path on that host to the static `acerbac.html`, so crawlers read the title, description, canonical and JSON-LD without running JavaScript; `/robots.txt` and `/sitemap.xml` on that host are served from `public/acerbac-robots.txt` and `public/acerbac-sitemap.xml`. The path version (`/acerbac` on the main host) stays `noindex` with a canonical pointing at the subdomain. Only Spanish is indexed: the EN toggle is client state. Keep the copy in `acerbac.html` in step with `content.ts`.
- **Centers outside MedSociety.** Baja Premium Care was added through the normal route (`recovery-allowlist.ts` → `promote-google.ts --target=tijuana-recovery`) and sits as a `pending` listing (`32e72bbb-46ae-463f-bfff-3296bbf4f109`). A person approves it with `update providers set status='live' where id='32e72bbb-…'`; then set its `providerId` in `content.ts`. The weekly source run matches it to its COEPRIS and Baja Health Cluster records. **Alice** is not in the Google staging table, so it has no listing yet: it needs a Google Places sweep that finds it, then the same route.
- **Photos.** Fetched from Google Places by `placeId` when a card scrolls into view, shown with Google's attribution, never stored (`useGooglePhotos`). No place_id or no photo: the card shows a monogram. We have no permission to copy photos from the centers' own sites or socials. If the Maps key is referrer-restricted, add `acerbac.medsociety.one` to its allowed referrers.
- **Contact.** ACERBAC publishes no contact we could find (its own site is down). `AC_EMAIL` in `content.ts` is a placeholder that reaches the MedSociety team; `AC_WHATSAPP` and `AC_PHONE` are empty and hidden until set. The (664) 250 0609/0610 numbers that turn up in searches belong to the news agency AFN, not ACERBAC.
