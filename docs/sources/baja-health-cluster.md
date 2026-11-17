# Baja Health Cluster

Status: recovery centers built 6 Nov 2026; doctors and dentists built 16 Nov 2026 · Owner: Emilio · Adapters: `scripts/sources/adapters/baja-health-cluster.ts`, `scripts/sources/adapters/baja-health-cluster-doctors.ts`

The medical industry cluster's directories of recovery centers (source `baja-health-cluster`, facility badges) and of doctors and dentists (source `baja-health-cluster-doctors`, doctor badges). Both feed the one organization, whose kind is `cluster` (migration 0050), so "doctors at Baja Health Cluster" is one search filter. A listed center or doctor gets an **affiliation** badge. This is membership, not a safety check: the COEPRIS badge is what shows a center is regulated.

## Access

Open. robots.txt blocks only `/wp-admin/`. Logo use authorized, recorded 6 Nov 2026 (see [Logo use](README.md#logo-use)).

## How it is read

- One server-rendered page, `general-directory/recovery-centers/`: 6 centers on 6 Nov 2026, one of them a hotel (Hotel Quartz & Spa).
- Each card links twice to `institucion/<slug>/`; the slug is the external ID and the badge's link.
- It shows no register number, so **every match goes to review**.

## Doctors and dentists

- Two server-rendered list pages, `general-directory/doctors/` (96 on 16 Nov 2026) and `general-directory/dentists/` (10). Each card gives the name, the profile link `directorio/<slug>/` (the external ID and the badge's link) and English specialty tags.
- The run then reads every profile at the usual polite pace (about six minutes). A profile adds the specialties in Spanish, the office address (the title of its map), and sometimes a cédula. Phones, e-mails and social links are not read.
- Only **5 of 106** profiles showed a cédula on 16 Nov 2026, mostly in English ("Professional license …", "National Registry (DGP) …"); 2 of those are cédulas we already hold. A cédula we already hold confirms; everything else goes to review or, once enabled, the AI scorer ([ADR 0012](../adr/0012-ai-match-scorer.md)). A name alone never confirms ([ADR 0004](../adr/0004-matching-and-freshness.md)).
- The badge reads "Member doctor" or "Member dentist".
- Before loading, preview what the loader would decide, read-only:

```bash
npm run sources -- --source=baja-health-cluster-doctors
npm run sources:preview -- --source=baja-health-cluster-doctors
```

## Related

ACERBAC, the recovery centers' own association, would be a stronger signal, but its site does not load: the list has to come from them. It signed a framework agreement with the cluster in 2026.

## Run it

```bash
npm run sources -- --source=baja-health-cluster
```
