#!/usr/bin/env bash
# Re-runs the phase 2 draft SQL in a throwaway local Postgres 17 (never production):
# stand-ins for the referenced production objects, the migration, 12 checks, the rollback.
#   bash docs/roadmap/phase-2-sql-test/run.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1   # Git Bash: keep /sql paths inside the container as written
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
here="$(native "$(cd "$(dirname "$0")" && pwd)")"
work="$(native "$(mktemp -d)")"
py="$(command -v python3 || command -v python)"
"$py" - "$here/../phase-2-database-proposal.md" "$work" <<'PY'
import re, sys, pathlib
blocks = re.findall(r'```sql\n(.*?)```', pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'), re.S)
pathlib.Path(sys.argv[2], 'migration.sql').write_text(blocks[0], encoding='utf-8')
pathlib.Path(sys.argv[2], 'rollback.sql').write_text(blocks[1], encoding='utf-8')
PY
cp "$here/stubs.sql" "$here/exercise.sql" "$work/"
docker rm -f ms-sqltest >/dev/null 2>&1 || true
docker run -d --name ms-sqltest -e POSTGRES_PASSWORD=localtest -v "$work:/sql:ro" postgres:17 >/dev/null
trap 'docker rm -f ms-sqltest >/dev/null' EXIT
for _ in $(seq 1 40); do docker exec ms-sqltest pg_isready -U postgres -q && break; sleep 1; done
psql() { docker exec ms-sqltest psql -U postgres -v ON_ERROR_STOP=1 -q -X "$@"; }
psql -f /sql/stubs.sql
psql -f /sql/migration.sql && echo "migration applied"
psql -f /sql/exercise.sql
psql -f /sql/rollback.sql && echo "rollback applied"
psql -f /sql/migration.sql && echo "re-applied after rollback"
