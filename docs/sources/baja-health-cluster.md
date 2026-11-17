# Baja Health Cluster

Status: built 6 Nov 2026 · Owner: Emilio · Adapter: `scripts/sources/adapters/baja-health-cluster.ts`

The medical industry association's directory of recovery centers. A listed center gets an **affiliation** badge. This is membership, not a safety check: the COEPRIS badge is what shows a center is regulated.

## Access

Open. robots.txt blocks only `/wp-admin/`. Logo use authorized, recorded 6 Nov 2026 (see [Logo use](README.md#logo-use)).

## How it is read

- One server-rendered page, `general-directory/recovery-centers/`: 6 centers on 6 Nov 2026, one of them a hotel (Hotel Quartz & Spa).
- Each card links twice to `institucion/<slug>/`; the slug is the external ID and the badge's link.
- It shows no register number, so **every match goes to review**.

## Related

ACERBAC, the recovery centers' own association, would be a stronger signal, but its site does not load: the list has to come from them. It signed a framework agreement with the cluster in 2026.

## Run it

```bash
npm run sources -- --source=baja-health-cluster
```
