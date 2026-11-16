# Ops

Files that run somewhere other than this repository. Reviewed here, copied there.

| File | Where it runs | Why it is not here |
|---|---|---|
| [`sources-weekly.yml`](sources-weekly.yml) | `dropdevco/med-society-ops` (private), as `.github/workflows/sources-weekly.yml` | Its logs name sources, counts and errors, and it holds the service-role key: [ADR 0011](../adr/0011-scheduler-on-private-actions.md) |

## Setting up `med-society-ops`

1. Create the private repository `dropdevco/med-society-ops`.
2. Add the two secrets named at the top of `sources-weekly.yml`.
3. Copy `sources-weekly.yml` to `.github/workflows/` there and push.
4. Actions → Weekly source run → Run workflow, with one source (for example `baja-health-cluster`) to check it end to end before the first Monday.

A red run exits non-zero, so the job fails and GitHub e-mails the repository's watchers. The run's details are in `source_runs` and on the dashboard.
