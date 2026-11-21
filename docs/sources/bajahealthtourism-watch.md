# bajahealthtourism.com.mx, watch only

Status: built 21 Nov 2026 · Owner: Emilio · Adapter: `scripts/sources/adapters/bajahealthtourism-watch.ts`

A listener, not a source of badges. It tells the team when a doctor, hospital, clinic or hotel **shows up** on Baja Health Tourism's site, so someone can look and decide whether to invite them or link a listing. Nothing it reads becomes a badge, a match or anything on medsociety.one.

Not the same site as the [Padrón Estatal de Salud](padron-salud-bc.md) (`bajahealthtourism.com`).

## Access

Open: the site's public catalogue, read through the same JSON API its pages use (`ws.bajahealthtourism.com.mx/api`). Identifies as MedSocietyBot, obeys robots.txt, one request every 3 seconds. Five requests a run: the municipalities and one list per kind.

## What it keeps, and what it never keeps

**The API returns far more than the pages show**, including personal data: phone numbers, e-mails, tax IDs (RFC), identity and licence documents. The adapter keeps an allow-list and drops everything else before anything is written:

| Kept | From |
|---|---|
| Kind (`doctor`, `hospital`, `clinic`, `hotel`), site ID, name, slug | the list |
| Municipality, our region | `/cities` |
| The section's public URL, the date it was listed | |

Inactive records are skipped. **Tell Baja Health Tourism** that their API exposes this data; we do not store it.

## How a flag works

- Runs **daily** (`docs/ops/bajahealthtourism-watch.yml`).
- The first run stores everything as a baseline and flags nothing.
- Each later run compares with the last green run. Every record that appeared prints one line, `new doctor: Name (Tijuana) https://…`, in the job's summary on GitHub, and is in `source_entries` with the run's ID.
- An empty list does not turn the run red (there were no hospitals or clinics on 21 Nov 2026); a failed request does.

On 21 Nov 2026: 159 doctors (69 in Tijuana, 2 in Ensenada, 7 in Mexicali, 87 with no municipality), 6 hotels, no hospitals or clinics. A record with no municipality has no region; it is still flagged when it appears.
