# Self-hosted Postgres migrations

SQL here runs only on **your own Postgres** (Oracle Cloud, VPS, Docker, etc.) — **not** on Supabase Cloud.

**Do not** run `supabase db push` for this folder. **Do not** paste these into the Supabase SQL Editor unless you are intentionally provisioning a separate database.

## Apply order

`0000_self_host_prereqs.sql` comes **first**, before any base migration. A stock
Postgres has no `auth`, `storage` or `realtime` schema and none of the `anon` /
`authenticated` / `service_role` roles — Supabase provides them implicitly, and
the base migrations use them from `0001_papers.sql`, which puts a foreign key on
`auth.users` and an RLS policy on `auth.uid()`. Applying this folder afterwards,
as these instructions once said, fails on the first file.

1. `0000_self_host_prereqs.sql` — roles and schema stubs.
2. Every file in [`../migrations/`](../migrations/), `0001` … latest.
3. Everything else in this folder.

Use [`scripts/apply-migrations-oci.sh`](../../scripts/apply-migrations-oci.sh),
which does exactly that and verifies the result. Manually:

```bash
# Example — set DATABASE_URL to your OCI/VPS Postgres
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ./0000_self_host_prereqs.sql
for f in ../migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
for f in ./*.sql; do
  [ "$f" = "./0000_self_host_prereqs.sql" ] && continue
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

A clean run against Postgres 16 gives **40 tables and 109 policies** in `public`.

## What lives here?

Extra schema that **must not** exist on Supabase Cloud — e.g. a minimal `auth.users` stub and `auth.uid()` reading the JWT `sub` your app sets per connection (see `apps/web/src/backend/providers/postgres/pg-runner.ts`).

See [`docs/backend/postgres-provider.md`](../../docs/backend/postgres-provider.md).
