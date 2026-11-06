# Star Médica

Status: built 4 Nov 2026 · Owner: Emilio · Adapter: `scripts/sources/adapters/starmedica.ts`

The doctor directory of Star Médica Ciudad Juárez. Star Médica has **no hospital in Tijuana** (its directory lists none, though the site footer names Tijuana). A listed doctor gets an **affiliation** badge, and because every card shows **cédula numbers**, a match can confirm automatically (tier 1, [ADR 0004](../adr/0004-matching-and-freshness.md)).

## Permission

Received 4 Nov 2026: scrape, store and display the doctor directory. The signed copy is in the team vault. Logo use is not yet confirmed.

## How it is read

- A Salesforce Experience Cloud site: cards exist only after JavaScript runs, so the adapter drives a **real browser** (Playwright Chromium) that identifies as `MedSocietyBot` in its user agent and sends an `X-Client: MedSocietyBot` header. robots.txt allows everything (checked every run).
- **A search returns at most 100 doctors**, alphabetically, so a hospital-wide search stops partway through "M". The adapter reads the specialty list from the site's own search box (about 120 values, typos included: "Oftamología", "Cradiología"), then searches `?hospital=Star Médica Ciudad Juárez&especialidad=<value>` once per specialty, about 2–3 seconds apart. A doctor found under several specialties is merged by ID.
- If any one search returns 100, the run turns **red**: that specialty may be cut off.
- The filter list on the results page is built from the 100 loaded cards, so it misses specialties; it is not used.

## Fields per doctor

| Field | Where | Notes |
|---|---|---|
| External ID | the name span's `id`, e.g. `a8qRN00000006IVYAY-28` | Salesforce record ID; the `-NN` render suffix is dropped |
| Name | `span.nombre` | No title printed |
| Specialty | `.especialidad` | Composite values ("Pediatría/Alergia e Inmunología Clínica") are split |
| Hospital, office | card text, "Consultorio 929" | |
| Cédulas | "Ced. Prof. 3523954 // 4991233" | Every number kept (6–9 digits, leading zeros kept); which is the licenciatura is not labelled |
| Phone | shown on the card | **Not collected** |

## Run it

```bash
npm run sources -- --source=starmedica
docker compose run --rm sources --source=starmedica
```

About 15–20 minutes per run (one search per specialty, paced).
