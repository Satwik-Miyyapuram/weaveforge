# Backend & hosting

WeaveForge separates **domain logic** (`@weaveforge/core`) from **persistence, auth, and blob storage**. The web app selects a backend provider at deploy time — same pattern as [integrations](integrations.md).

Today the default is **Supabase** (managed Postgres + Auth + Storage). For larger orgs or self-hosting, you can target:

- **Postgres + your own auth** (Oracle Cloud free-tier VM, Neon, RDS, …)
- **Cloudflare** (Workers/Pages + Hyperdrive or D1 + R2 + Access)

Repository interfaces in `@weaveforge/core` are the swap boundary — not PostgREST query builders.

---

## Production hostnames

Four names, one job each. Anything that talks to the data API has to be on the
list the API allows, so the split is not cosmetic — a page served from the wrong
host gets a CORS rejection, which the browser reports as `TypeError: Failed to
fetch`, indistinguishable from a dead network.

| Host | Serves | Deployed from |
|---|---|---|
| `app.weaveforge.org` | the web app (and the Android TWA wraps this host) | `apps/web` on Vercel |
| `www.weaveforge.org` | the pitch site and the docs (`/docs/*`) | `apps/pitch` on GitHub Pages (`apps/pitch/public/CNAME`) |
| `docs.weaveforge.org` | legacy docs address — redirects to `www.weaveforge.org/docs/` | DNS only |
| `api.weaveforge.org` | PostgREST data + realtime | the self-hosted box — [oracle-shift-guide](backend/oracle-shift-guide.md) |

`CORS_ALLOWED_ORIGINS` on the API box must list `https://app.weaveforge.org`.
Preview deployments (`*.vercel.app`) are deliberately not on it: they would be
new origins on every deploy. Test previews against a local API, or add the one
preview host you need for as long as you need it.

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
SUPABASE_SERVICE_ROLE_KEY=eyJ...               # server only — account creation, API and MCP tokens
SUPABASE_JWT_SECRET=<jwt secret>               # server only — mints sessions for API and MCP tokens

# Postgres (when provider = postgres — server-side blob registry)
DATABASE_URL=postgres://user:pass@host:5432/thesis
```

Without those two server-only values the app still signs people in, but the
settings panels that issue SDK API tokens and MCP relay tokens answer 503:
the token service has nothing to sign with. The JWT secret is the same one
PostgREST is given in [the shift guide](backend/oracle-shift-guide.md).

`NEXT_PUBLIC_BACKEND_PROVIDER=postgres` requires `DATABASE_URL` and selects the **server-side blob registry** — see [`docs/backend/postgres-provider.md`](backend/postgres-provider.md). Default remains `supabase`.

It is **not** the self-hosting switch, and setting it in a deployed app breaks the browser bundle: the client repositories reach the database over HTTP through PostgREST, which a Postgres connection string cannot replace. To move a deployed app onto your own database, set `NEXT_PUBLIC_DATA_URL` — [`docs/backend/oracle-shift-guide.md`](backend/oracle-shift-guide.md).

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

7. **Deploy** — set `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` and `DATABASE_URL` for **server-side** code. The browser needs a data API of its own; see [`oracle-shift-guide.md`](backend/oracle-shift-guide.md).

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

The SDK does not touch the database, so a backend swap costs it nothing.
`python/weaveforge/container.py` wires everything against the web app's
`/api/sdk/*` endpoints using a single bearer token, which is what keeps Supabase
URLs and keys out of training environments. Whatever the web app runs on behind
those endpoints, the SDK is unchanged.

---

## Testing

```bash
npm run build:core
npm test -w @weaveforge/core
npm test -w @weaveforge/web
npm run check:solid
```

Live Supabase contract tests: set `WEAVEFORGE_SUPABASE_URL`, `WEAVEFORGE_SUPABASE_ANON_KEY`, and either `WEAVEFORGE_TOKEN` (preferred) or legacy `WEAVEFORGE_EMAIL` / `WEAVEFORGE_PASSWORD`.

---

## Related

- [`storage/README.md`](storage/README.md) — blob layer (R2 hot, OCI cold tiering)
- [`plans/completed/migration-plan.md`](plans/completed/migration-plan.md) — phased self-host plan
- [DESIGN.md](DESIGN.md) — SOLID, composition root, repository contracts
- [integrations.md](integrations.md) — third-party services (Zotero, GitLab, …)
- [dev.md](dev.md) — feature modules and facades
