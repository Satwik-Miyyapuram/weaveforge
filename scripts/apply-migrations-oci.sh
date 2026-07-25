#!/usr/bin/env bash
# Apply Thesis Tracker schema to OCI / self-hosted Postgres.
# Usage: DATABASE_URL=postgres://... ./scripts/apply-migrations-oci.sh

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL (postgres://user:pass@host:5432/thesis)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/supabase/migrations"
SELF_HOSTED="$ROOT/supabase/migrations-self-hosted-postgres"

echo "==> Base migrations (Supabase-compatible schema) ..."
for f in "$MIGRATIONS"/*.sql; do
  echo "    $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Self-hosted auth stub (0025) ..."
for f in "$SELF_HOSTED"/*.sql; do
  echo "    $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Done. Verify with: psql \"\$DATABASE_URL\" -c '\\dt public.*'"
