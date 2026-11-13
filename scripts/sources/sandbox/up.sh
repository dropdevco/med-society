#!/usr/bin/env bash
# A throwaway copy of the database on this machine, never production: Postgres 17
# with migrations 0042 to 0045, PostgREST in front, and a small proxy so the pipeline's
# Supabase client talks to it unchanged.
#   bash scripts/sources/sandbox/up.sh       # start, then seed with seed.mts
#   bash scripts/sources/sandbox/down.sh     # remove everything
set -euo pipefail
export MSYS_NO_PATHCONV=1
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
root="$(native "$(cd "$(dirname "$0")/../../.." && pwd)")"

docker rm -f ms-sandbox-db ms-sandbox-api >/dev/null 2>&1 || true
docker network create ms-sandbox >/dev/null 2>&1 || true
docker run -d --name ms-sandbox-db --network ms-sandbox -e POSTGRES_PASSWORD=sandbox \
    -p 127.0.0.1:54329:5432 -v "$root/supabase:/supabase:ro" -v "$root/scripts/sources/sandbox:/sandbox:ro" postgres:17 >/dev/null
for _ in $(seq 1 40); do docker exec ms-sandbox-db pg_isready -U postgres -q && break; sleep 1; done
sleep 2
psql() { docker exec ms-sandbox-db psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
psql -f /supabase/tests/doctors-and-badges/stubs.sql
psql -f /sandbox/extra.sql
psql -f /supabase/migrations/0042_doctor_identity.sql
psql -f /supabase/migrations/0043_sources_and_badges.sql
psql -f /supabase/migrations/0044_facility_badges.sql
psql -f /supabase/migrations/0045_organization_logos.sql
psql -f /supabase/migrations/0046_facility_candidates_index.sql
psql -f /sandbox/admin.sql
docker run -d --name ms-sandbox-api --network ms-sandbox \
    -e PGRST_DB_URI=postgres://postgres:sandbox@ms-sandbox-db:5432/postgres \
    -e PGRST_DB_SCHEMAS=public -e PGRST_DB_EXTRA_SEARCH_PATH=extensions -e PGRST_DB_ANON_ROLE=service_role \
    -p 127.0.0.1:54330:3000 postgrest/postgrest:v12.2.3 >/dev/null
echo "sandbox up: Postgres on 54329, API on 54330. Start the proxy: npx tsx scripts/sources/sandbox/proxy.ts"
