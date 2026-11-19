#!/usr/bin/env bash
# Runs 0054_hotels in a throwaway local Postgres 17 (never production) with made-up hotels.
#   bash supabase/tests/hotels/run.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: keep /sql paths inside the container as written
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
here="$(native "$(cd "$(dirname "$0")" && pwd)")"
docker rm -f ms-hotels-test >/dev/null 2>&1 || true
docker run -d --name ms-hotels-test -e POSTGRES_PASSWORD=localtest -v "$here:/sql:ro" -v "$here/../../migrations:/migrations:ro" postgres:17 >/dev/null
trap 'docker rm -f ms-hotels-test >/dev/null' EXIT
for _ in $(seq 1 40); do docker exec ms-hotels-test pg_isready -U postgres -q && break; sleep 1; done
sleep 2
psql() { docker exec ms-hotels-test psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
psql -f /sql/stubs.sql
psql -f /migrations/0054_hotels.sql && psql -f /migrations/0054_hotels.sql && echo "migration applied (twice, to prove it re-runs)"
out="$(psql -f /sql/exercise.sql 2>&1)" || { echo "$out"; echo "FAILED: a script stopped on an error"; exit 1; }
echo "$out"
if echo "$out" | grep -qE ' \| f$'; then echo "FAILED: a check returned false"; exit 1; fi
echo "all checks passed: $(echo "$out" | grep -cE ' \| t$') true, $(echo "$out" | grep -c 'NOTICE:  ok') refused"
