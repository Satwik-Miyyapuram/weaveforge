# Database migrations

WeaveForge has **two migration targets**. Pick the folder that matches where your Postgres runs.

| Folder | Where it runs | How to apply |
|--------|----------------|--------------|
| **[`migrations/`](migrations/)** | **Supabase Cloud** (hosted project) | `supabase db push` or SQL Editor |
| **[`migrations-self-hosted-postgres/`](migrations-self-hosted-postgres/)** | **Your own Postgres** (OCI VM, VPS, Neon, …) | `psql` / migration runner — **never** `supabase db push` |

## New developer (Supabase Cloud — default)

1. Create a [Supabase](https://supabase.com) project.
2. From repo root: `supabase link` then `supabase db push`  
   (applies everything in `migrations/` only).
3. Copy `apps/web/.env.local.example` → `.env.local` with your project URL and anon key.

You can ignore `migrations-self-hosted-postgres/` until Phase 3+ self-hosting.

## Self-hosted Postgres (Phase 3+ cutover)

1. Apply **all** files in `migrations/` to your database (in order).
2. Then apply files in `migrations-self-hosted-postgres/` (auth stubs for Supabase Auth + external DB).
3. Set `DATABASE_URL` and keep Supabase env vars for auth only — see [`docs/backend/postgres-provider.md`](../docs/backend/postgres-provider.md).

## Why two folders?

- `migrations/` must stay at this path for the **Supabase CLI**.
- Self-hosted-only SQL (e.g. stub `auth.users`) must **not** live there — it would show up in `db push` and confuse newcomers or trigger RLS warnings on Cloud.
