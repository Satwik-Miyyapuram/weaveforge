# Backend & hosting

Thesis Tracker separates **domain logic** (`@thesis/core`) from **persistence, auth, and blob storage**. The web app selects a backend provider at deploy time — same pattern as [integrations](integrations.md).

Today the default is **Supabase** (managed Postgres + Auth + Storage). For larger orgs or self-hosting, you can target:

- **Postgres + your own auth** (Oracle Cloud free-tier VM, Neon, RDS, …)
- **Cloudflare** (Workers/Pages + Hyperdrive or D1 + R2 + Access)

Repository interfaces in `@thesis/core` are the swap boundary — not PostgREST query builders.

---

## Architecture

```
packages/core/                    apps/web/src/
├── features/*/domain/            ├── backend/            ← Postgres repos, auth
│   IPaperRepository, …           │   config.ts           ← NEXT_PUBLIC_BACKEND_PROVIDER
├── storage/                      │   wire-backend.ts
│   IBlobStore                    ├── storage/            ← blobs (separate layer)
├── backend/                      │   config.ts           ← BLOB_PROVIDER, R2, tiering
│   IAuthService                  │   wire-storage.ts
│   ICurrentUserProvider          │   providers/supabase|s3|tiered/
│   IAdminUserProvisioner         └── integrations/       ← Zotero, GitLab, …
```

**Flow**

1. `readBackendConfig()` + `readStorageConfig()` read env.
2. `wireBackend()` constructs repositories and auth; calls `wireStorage()` for blobs.
3. `bootstrap.ts` wires use-cases + facades.
4. Feature UI calls **facades only** — never Supabase SDK or storage SDK.

### What is already abstracted (~80%)

| Layer | Port | Supabase adapter |
|-------|------|------------------|
| All entities | `IPaperRepository`, `IProjectRepository`, … (16+ in core) | `Supabase*Repository` |
| Auth (browser) | `IAuthService` | `SupabaseAuthService` |
| Session (repos) | `ICurrentUserProvider` | `SupabaseSessionProvider` |
| Admin create-user | `IAdminUserProvisioner` | `SupabaseAdminUserProvisioner` |
| Images | `IBlobStore` → `PaperImageStore` | `wireStorage()` → `SupabaseBlobStore` (see [`storage/`](storage/README.md)) |

### What stays Postgres-specific (for now)

- SQL migrations in `supabase/migrations/` — `auth.uid()`, RLS policies, `SECURITY DEFINER` helpers
- Supabase adapters use PostgREST (`.from().select().eq()`)

A **postgres** provider reuses the same schema and reimplements adapters with `pg` or an HTTP API — no use-case changes.

---

## Configuration

```ini
# Backend provider (default: supabase)
NEXT_PUBLIC_BACKEND_PROVIDER=supabase          # supabase | postgres

# Supabase (when provider = supabase)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...               # server only — /api/admin/create-user

# Postgres (when provider = postgres — future)
DATABASE_URL=postgres://user:pass@host:5432/thesis
```

`NEXT_PUBLIC_BACKEND_PROVIDER=postgres` requires `DATABASE_URL` and is **Phase 2 (in progress)** — see [`docs/backend/postgres-provider.md`](backend/postgres-provider.md). Default remains `supabase`.

---

## Default: Supabase

Best for solo researchers and small labs: free tier, magic-link auth, RLS, zero ops.

1. Create a Supabase project.
2. Apply migrations (`supabase db push` or SQL editor).
3. Set env vars above.
4. Run `npm run dev`.

User-facing setup: [README §3–5](../README.md).

---

## Self-hosted Postgres (Oracle Cloud, VPS, Neon)

**Goal:** Keep the same schema and RLS model; replace Supabase Auth/PostgREST with your stack.

### Steps to add a `postgres` provider

1. **Host Postgres** — apply all files in `supabase/migrations/` (they are plain PostgreSQL; `auth.users` becomes your identity table or you add a `users` table and adjust RLS).

2. **Auth** — implement `IAuthService` + `ICurrentUserProvider`:
   - Issue JWTs with `sub` = user uuid.
   - Set `request.jwt.claim.sub` per connection (or replace `auth.uid()` with `current_setting('app.user_id')` in a migration fork).

