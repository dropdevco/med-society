# AGENTS.md

Orientation for AI coding agents (and a quick map for people). The full engineering handoff is [`HANDOFF.md`](HANDOFF.md); read its sections 5 and 10 before changing data code.

## What this is

MedSociety (medsociety.one): a bilingual (EN/ES) directory and lead marketplace for cross-border medical care in two regions, El Paso–Ciudad Juárez (`elpaso-juarez`) and San Diego–Tijuana (`sandiego-tijuana`). React 19 + Vite + TypeScript, Supabase (Postgres, RLS, Auth, Storage), Vercel serverless functions in `api/`.

## Where things are

| Path | What |
|---|---|
| `src/` | The app: pages, components, hooks, `lib/` (Supabase, auth, billing), `utils/` (search, filters, region) |
| `api/` | Vercel functions. **Self-contained**: they cannot import from `src/`; shared logic is copied and checked by self-tests |
| `supabase/migrations/` | Applied by hand to production. Check production's `schema_migrations` before choosing a number |
| `scripts/doctoralia/` | One-off listing importer (Doctoralia, Google Places) |
| `scripts/sources/` | Recurring organization-source pipeline for badges and verification. See its [README](scripts/sources/README.md) |
| `docs/adr/` | Architecture decision records |
| `docs/roadmap/` | Roadmaps with phase status |
| `docs/sources/` | Data-source permissions register and one page per source |

## Hard rules

- **Contact data never comes from bulk reads.** Provider e-mail, phone, website and socials are revoked from the anon key (migration 0032); read one provider through `provider_public(p_id)` or `src/lib/providerRead.ts`. Never `select *` for contact fields.
- **Secrets stay out.** `SUPABASE_SERVICE_ROLE_KEY` and anything without a `VITE_` prefix never reach client code or this public repository. Never print a secret's value.
- **Outside sources follow [ADR 0002](docs/adr/0002-source-access-policy.md):** read a source only when it is open or written permission is recorded in [`docs/sources/README.md`](docs/sources/README.md); identify as `MedSocietyBot`; never work around a CAPTCHA, login, robots.txt rule or block.
- **Every source run has a UUIDv7 run ID, and every record it writes carries that ID and a UTC timestamp** (`runId`/`observedAt` in run files, `run_id` columns in the database). See [`scripts/sources/README.md`](scripts/sources/README.md#run-ids).
- **Doctor data from sources never lands in git.** Run output lives in `scripts/sources/.data/` (ignored). Self-test fixtures are synthetic.
- **Change one copy, change the other.** Search, rating and filter logic exists in both `src/utils/` and `api/agent.ts`; run `npx tsx scripts/agent-selftest.ts` after touching either.
- **Stage named paths only** (never `git add -A`); `docs/proposals/` holds third-party logos and screenshots and must not be committed.
- **A decision that contradicts an ADR or the delegation plan is raised, not made quietly.** Open conflict today: what "Verified" means ([ADR 0005](docs/adr/0005-meaning-of-verified.md)).

## Commands

```bash
npm run dev                  # Vite on port 5174
npm run build                # tsc -b && vite build
npm run lint                 # has known errors, see HANDOFF.md section 10
npm run sources:selftest     # source pipeline checks, no network
npm run sources -- --source=hospital-angeles   # one source, dry run
```

There is no test framework; each area has a runnable self-test in `scripts/*-selftest.ts` (HANDOFF.md section 8).
