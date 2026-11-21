#!/usr/bin/env bash
# Apply WeaveForge schema to OCI / self-hosted Postgres — the psql original.
# Usage: DATABASE_URL=postgres://... ./scripts/apply-migrations-oci.sh [--follow-ups-only]
#
# `npm run migrate:schema` now runs apply-migrations-oci.mjs, which applies the
# same files in the same order through the `pg` driver and so needs no psql on
# PATH — on Windows that means the EnterpriseDB installer, which wants admin
# rights and whose CDN returns 403 often enough to block people. This is kept
# for anyone who prefers it; the two are expected to stay in step.
#
# Order matters and used to be wrong. The base migrations reference `auth.users`
# in a foreign key and `auth.uid()` in an RLS policy from 0001 onwards, so the
# self-hosted prerequisites — roles, the auth/storage/realtime schemas — have to
# exist before the first of them runs. Applying them afterwards, as this script
# once did, fails on `0001_papers.sql` line 28 and gets no further.

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: Set DATABASE_URL (postgres://user:pass@host:5432/weaveforge)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS="$ROOT/db/migrations"
SELF_HOSTED="$ROOT/db/migrations-self-hosted-postgres"

PREREQS="$SELF_HOSTED/0000_self_host_prereqs.sql"

# Same guard as apply-migrations-oci.mjs: replaying the base migrations over
# live data duplicates seeded rows and can fail partway. The follow-ups are all
# `create or replace` and `grant`, so --follow-ups-only is always allowed.
FOLLOW_UPS_ONLY=""
[[ "${1:-}" == "--follow-ups-only" ]] && FOLLOW_UPS_ONLY=1

stats=$(psql "$DATABASE_URL" -tAc \
  "select (select count(*) from pg_tables where schemaname='public')
     || '|' || (select coalesce(sum(n_live_tup),0) from pg_stat_user_tables)")
tables=${stats%%|*}; rows=${stats##*|}
if [[ "$tables" -gt 0 && "$rows" -gt 0 && -z "$FOLLOW_UPS_ONLY" && -z "${ALLOW_REAPPLY_OVER_DATA:-}" ]]; then
  echo "Refusing: this database already has $tables tables and ~$rows rows." >&2
  echo "  Apply the self-hosted follow-ups alone with --follow-ups-only," >&2
  echo "  or override deliberately with ALLOW_REAPPLY_OVER_DATA=1." >&2
  exit 1
fi

# -1: each file in one transaction, so a failure rolls that file back whole.
if [[ -n "$FOLLOW_UPS_ONLY" ]]; then
  echo "==> Self-hosted follow-ups only (base migrations skipped) ..."
else
  echo "==> Self-hosted prerequisites (roles, auth/storage/realtime stubs) ..."
  echo "    $PREREQS"
  psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f "$PREREQS"

  echo "==> Base migrations (Supabase-compatible schema) ..."
  for f in "$MIGRATIONS"/*.sql; do
    echo "    $f"
    psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f "$f"
  done
fi

echo "==> Self-hosted follow-ups ..."
for f in "$SELF_HOSTED"/*.sql; do
  # Already applied above, before anything could depend on it — unless the
  # base migrations were skipped, in which case it has not run at all.
  [[ "$f" == "$PREREQS" && -z "$FOLLOW_UPS_ONLY" ]] && continue
  echo "    $f"
  psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f "$f"
done

echo "==> Verifying ..."
psql "$DATABASE_URL" -tAc \
  "select count(*) || ' tables, ' || (select count(*) from pg_policies where schemaname='public') || ' policies'
   from pg_tables where schemaname='public'"

echo "==> Done."
