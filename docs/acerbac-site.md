# ACERBAC site (draft)

Site for the Asociación de Centros de Recuperación de Baja California (Tijuana), a trade body for
post-surgery recovery houses. Lives at `/acerbac` in the app; copy in
`src/components/acerbac/content.ts` (ES default, EN mirror).

## Status
Scaffold only. `noindex`, own chrome (no MedSociety nav/footer, see `App.tsx`). Every
`TODO(acerbac)` in `content.ts` needs the association's answer before launch.

## Source of the copy
Public press only, July–Oct 2026: board 2026–2028 led by Marla Luna (AFN Tijuana); framework
agreement with Cotuco and the Baja Health Cluster (Uniradio, Diario Tijuana); municipal
regulation of recovery centers and the "fewer than 7 of ~97 certified" figure (El Imparcial,
UnoTV). Counts differ by outlet, so none is shown on the page.

## Open questions for ACERBAC
- Brand, logo, domain/socials; contact e-mail and WhatsApp (`AC_EMAIL`, `AC_WHATSAPP`).
- Certification criteria, who certifies, fee, validity of the seal.
- Member count and whether member names may be published; membership requirements/fee.
- Subdomain (`acerbac.medsociety.one` needs the wildcard/middleware path in `docs/doctor-sites.md`).
- Whether "Certified" can be shown as a badge. It must not reuse "Verified" (ADR 0005 is open).

## Not built yet
Member directory (reuse providers + badges), membership form storing to Supabase, report form
(currently `mailto:`), privacy notice, sitemap entry, subdomain routing.
