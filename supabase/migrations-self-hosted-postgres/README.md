# Self-hosted Postgres migrations

SQL here runs only on **your own Postgres** (Oracle Cloud, VPS, Docker, etc.) — **not** on Supabase Cloud.

**Do not** run `supabase db push` for this folder. **Do not** paste these into the Supabase SQL Editor unless you are intentionally provisioning a separate database.

## Apply order

1. Apply every file in [`../migrations/`](../migrations/) on the self-hosted database first (`0001` … latest).
2. Then apply files in **this folder** (currently auth stubs for [Option A](../../docs/plans/completed/migration-plan.md): Supabase Auth + external Postgres).

```bash
# Example — set DATABASE_URL to your OCI/VPS Postgres
for f in ../migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
for f in ./*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

## What lives here?

Extra schema that **must not** exist on Supabase Cloud — e.g. a minimal `auth.users` stub and `auth.uid()` reading the JWT `sub` your app sets per connection (see `apps/web/src/backend/providers/postgres/pg-runner.ts`).

See [`docs/backend/postgres-provider.md`](../../docs/backend/postgres-provider.md).
