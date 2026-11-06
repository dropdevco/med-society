#!/usr/bin/env bash
# Runs migrations 0035 and 0036 in a throwaway local Postgres 17 (never production) with made-up data.
#   bash supabase/tests/0035/run.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: keep /sql paths inside the container as written
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
here="$(native "$(cd "$(dirname "$0")" && pwd)")"
docker rm -f ms-0035-test >/dev/null 2>&1 || true
docker run -d --name ms-0035-test -e POSTGRES_PASSWORD=localtest -v "$here:/sql:ro" -v "$here/../../migrations:/migrations:ro" postgres:17 >/dev/null
trap 'docker rm -f ms-0035-test >/dev/null' EXIT
for _ in $(seq 1 40); do docker exec ms-0035-test pg_isready -U postgres -q && break; sleep 1; done
sleep 2
psql() { docker exec ms-0035-test psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
psql -f /sql/stubs.sql
psql -f /migrations/0035_doctors_sources_badges.sql && psql -f /migrations/0036_facility_badges.sql && echo "migrations applied"
out="$(psql -f /sql/exercise.sql 2>&1)"
echo "$out"
if echo "$out" | grep -qE ' \| f$'; then echo "FAILED: a check returned false"; exit 1; fi
echo "all checks passed: $(echo "$out" | grep -cE ' \| t$') true, $(echo "$out" | grep -c 'NOTICE:  ok') refused"
