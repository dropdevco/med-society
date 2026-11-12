#!/usr/bin/env bash
# Runs migrations 0042 to 0045 in a throwaway local Postgres 17 (never production) with made-up data.
#   bash supabase/tests/doctors-and-badges/run.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: keep /sql paths inside the container as written
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
here="$(native "$(cd "$(dirname "$0")" && pwd)")"
docker rm -f ms-badges-test >/dev/null 2>&1 || true
docker run -d --name ms-badges-test -e POSTGRES_PASSWORD=localtest -v "$here:/sql:ro" -v "$here/../../migrations:/migrations:ro" postgres:17 >/dev/null
trap 'docker rm -f ms-badges-test >/dev/null' EXIT
for _ in $(seq 1 40); do docker exec ms-badges-test pg_isready -U postgres -q && break; sleep 1; done
sleep 2
psql() { docker exec ms-badges-test psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
psql -f /sql/stubs.sql
psql -f /migrations/0042_doctor_identity.sql && psql -f /migrations/0043_sources_and_badges.sql && psql -f /migrations/0044_facility_badges.sql && echo "migrations applied"
# 0045 comes after the exercise, which needs a logo-free start to test the permission rule.
out="$(psql -f /sql/exercise.sql 2>&1 && psql -f /migrations/0045_organization_logos.sql 2>&1 && psql -f /sql/logos.sql 2>&1)"
echo "$out"
if echo "$out" | grep -qE ' \| f$'; then echo "FAILED: a check returned false"; exit 1; fi
echo "all checks passed: $(echo "$out" | grep -cE ' \| t$') true, $(echo "$out" | grep -c 'NOTICE:  ok') refused"
