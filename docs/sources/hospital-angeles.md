# Hospital Ángeles

Status: building (roadmap phase 1) · Owner: Emilio · Last updated 2 Nov 2026

The doctor directories of Hospital Ángeles' two hospitals in our regions. A doctor listed there gets an **affiliation** badge for that hospital once matched to their MedSociety listing.

## Permission

Written permission received 30 Oct 2026 to scrape, store and display the directory data, **on condition that we keep it up to date**. Signed by two Hospital Ángeles officials; the signed copy is in the team vault. Logo use is not yet confirmed: ask in the same thread before the logo appears on medsociety.one.

Keeping it up to date means: the pipeline runs weekly, and a doctor missing from two consecutive good runs loses the badge ([ADR 0004](../adr/0004-matching-and-freshness.md)).

## What we read

| Target | URL | Doctors (30 Oct 2026) |
|---|---|---|
| Hospital Angeles Tijuana | `https://hospitalangeles.com/tijuana/directorio-medico` | 151 |
| Hospital Angeles Ciudad Juárez | `https://hospitalangeles.com/ciudadjuarez/directorio-medico` | 243 |

- Server-rendered HTML, one page per city, no paging. Two requests per run.
- We read the Spanish original. `en.hospitalangeles.com` is a Weglot translation of the same pages.
- robots.txt (30 Oct): `User-agent: *` disallows only `/*?st=*`. The pipeline checks it on every run.

## Fields per doctor

From each card (`.blog-card.secondary_blog_card`):

| Field | Where | Notes |
|---|---|---|
| External id | slug in the "Ver más" link, `/medico/<slug>` | Stable key for this source |
| Name and title | `h6`, e.g. "Dr. …", "Dra. …", "Lic. …" | Title split off; "Lic." marks non-physician staff (4 on 2 Nov) |
| Specialty | `.especialidad` | Several specialties are comma-separated |
| Hospital(s) | each `.hospital-pill`: text, `data-dir` (address), `data-torre`, `data-cons` (office) | A doctor can list more than one hospital |
| Photo | `.blog-card-thumb img` | Stored as a URL only. The generic `directorio-medico.jpg` (85 doctors) is stored as no photo |

**No cédula.** Every match from this source goes to human review. The profile page (`/medico/<slug>`) adds only the hospital switchboard number and extension, so it is not fetched.

## Quirks

- The Tijuana page had 152 cards for 151 slugs: one doctor appears twice. The adapter merges duplicates by slug and unions their hospitals.
- `data-dir` ends with a trailing comma; it is trimmed.

## Run it

```bash
npm run sources -- --source=hospital-angeles             # dry run: fetch, parse, judge, write a snapshot
docker compose run --rm sources --source=hospital-angeles
```

Output lands in `scripts/sources/.data/hospital-angeles/` (git-ignored).
