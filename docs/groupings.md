# How MedSociety groups doctors, clinics and organizations

What each kind of thing in the directory is, how they connect, and what a patient sees. Written 17 Nov 2026 for the team; numbers are from production that day. For the badge pipeline end to end see [badges.md](badges.md); for clinic teams see [clinics.md](clinics.md).

## The short version

- A **listing** is a page on the site: one doctor, one clinic, or one recovery stay.
- A **doctor** is a person. One doctor can have several listings (duplicates from different imports). Doctors have an internal ID that is never shown or asked for.
- An **organization** is a body whose list we read and whose badge we show: a hospital, a specialty board, a cluster, a regulator.
- A **source** is one list we read from an organization's website. One organization can have several.
- A **badge** says "this organization lists this doctor (or this clinic)". A doctor's badge shows on every listing of that doctor.
- A **group** ("doctors at Hospital Ángeles") is just an organization used as a search filter.

```
 Organization ──has──▶ Source ──each run reads──▶ Source record
 (Star Médica)        (starmedica)               (one doctor or one clinic, as the source shows it)
                                                        │
                                                matched to │  by cédula, by a person, or by the AI scorer at 80+
                                                        ▼
                             Doctor (a person) ──has──▶ Listing(s) on the site
                                    │                        ▲
                                    └──── badge ─────────────┘  shown on every listing of that doctor

 Clinic listing ──clinic_practitioners──▶ the doctors who work there (each keeps their own listing)
 Clinic or stay listing ◀── facility badge ── a regulator or cluster record (COEPRIS, Padrón, Baja Health Cluster)
```

## The entities

### Listing (`providers`)

What the site shows: one page at `/providers/:id`. That ID never changes. A listing has a **kind**:

| Kind | Meaning | Count |
|---|---|---|
| (empty) | One doctor, or not known | 9,051 |
| `clinic` | A clinic: several doctors, several focus areas ([ADR 0013](adr/0013-clinic-listings.md)) | 3,581 |
| `stay` | A post-surgery recovery house | 23 |

A clinic's page lists its doctors, each linking to that doctor's own listing (84 such links today). Linking a doctor to a clinic never lets the clinic edit the doctor's listing.

### Doctor or physician (`doctors`)

One real person, with an internal UUID. **8,439 doctors**, of whom 8,396 have at least one listing.

- A doctor's **cédulas** (professional licence numbers) are the strongest proof of identity: one cédula belongs to one doctor.
- A doctor can have **more than one listing** (the same person imported twice). Badges belong to the doctor, so they show on all of them.
- The UUID is internal. No form or page ever asks a doctor for it; doctors are found by cédula or name.

### Organization (`organizations`)

Anyone whose badge we show. Each has a name, a logo (shown only with permission on record), and one **kind**. The kind decides which of three badge groups the badge falls in:

| Kind | What it is | Badge group | In production now |
|---|---|---|---|
| `hospital` | A hospital whose directory lists the doctor | Affiliation | Star Médica, Hospital Ángeles |
| `consejo` | A specialty board that certifies doctors | **Credential** | CONACEM |
| `colegio` | A professional college (colegio) of doctors | Affiliation | none (colegios dropped 21 Nov 2026, [ADR 0015](adr/0015-certifications-from-conacem-only.md)) |
| `association` | A professional or industry association | Affiliation | none yet (ACERBAC not readable) |
| `cluster` | A regional business cluster of many kinds of providers | Affiliation | Baja Health Cluster |
| `wellness_center` | A wellness or recovery network listing its members | Affiliation | none yet |
| `regulator` | A government body that registers facilities | **Facility** | COEPRIS BC, Padrón Estatal de Salud |
| `accreditor` | A body that accredits facilities | **Facility** | GHA, JCI (worldwide; only records in our regions are matched) |

The site shows badges in this order: **Credential** (a qualification was checked), then **Facility** (a regulator checked the place), then **Affiliation** (membership: says nothing about quality).

### Cluster vs organization

A cluster is not a different thing from an organization: it is one **kind** of organization. A cluster differs from an association in who its members are. An association is usually one profession or one sector; a cluster mixes doctors, dentists, hospitals and recovery centers in one region. Both read as affiliations.

