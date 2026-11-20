#!/usr/bin/env bash
# Runs migration 0057 (directory snapshot) in a throwaway local Postgres 17 (never production) with made-up data.
#   bash supabase/tests/directory-snapshot/run.sh
# Plain Postgres has no pg_cron, so this checks the table, the refresh and the grants;
# the schedule itself is checked in production with: select * from cron.job;
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: keep /sql paths inside the container as written
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
here="$(native "$(cd "$(dirname "$0")" && pwd)")"
docker rm -f ms-snapshot-test >/dev/null 2>&1 || true
docker run -d --name ms-snapshot-test -e POSTGRES_PASSWORD=localtest -v "$here:/sql:ro" -v "$here/../../migrations:/migrations:ro" postgres:17 >/dev/null
trap 'docker rm -f ms-snapshot-test >/dev/null' EXIT
for _ in $(seq 1 40); do docker exec ms-snapshot-test pg_isready -U postgres -q && break; sleep 1; done
sleep 2
out="$(docker exec ms-snapshot-test psql -U postgres -v ON_ERROR_STOP=1 -q -X -f /sql/checks.sql 2>&1)" || { echo "$out"; echo "FAILED: the script stopped on an error"; exit 1; }
echo "$out"
if echo "$out" | grep -qE ' \| f$'; then echo "FAILED: a check returned false"; exit 1; fi
echo "all checks passed: $(echo "$out" | grep -cE ' \| t$') true, $(echo "$out" | grep -c 'NOTICE:  ok') refused"
