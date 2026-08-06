#!/usr/bin/env bash
# Apply Thesis Tracker schema to OCI / self-hosted Postgres.
# Usage: DATABASE_URL=postgres://... ./scripts/apply-migrations-oci.sh
#
# Order matters and used to be wrong. The base migrations reference `auth.users`
# in a foreign key and `auth.uid()` in an RLS policy from 0001 onwards, so the
# self-hosted prerequisites — roles, the auth/storage/realtime schemas — have to
# exist before the first of them runs. Applying them afterwards, as this script
# once did, fails on `0001_papers.sql` line 28 and gets no further.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL (postgres://user:pass@host:5432/thesis)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SELF_HOSTED="$ROOT/supabase/migrations-self-hosted-postgres"

PREREQS="$SELF_HOSTED/0000_self_host_prereqs.sql"

echo "==> Self-hosted prerequisites (roles, auth/storage/realtime stubs) ..."
echo "    $PREREQS"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$PREREQS"

echo "==> Base migrations (Supabase-compatible schema) ..."
for f in "$MIGRATIONS"/*.sql; do
  echo "    $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Self-hosted follow-ups ..."
for f in "$SELF_HOSTED"/*.sql; do
  # Already applied above, before anything could depend on it.
  [[ "$f" == "$PREREQS" ]] && continue
  echo "    $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Verifying ..."
psql "$DATABASE_URL" -tAc \
  "select count(*) || ' tables, ' || (select count(*) from pg_policies where schemaname='public') || ' policies'
   from pg_tables where schemaname='public'"

echo "==> Done."
