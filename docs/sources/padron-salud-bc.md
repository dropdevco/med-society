# Padrón Estatal de Salud

Status: built 6 Nov 2026 · Owner: Emilio · Adapter: `scripts/sources/adapters/padron-salud-bc.ts`

The public catalog at `bajahealthtourism.com`, run by Baja California's Secretaría de Turismo. It lists doctors, hospitals, clinics and residences, with their registrations. A listed recovery center gets a **facility** badge.

## Access

Open. robots.txt blocks only `/admin`, `/portal` and `/login`, and no terms are published. Logo use is not confirmed.

## How it is read

- Server-rendered. `catalogo?tipo=assiting-living` (the site's own spelling) lists the residences on one page: 11 records for 7 businesses on 6 Nov 2026. Then one page per record, paced like every request.
- Records outside our regions (Mexicali, Ensenada, San Quintín) are skipped.
- Several are elder care rather than post-operative recovery (Serena Senior Care). They are read, and get a badge only if a listing matches.
- Palmas, Zen & Healthy and Baja Premium are not in this category, so they carry no Padrón badge. A search for "Zen" found nothing either.

## Fields

| Field | Where | Notes |
|---|---|---|
| External ID | the page's slug | |
| Name, address | `h1.dp-name`, `.dp-loc span` | |
| Register number | "Registros y Vigencias": "No. 20260008808" | Ties the record to COEPRIS: a match on it confirms by itself |
| Expiry | "Vigencia: 03/09/2028" | Kept only while the row says "Vigente" |

## Run it

```bash
npm run sources -- --source=padron-salud-bc
```

About a minute. A first load finds nothing to confirm until COEPRIS's records are confirmed on listings.
