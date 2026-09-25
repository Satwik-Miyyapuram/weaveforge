# Database migrations

WeaveForge's data lives in Postgres 16 on the project's OCI server, behind
PostgREST and Realtime (see [`infra/oci/docker-compose.yml`](../infra/oci/docker-compose.yml)).
Supabase is used for sign-in only and stores no WeaveForge data. The folder is
still called `supabase/` because the schema began on a Supabase-hosted database
and kept its conventions (`auth.uid()`, the `anon` / `authenticated` /
`service_role` roles) when it moved.

| Folder | What it is |
|--------|------------|
| **[`migrations-self-hosted-postgres/`](migrations-self-hosted-postgres/)** | Prerequisites a stock Postgres lacks: the `auth` schema helpers, roles and grants, realtime broadcast policies. Applied **first**. |
| **[`migrations/`](migrations/)** | The schema itself, in the order it was built. Applied second, in numeric order. |

## Applying

```bash
for f in supabase/migrations-self-hosted-postgres/*.sql supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
```

The order matters: `0001_papers.sql` already puts a foreign key on `auth.users`
and an RLS policy on `auth.uid()`, so the prerequisites have to exist first.

Then copy `apps/web/.env.local.example` to `.env.local`: `NEXT_PUBLIC_DATA_URL`
and `NEXT_PUBLIC_REALTIME_URL` point at the server, and the `NEXT_PUBLIC_SUPABASE_*`
keys are the sign-in project's. See [`docs/running/backend.md`](../docs/running/backend.md).

## Why two folders?

- `migrations/` is the portable schema; it would run on any Postgres that has the prerequisites.
- The prerequisites stand in for what a Supabase-hosted database used to provide implicitly; keeping them apart keeps the schema readable.
