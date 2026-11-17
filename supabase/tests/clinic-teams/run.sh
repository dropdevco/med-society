#!/usr/bin/env bash
# Runs 0020b_clinic_teams, 0042-0043 and 0049_clinic_listings in a throwaway local Postgres 17
# (never production) with made-up data.
#   bash supabase/tests/clinic-teams/run.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: keep /sql paths inside the container as written
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
here="$(native "$(cd "$(dirname "$0")" && pwd)")"
docker rm -f ms-clinic-test >/dev/null 2>&1 || true
docker run -d --name ms-clinic-test -e POSTGRES_PASSWORD=localtest -v "$here/..:/sql:ro" -v "$here/../../migrations:/migrations:ro" postgres:17 >/dev/null
trap 'docker rm -f ms-clinic-test >/dev/null' EXIT
for _ in $(seq 1 40); do docker exec ms-clinic-test pg_isready -U postgres -q && break; sleep 1; done
sleep 2
psql() { docker exec ms-clinic-test psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
psql -f /sql/doctors-and-badges/stubs.sql
psql -f /sql/clinic-teams/stubs.sql
for m in 0020b_clinic_teams 0042_doctor_identity 0043_sources_and_badges; do psql -f "/migrations/$m.sql"; done
psql -f /sql/clinic-teams/seed.sql
psql -f /migrations/0049_clinic_listings.sql && echo "0049 applied"
out="$(psql -f /sql/clinic-teams/exercise.sql 2>&1)" || { echo "$out"; echo "FAILED: exercise stopped on an error"; exit 1; }
echo "$out"
if echo "$out" | grep -qE ' \| f$'; then echo "FAILED: a check returned false"; exit 1; fi
echo "all checks passed: $(echo "$out" | grep -cE ' \| t$') true, $(echo "$out" | grep -c 'NOTICE:  ok') refused"
