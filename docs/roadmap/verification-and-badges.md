# Roadmap: source pipeline, verification and organization badges

Status: in progress · Owner: Emilio (plan streams E and J) · Last updated 2 Nov 2026

MedSociety shows patients which doctors are affiliated with and certified by real institutions, so they can avoid non-compliant providers. This roadmap builds the pipeline that reads those institutions' own directories, matches them to our listings, and shows the result as badges.

Every phase ends with a demo and a go/no-go. Nothing is applied to production, pushed or merged without an explicit yes.

## Status

| Phase | What | Done when | Status |
|---|---|---|---|
| 0 | Decisions and docs: [ADRs](../adr/README.md), [sources register](../sources/README.md) | ADRs approved; Carlos decides [0005](../adr/0005-meaning-of-verified.md) | ADRs written, waiting for review |
| 1 | Pipeline core + Hospital Ángeles reader, Docker | Self-test passes; a dry run finds ~151 + 243 doctors, green, locally and in Docker | **In progress** |
| 2 | Database tables + matching ([0003](../adr/0003-affiliation-data-model.md), [0004](../adr/0004-matching-and-freshness.md)) | Dry run reports matched / queued / unmatched; a second run changes nothing | Waiting for phase 1 and DB access |
| 3 | Star Médica Juárez reader (Playwright, per-specialty to beat the 100-result cap) | Union of specialty searches > 100 and stable; cédula matches confirm | Waiting for permission letter |
| 4 | Review queue: Verification and Sources tabs in `/admin` | One click decides a match; reviewer and time stored | Not started |
| 5 | Show badges: card, profile, `/api/v1`, JSON-LD, "member of" filter | A confirmed test affiliation shows everywhere in EN and ES | Waiting for 0005 |
| 6 | Weekly runs on a Hetzner VM ([0006](../adr/0006-pipeline-runtime.md)) | Two unattended weekly runs, green in `/admin` | Not started |
| 7+ | Next sources: Sectur, COEPRIS, CMCPER, CLUES, colegios, associations, then consejos as letters arrive | Per source | Not started |

## Badge design

Badges are the organizations' own logos, on white rounded tiles, grouped as **Credential** (site accent green), **Affiliation** (indigo) and **Facility** (gray). The search card shows the credential tiles and the first two affiliations, then "+N more"; clicking a logo opens its details: name, type, status, verified on, valid to, source and link. A logo appears on the live site only after that organization's OK is recorded in the register.

## Decisions waiting on others

- **Carlos:** what "Verified" means ([0005](../adr/0005-meaning-of-verified.md)); service-role database access for the pipeline; the production migration list; a Hetzner account.
- **David / Emilio:** Star Médica letter; the rest in the order in the [register](../sources/README.md).
- **Legal:** confirm our privacy notice covers storing doctors' public directory data (LFPDPPP).
