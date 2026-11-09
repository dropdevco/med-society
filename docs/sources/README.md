# Data sources and permissions register

Status: living document · Owner: Emilio · Last updated 6 Nov 2026

Every outside source the pipeline in `scripts/sources/` reads, or plans to read, is listed here. A source is built only when its access is **open** or **permission** is recorded below ([ADR 0002](../adr/0002-source-access-policy.md)). Signed letters are kept in the team vault, never in this repository; this table records only what they allow.

## Register

| Source | Slug | Kind | Access | Permission / basis | Reader | Cédula | Cadence | Status |
|---|---|---|---|---|---|---|---|---|
| Hospital Ángeles (Tijuana, Ciudad Juárez) | `hospital-angeles` | hospital | permission | Letter received 30 Oct 2026: scrape, store and display, on condition we keep it up to date. Signed by two Hospital Ángeles officials; copy in the team vault. Logo use authorized, see below | A, static HTML | No | Weekly | **Building** (phase 1) |
| Star Médica (Ciudad Juárez only) | `starmedica` | hospital | permission | Received 4 Nov 2026: scrape, store and display the doctor directory. Copy in the team vault. Logo use authorized, see below | D, real browser (identifies as MedSocietyBot) | Yes | Weekly | **Built** (4 Nov) |
| Centro Médico de Especialidades (Juárez) | — | hospital | unknown | Not researched yet | — | — | — | Research |
| Padrón Estatal de Salud (`bajahealthtourism.com`, Secretaría de Turismo) | `padron-salud-bc` | regulator register | open | robots.txt blocks only `/admin`, `/portal`, `/login`; no terms published | A | Register no. | Weekly | Built (residences only) |
| COEPRIS BC REPSSABI | `coepris-bc` | regulator (facilities) | open | robots.txt allows all; public JSON feed | B, JSON | Register no. | Weekly | Built (recovery residences only) |
| CMCPER (plastic surgery board) | — | consejo | open | robots.txt allows the directory pages | A | Cert. no. | Weekly | Planned |
| CLUES | — | regulator (facilities) | open | "No existen restricciones para su uso" | C, file | Facilities | Monthly | Planned |
| CCPERBC | — | colegio | open | robots.txt blocks only `/wp-admin/` | A | No | Weekly | Planned |
| Baja Health Cluster | `baja-health-cluster` | association | open | robots.txt blocks only `/wp-admin/`; ask for cédulas | A | No | Weekly | Built (recovery centers only) |
| CONACEM | `conacem` | consejo umbrella | permission | Received 4 Nov 2026: display the certified-specialist data, obtained by whatever means works (CONACEM will not change its site or add an API). **Waives:** robots.txt (unreadable, 403) and the firewall's refusal of our bot, so a real browser with a standard identity is used; it still sends an `X-Client: MedSocietyBot` header. Copy in the team vault | Lookup through a real browser (by surname pair, all consejos) | No (certificate no. and validity dates) | Weekly | **Built** (4 Nov) |
| SEP (cédula registry) | — | government | permission needed | reCAPTCHA on every call; also file a transparency request | E, assisted | Yes | Per claim | Letter to send |
| CMGO | — | consejo | permission needed | Directory moved behind a doctor login. Its certifications are also in CONACEM | E, assisted | ? | Per claim | Covered through CONACEM for now |
| CMRI (radiology consejo) | — | consejo | unknown | New (meeting of 3 Nov): `cmri.org.mx/radCertificados.php`. robots.txt and terms not checked yet. Its certifications are also in CONACEM | — | ? | — | Research |
| ADM dental council | — | consejo | permission needed | robots.txt bars AI agents | E, assisted | ? | Per claim | Letter to send |
| JCI | — | accreditor | permission needed | 403; robots.txt bars AI agents | E, assisted | Facilities | Yearly | Low priority |
| ACERBAC | — | association | export | Site down, no public list | F, export | ? | Monthly | Ask for list |
| CMMI | — | consejo | export | Statute clause 18.4 promises the directory on request | F, export | ? | Monthly | Ask for list |

Reader types: **A** static HTML · **B** JSON feed · **C** bulk file · **D** real browser · **E** assisted human lookup · **F** export or shared sheet.

Permissions received on 4 Nov 2026 (Star Médica, CONACEM) are recorded from the team's account of the letters; check the wording against the signed copies. A permission that lets us past a control says so in the adapter's `permission.waives` (`robots`, `block`), and nothing else may skip robots.txt or use a non-bot identity.


## Logo use

Authorization to show the logo on medsociety.one, recorded 6 Nov 2026 for all six organizations below. A logo shows only when `organizations.logo_permission_at` is set, which migration 0042 does for these six. Any new organization starts without one.

| Organization | Slug | File | Note |
|---|---|---|---|
| Hospital Ángeles | `hospital-angeles` | `hospital-angeles.png` | |
| Star Médica | `starmedica` | `starmedica.png` | |
| CONACEM | `conacem` | `conacem.png` | |
| COEPRIS Baja California | `coepris-bc` | `coepris-bc.png` | Their logo has white lettering, so we placed it on their site's burgundy (`#6a1c32`) to read on a white tile |
| Padrón Estatal de Salud | `padron-salud-bc` | `padron-salud-bc.png` | The logo of the Secretaría de Turismo, which runs the site |
| Baja Health Cluster | `baja-health-cluster` | `baja-health-cluster.png` | |

The date is when we recorded the authorization. Each organization's own date and the location of its written OK are still to be added here.

## What a permission letter must say

1. Signed by someone with authority, on letterhead or from the organization's official domain.
2. Who we are (DropDev / MedSociety) and the purpose: verifying doctors' affiliations and certification for patient safety.
3. The control it permits, named: automated access despite a CAPTCHA, robots.txt rule or access block, if any.
4. Scope: which pages or data, how often, maximum request rate, how our reader identifies itself.
5. What we may do with the data: store it, show a badge, link back, show it publicly. Logo use, separately.
6. That the data is public, or that they may share it (Mexico's LFPDPPP).
7. Duration, how to revoke it, and a contact person.

## Adding a source

1. Add a row here with access and basis. If permission is needed, stop until the letter is recorded.
2. Write `docs/sources/<slug>.md` (what it is, fields, quirks, how to run).
3. Write the adapter in `scripts/sources/adapters/` and its self-test cases. See [`scripts/sources/README.md`](../../scripts/sources/README.md).
