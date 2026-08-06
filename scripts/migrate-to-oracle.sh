#!/usr/bin/env bash
# One command for the whole migration.
#
#   set -a && source .env.migration && set +a
#   ./scripts/migrate-to-oracle.sh
#
# Runs preflight, applies the schema if it is missing, copies the data, and
# verifies the result. Stops at the first failure with the reason. Safe to run
# again after fixing whatever it named — every stage is idempotent.
#
# Reads from Supabase and never writes to it, so this cannot damage what you
# have today. The app keeps serving from Supabase throughout.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BLUE=$'\033[34m'; GREEN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
step() { printf '\n%s━━ %s%s\n' "$BLUE" "$1" "$OFF"; }
die()  { printf '\n%s✖ %s%s\n\n' "$RED" "$1" "$OFF"; exit 1; }

step "1/4  Preflight"
if ! node scripts/migration-preflight.mjs; then
  # Preflight already printed what is wrong and how to fix it. The one thing it
  # can fix itself is a missing schema, so offer that rather than stopping.
  if [[ "${DATABASE_URL:-}" != "" ]] && \
     ! node -e "
       const {Client}=require('./apps/web/node_modules/pg');
       const c=new Client({connectionString:process.env.DATABASE_URL,
         ssl:/sslmode=require/.test(process.env.DATABASE_URL)?{rejectUnauthorized:false}:undefined});
       c.connect().then(()=>c.query(\"select count(*)::int n from pg_tables where schemaname='public'\"))
        .then(r=>{c.end();process.exit(r.rows[0].n>0?0:1)}).catch(()=>process.exit(2));
     " 2>/dev/null; then
    step "1b/4  Applying the schema"
    ./scripts/apply-migrations-oci.sh || die "Schema failed to apply."
    node scripts/migration-preflight.mjs || die "Still not ready after applying the schema."
  else
    die "Preflight found problems that need you. Fix them and run this again."
  fi
fi

step "2/4  What will move"
node scripts/migrate-supabase-to-postgres.mjs --dry-run || die "Could not read the source."

step "3/4  Copying"
node scripts/migrate-supabase-to-postgres.mjs --yes || die "The copy failed. Nothing was committed; run this again."

step "4/4  Verifying"
if node scripts/verify-migration.mjs; then
  printf '\n%s✓ Done.%s The replica on OCI matches Supabase and isolates users.\n\n' "$GREEN" "$OFF"
  printf '%sNext, if you want to move traffic there too:%s\n' "$DIM" "$OFF"
  printf '%s  docs/backend/migration-runbook.md → Step 6%s\n\n' "$DIM" "$OFF"
else
  die "Verification failed. Do not point anything at this database yet."
fi