Baja Health Cluster is the one cluster today. It has two sources, and both feed the same organization, so "doctors at Baja Health Cluster" in search returns its doctors **and** its recovery centers.

### Source (`data_sources`) and entity

One list we read, on a weekly schedule, under the access rules of [ADR 0002](adr/0002-source-access-policy.md). Each source describes one **entity**: doctors or facilities.

| Source | Organization | Entity | What it reads |
|---|---|---|---|
| `hospital-angeles` | Hospital Ángeles | doctor | Doctor directories, Tijuana and Ciudad Juárez |
| `starmedica` | Star Médica | doctor | Doctor directory, Ciudad Juárez |
| `conacem` | CONACEM | doctor | Board-certified specialists |
| `baja-health-cluster-doctors` | Baja Health Cluster | doctor | 106 member doctors and dentists |
| `baja-health-cluster` | Baja Health Cluster | facility | Member recovery centers |
| `coepris-bc` | COEPRIS BC | facility | Registered recovery residences |
| `padron-salud-bc` | Padrón Estatal de Salud | facility | The state's register of facilities |
| `doctoralia`, `manual`, `ai-scorer` | none | doctor | Not badge sources: the original import, badges changed by hand, and the AI scorer's runs |

Every run of a source has its own run ID and time, and so does every record it writes.

### Badge (`doctor_affiliations`, `listing_affiliations`)

- A **doctor badge** hangs on the doctor and shows on every listing of that doctor. **574** confirmed today.
- A **facility badge** hangs on a clinic or stay listing directly.
- **347 listings** show at least one badge today.
- A badge is **confirmed**, **lapsed** (the organization stopped listing the doctor for two weekly runs), or **hidden** (removed by hand; a run never brings it back).

## How a source record becomes a badge

Each record a source publishes is matched to a doctor (or, for facilities, a listing):

| Status | Meaning | Doctors today |
|---|---|---|
| confirmed | Linked: the badge shows | 9,060 records |
| probable | A likely doctor, waiting in `/admin` → Verification | 698 |
| unmatched | No doctor like it in the directory | 1,651 |
| rejected | A person said it is not that doctor | 0 |

A record is confirmed in one of three ways:

1. **By cédula.** The record prints a cédula we already hold for that doctor.
2. **By a person**, in `/admin` → Verification.
3. **By the AI scorer** ([ADR 0014](adr/0014-ai-auto-link-live.md), since 17 Nov 2026). Gemini 3.8 Flash rates each waiting match from 0 to 100, and a match it approves at 80 or above is linked. On the first run it scored 1,129 records and linked 482. A cédula conflict always waits for a person. Every AI link records the run that made it and can be undone by that run, or split if one doctor turns out to be several people.

A name alone used to be never enough ([ADR 0004](adr/0004-matching-and-freshness.md)). ADR 0014 changed that for AI matches at 80 or above.

## Groups on the site

"Doctors at X" is a search filter on organizations: `?org=starmedica`, and several are allowed (`?org=starmedica&org=hospital-angeles`). The filter panel lists each organization with how many results carry its badge. The agent API takes the same filter as `organization`.

There is no separate groups table: an organization **is** the group.

## Not decided yet

- **Hierarchy.** Parent and child organizations (Grupo Ángeles → Hospital Ángeles Tijuana; CONACEM → each specialty board), or a ranking of badge types, or both. Today a hospital's branch is the badge's label and a CONACEM board is in the badge's facts. Needs an ADR first.
- **What "Verified" means** ([ADR 0005](adr/0005-meaning-of-verified.md)), and whether an AI-linked badge can count toward it.

## Glossary

| Term | Español | Table |
|---|---|---|
| Listing | Perfil / ficha | `providers` |
| Doctor, physician | Médico | `doctors` |
| Clinic | Clínica | `providers` with `kind = 'clinic'` |
| Stay | Casa de recuperación | `providers` with `kind = 'stay'` |
| Organization | Organización | `organizations` |
| Cluster | Clúster | an organization with `kind = 'cluster'` |
| Specialty board | Consejo de especialidad | an organization with `kind = 'consejo'` |
| Source | Fuente | `data_sources` |
| Badge | Insignia | `doctor_affiliations`, `listing_affiliations` |
| Cédula | Cédula profesional | `doctor_cedulas` |
