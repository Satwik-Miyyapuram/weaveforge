# Postgres backend provider

**Status:** Kept for migration, not on any live path. Table data is served from
self-hosted Postgres on Oracle Cloud, but through PostgREST — see
[`oracle-shift-guide.md`](oracle-shift-guide.md) — not through this adapter.
Supabase remains the identity provider.

What that means concretely, because the distinction matters when reading the
code:

- `wire-postgres-backend.ts` is a complete server-side composition root and is
  **not imported by anything that ships**. `wire-backend.ts` imports the
  browser stub `wire-postgres-backend.client.ts`, which throws if reached — the
  `pg` driver cannot run in a browser bundle, so this is deliberate.
- The one genuinely live piece is the Postgres **blob registry**
  (`storage/providers/postgres/blob-registry.ts`), selected by
  `storage/server/blob-api.ts` when the blob provider is tiered.
- The repositories under `backend/providers/postgres/repositories/` are kept
  because they are the migration path off PostgREST if we ever want the app to
  speak to Postgres directly. They are maintained, typechecked and covered by
  the contract tests; they are not exercised by a running deployment.

## Goal

`NEXT_PUBLIC_BACKEND_PROVIDER=postgres` + `DATABASE_URL` → app tables on self-hosted Postgres; **Supabase Auth unchanged** (Option A).

## Done

| Item | Location |
|------|----------|
| `pg` pool + RLS session (`request.jwt.claim.sub`) | `backend/providers/postgres/pool.ts`, `pg-runner.ts` |
| Self-host auth stubs | `supabase/migrations-self-hosted-postgres/0025_self_host_auth.sql` |
| All Postgres repositories | `backend/providers/postgres/repositories/` |
| Blob registry | `storage/providers/postgres/blob-registry.ts` |
| Full wire (kept, unimported — see Status) | `wire-postgres-backend.ts` (mirrors Supabase composition root) |
| Tiered blob API | `storage/server/blob-api.ts` picks Postgres registry when backend = postgres |

## Local dev (OCI / self-hosted Postgres)

Postgres wiring uses the Node `pg` driver — **server-only** (API routes). The browser bundle must keep `NEXT_PUBLIC_BACKEND_PROVIDER=supabase` until Phase 5 adds a client-facing API layer.

Phase 5 arrived as PostgREST rather than a Next API layer: the browser keeps speaking the protocol it already speaks, and the cutover is `NEXT_PUBLIC_DATA_URL` — [`oracle-shift-guide.md`](oracle-shift-guide.md). `NEXT_PUBLIC_BACKEND_PROVIDER` stays `supabase` in any deployed app.

Server-side only, and only for local dev or a script that wires the provider up by hand:

```ini
NEXT_PUBLIC_BACKEND_PROVIDER=postgres
DATABASE_URL=postgres://user:pass@localhost:5432/thesis
NEXT_PUBLIC_BLOB_PROVIDER=tiered
# Auth still Supabase:
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
# R2 for hot tier (see docs/storage/r2-setup.md)
```

Apply every file in [`supabase/migrations/`](../../supabase/migrations/) on your Postgres (through latest — E2EE needs `0037+`), then [`supabase/migrations-self-hosted-postgres/`](../../supabase/migrations-self-hosted-postgres/). See [`plans/completed/migration-plan.md`](../plans/completed/migration-plan.md).

`0025` creates a minimal `auth.users` stub with **RLS enabled** and **no policies**. Sync user ids from Supabase via service role or direct postgres.

## Testing

Contract tests in `packages/core` against in-memory repos. Add live `DATABASE_URL` integration tests mirroring Supabase integration tests before production cutover.
