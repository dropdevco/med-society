# CONACEM

Status: built 4 Nov 2026 · Owner: Emilio · Adapter: `scripts/sources/adapters/conacem.ts`

CONACEM (Comité Normativo Nacional de Consejos de Especialidades Médicas) is the national register of specialty board certifications for all 47 consejos. It is the **certification** source: whether a specialist's board certification is current, and until when.

## Permission

Received 4 Nov 2026: display the data, obtained by whatever means works, because CONACEM will not change its site or add an API. The signed copy is in the team vault. **It waives** robots.txt (CONACEM answers 403 to it) and the firewall's refusal of our bot. See [ADR 0002](../adr/0002-source-access-policy.md) and the register.

## How it is read

- `conacem.org.mx/buscador` is a JavaScript app over a JSON endpoint:
  `GET /api/buscador/medico-especialista/{consejo}/{especialidad}/{cursor}/next/{name}`
  where consejo `0` means all consejos, especialidad `vacio` means any, cursor `0` is the first page and `id_ultimo` the next.
- **A name is required**: there is no browsable list. So this is a **lookup source**: each run asks CONACEM about every doctor in the latest good runs of the hospital sources (Hospital Ángeles, Star Médica), by their two surnames with accents removed. The search ignores accents and case. Up to 3 pages per lookup.
- The firewall refuses non-browser clients and headless Chromium's default identity. Under the permission the adapter uses a real browser with a standard Chrome identity, loads the search page once, and calls the endpoint from inside it, a few seconds apart, sending an `X-Client: MedSocietyBot` header.
- A lookup that returns fewer certificates than last week is not a drop: lookup runs are not compared to a baseline. A 403 on any lookup stops the run red.

## Fields per certificate

| Field | JSON | Notes |
|---|---|---|
| External ID | `id` | CONACEM's certificate record ID |
| Name, **split** | `nombre`, `paterno`, `materno`, `titulo` | Removes the three-word ambiguity for these doctors |
| Consejo, specialty | `consejo`, `especialidad` | |
| Valid from / to | `inicio`, `fin` | Certification runs 5 years |
| Certificate | `numero_certificado`, `libro`, `foja` | |
| Cédula | — | **Not published** |

Example: a radiologist with a five-year certificate, details left out of this public file. That explains the meeting's SEP/CMRI conflict: SEP still shows the certification that expired in 2023, CONACEM the 2024 renewal.

Results come back for whoever shares a surname pair, so a lookup can return certificates of other doctors; matching to our doctors happens in the identity step (on hold until Carlos approves the tables).

## Run it

```bash
npm run sources -- --source=conacem      # needs a good run of hospital-angeles and/or starmedica first
```

Roughly one lookup per doctor at the hospital sources, a few seconds apart: 30–40 minutes for ~550 doctors.
