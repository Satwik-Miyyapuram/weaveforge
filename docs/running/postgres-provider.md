# Postgres backend provider

**Status:** `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` selects the server-side
**blob registry** and nothing else. It is not the self-hosting switch, and it
gives the browser no data layer.

Table data already runs on self-hosted Postgres — through PostgREST, which the
browser repositories speak natively, so the cutover is one address:
`NEXT_PUBLIC_DATA_URL`. See [`oracle-shift-guide.md`](oracle-shift.md).
Supabase remains the identity provider either way.

A second, direct-`pg` set of repositories used to live under
`backend/providers/postgres/repositories/`. It was never imported by anything
that shipped: `wire-backend.ts` reached a stub that threw, because the `pg`
driver cannot run in a browser bundle. It was deleted rather than maintained as
a duplicate of the live path; `git log` has it if the app ever needs to talk to
Postgres without PostgREST in front.

## What is live

| Item | Location |
|------|----------|
| `pg` pool + RLS session (`request.jwt.claim.sub`) | `backend/providers/postgres/pool.ts`, `pg-runner.ts` |
| Blob registry | `storage/providers/postgres/blob-registry.ts` |
| Tiered blob API | `storage/server/blob-api.ts` picks the Postgres registry when backend = postgres |
| Self-host auth stubs | `supabase/migrations-self-hosted-postgres/0025_self_host_auth.sql` |

## Server-side blob registry

Server-only, since it uses the Node `pg` driver:

```ini
NEXT_PUBLIC_BACKEND_PROVIDER=postgres
DATABASE_URL=postgres://user:pass@localhost:5432/thesis
NEXT_PUBLIC_BLOB_PROVIDER=tiered
# Auth and table data still Supabase-shaped:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# R2 for hot tier (see docs/running/storage/r2-setup.md)
```

Apply every file in [`supabase/migrations/`](../../supabase/migrations/), then
[`supabase/migrations-self-hosted-postgres/`](../../supabase/migrations-self-hosted-postgres/).
`0025` creates a minimal `auth.users` stub with **RLS enabled** and **no
policies**; sync user ids from Supabase via service role or direct postgres.
