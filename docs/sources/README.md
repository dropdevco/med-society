# Data sources and permissions register

Status: living document · Owner: Emilio · Last updated 2 Nov 2026

Every outside source the pipeline in `scripts/sources/` reads, or plans to read, is listed here. A source is built only when its access is **open** or **permission** is recorded below ([ADR 0002](../adr/0002-source-access-policy.md)). Signed letters are kept in the team vault, never in this repository; this table records only what they allow.

## Register

| Source | Slug | Kind | Access | Permission / basis | Reader | Cédula | Cadence | Status |
|---|---|---|---|---|---|---|---|---|
| Hospital Ángeles (Tijuana, Ciudad Juárez) | `hospital-angeles` | hospital | permission | Letter received 30 Oct 2026: scrape, store and display, on condition we keep it up to date. Signed by two Hospital Ángeles officials; copy in the team vault. Logo use not yet confirmed | A, static HTML | No | Weekly | **Building** (phase 1) |
| Star Médica (Ciudad Juárez only) | `starmedica` | hospital | permission needed | Terms page does not render; letter to request | D, real browser | Yes | Weekly | Waiting for letter |
| Centro Médico de Especialidades (Juárez) | — | hospital | unknown | Not researched yet | — | — | — | Research |
| Sectur `bajahealthtourism.com` | — | regulator register | open | robots.txt blocks only `/admin`, `/portal`, `/login`; no terms published | A | Yes | Weekly | Planned |
| COEPRIS BC REPSSABI | — | regulator (facilities) | open | robots.txt allows all; public JSON feed | B, JSON | Facilities | Weekly | Planned |
| CMCPER (plastic surgery board) | — | consejo | open | robots.txt allows the directory pages | A | Cert. no. | Weekly | Planned |
| CLUES | — | regulator (facilities) | open | "No existen restricciones para su uso" | C, file | Facilities | Monthly | Planned |
| CCPERBC | — | colegio | open | robots.txt blocks only `/wp-admin/` | A | No | Weekly | Planned |
| Baja Health Cluster | — | association | open | robots.txt blocks only `/wp-admin/`; ask for cédulas | A | No | Weekly | Planned |
| CONACEM | — | consejo umbrella | permission needed | Returns 403 to automated readers | E, assisted | ? | Per claim | Letter to send |
| SEP (cédula registry) | — | government | permission needed | reCAPTCHA on every call; also file a transparency request | E, assisted | Yes | Per claim | Letter to send |
| CMGO | — | consejo | permission needed | Directory moved behind a doctor login | E, assisted | ? | Per claim | Letter to send |
| ADM dental council | — | consejo | permission needed | robots.txt bars AI agents | E, assisted | ? | Per claim | Letter to send |
| JCI | — | accreditor | permission needed | 403; robots.txt bars AI agents | E, assisted | Facilities | Yearly | Low priority |
| ACERBAC | — | association | export | Site down, no public list | F, export | ? | Monthly | Ask for list |
| CMMI | — | consejo | export | Statute clause 18.4 promises the directory on request | F, export | ? | Monthly | Ask for list |

Reader types: **A** static HTML · **B** JSON feed · **C** bulk file · **D** real browser · **E** assisted human lookup · **F** export or shared sheet.

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