3. **Repositories** — copy a `Supabase*Repository` → `Postgres*Repository` using `pg` / Drizzle / Kysely. Same tables, same columns; enforce `project_id` filters in app code if you drop RLS.

4. **Blob store** — implement `IBlobStore` under `apps/web/src/storage/providers/` (S3/R2, tiered). Wired via `wireStorage()`, not `wire-backend.ts` directly.

5. **Admin provisioner** — implement `IAdminUserProvisioner` (create user + `profiles` row).

6. **Wire** — add `case "postgres":` in `wire-backend.ts`; blob adapter in `wire-storage.ts`.

7. **Deploy** — set `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` and `DATABASE_URL`.

### Oracle Cloud free tier (sketch)

| Component | Suggestion |
|-----------|------------|
| Compute | ARM VM (Always Free) — Docker Compose |
| Database | Postgres 16 on VM or Oracle Autonomous (paid) |
| Object storage | OCI Object Storage — `IBlobStore` |
| TLS | Caddy / nginx reverse proxy |
| App | `next build` + `next start` on VM, or container |

Auth: self-hosted [Keycloak](https://www.keycloak.org/), [Authentik](https://goauthentik.io/), or simple JWT + bcrypt — wired through `IAuthService`.

---

## Cloudflare (sketch)

| Component | Suggestion |
|-----------|------------|
| Frontend | **Cloudflare Pages** — deploy Next.js (static + server functions) |
| Database | **Hyperdrive** → external Postgres (Neon, your OCI VM) **or** D1 (requires schema/RLS rework) |
| Blobs | **R2** — implement `IBlobStore` with S3 API |
| Auth | **Cloudflare Access** + service token, or Auth0/Clerk as `IAuthService` |
| API routes | Workers for `/api/admin/create-user` with service binding to Hyperdrive |

**Recommended path on Cloudflare:** Hyperdrive + existing Postgres migrations + new `Postgres*Repository` adapters — avoids rewriting RLS in D1.

**Workers constraint:** browser cannot hold service-role keys; keep privileged ops in Worker routes behind `IAdminUserProvisioner`.

---

## Adding a new backend provider (checklist)

| Step | Action |
|------|--------|
| 1 | Add id to `BackendProviderId` in `backend/config.ts` |
| 2 | Create `backend/providers/<name>/wire-<name>-backend.ts` |
| 3 | Implement `IAuthService`, `ICurrentUserProvider`, `IAdminUserProvisioner` |
| 4 | Implement repository interfaces in `wire-supabase-backend.ts` |
| 5 | Implement blob adapters in `storage/providers/` + `wire-storage.ts` |
| 6 | Add `case` in `wire-backend.ts` |
| 7 | Document env vars in `.env.local.example` |
| 8 | Run contract tests (in-memory + live integration) |

Do **not** abstract PostgREST per-table — one adapter class per repository is the right granularity.

---

## Python SDK

`python/thesis_tracker/container.py` still uses Supabase directly. When the web `postgres` provider lands, mirror the same ports in Python (`IExperimentRepository`, etc.) and add a `DATABASE_URL` code path.

---

## Testing

```bash
npm run build:core
npm test -w @thesis/core
npm test -w @thesis/web
npm run check:solid
```

Live Supabase contract tests: set `THESIS_TRACKER_SUPABASE_URL`, `THESIS_TRACKER_SUPABASE_ANON_KEY`, and either `THESIS_TRACKER_TOKEN` (preferred) or legacy `THESIS_TRACKER_EMAIL` / `THESIS_TRACKER_PASSWORD`.

---

## Related

- [`storage/README.md`](storage/README.md) — blob layer (R2 hot, OCI cold tiering)
- [`plans/completed/migration-plan.md`](plans/completed/migration-plan.md) — phased self-host plan
- [DESIGN.md](DESIGN.md) — SOLID, composition root, repository contracts
- [integrations.md](integrations.md) — third-party services (Zotero, GitLab, …)
- [dev.md](dev.md) — feature modules and facades
