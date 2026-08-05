# Self-host roadmap — Thesis Tracker

**Last updated:** Phase 2 complete, Phase 3 **paused** (OCI not provisioned yet).

Use this file as the index when you return to self-hosting. Full OCI click-by-click steps live in **[`backend/oci-phase3-setup.md`](backend/oci-phase3-setup.md)** — do not lose that file; it is the complete Phase 3 runbook.

---

## Where you are now

| Phase | Status | What it means for you |
|-------|--------|------------------------|
| 0 Schema | ✅ Done | Supabase migrations applied |
| 1 Storage (R2 hot) | ✅ Done | Optional `NEXT_PUBLIC_BLOB_PROVIDER=tiered` |
| 2 Postgres code | ✅ Done | Code ready; **not** used in prod yet |
| **3 OCI infra** | ⏸ **Paused** | VM + Postgres + MinIO — see [`oci-phase3-setup.md`](backend/oci-phase3-setup.md) |
| 4 Shadow migrate | ⏳ Not started | Copy Supabase → OCI (scripts TBD) |
| 5 Cutover | ⏳ Not started | Flip env vars (~30 min window) |
| 6 Auto tiering | ⏳ Not started | R2 → MinIO cron |
| 7 Vault markdown | ✅ Shipped | Encrypted vault pages under Library → Notes |

**Today:** Keep running on **Supabase Cloud** (Postgres + Auth). That is the supported path.

---

## What to do now (no OCI required)

1. **Use the app on Supabase** — default; no `DATABASE_URL` needed.
2. **Optional tiered images** — if you want R2 for paper images, follow [`storage/r2-setup.md`](storage/r2-setup.md).
3. **Keep migrations current** on Supabase:
   ```bash
   supabase link
   supabase db push
   ```
   Cloud migrations live in [`supabase/migrations/`](../supabase/migrations/) (through `0088` at time of writing). Run `supabase db push` after pulling.
4. **Use the product** — papers, experiments, Python SDK, sharing, E2EE, etc.

Nothing breaks if Phase 3 waits months.

---

## When you are ready for OCI (Phase 3)

Open **[`docs/backend/oci-phase3-setup.md`](backend/oci-phase3-setup.md)** and follow Parts A–J.

**Repo assets:**

| File | Purpose |
|------|---------|
| [`infra/oci/docker-compose.yml`](../infra/oci/docker-compose.yml) | Postgres 16 + MinIO on the VM |
| [`infra/oci/.env.example`](../infra/oci/.env.example) | Passwords / paths on VM |
| [`scripts/apply-migrations-oci.sh`](../scripts/apply-migrations-oci.sh) | Apply schema to OCI Postgres |

**You will end up with:**

```ini
DATABASE_URL=postgres://thesis:PASSWORD@OCI_PUBLIC_IP:5432/thesis
BLOB_COLD_ENDPOINT=http://OCI_PUBLIC_IP:9000
BLOB_COLD_BUCKET=thesis-tracker-cold
# Plus existing Supabase auth + R2 vars
```

**External links:**

- [OCI Console](https://cloud.oracle.com/)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [Cloudflare R2](https://dash.cloudflare.com/?to=/:account/r2/overview)

---

## After Phase 3 (later)

| Phase | Doc | Work |
|-------|-----|------|
| 4 Shadow migrate | [`plans/completed/migration-plan.md`](plans/completed/migration-plan.md) | Export Supabase data → OCI; blobs → R2. Scripts `migrate:supabase-to-postgres` etc. **not in repo yet** — build or run manually when needed. |
| 5 Cutover | [`plans/completed/migration-plan.md`](plans/completed/migration-plan.md) | Vercel env: `DATABASE_URL`, `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` (server), keep Supabase Auth |
| 6 Tiering | [`storage/tiering.md`](storage/tiering.md) | Cron when R2 fills |

---

## Doc map (self-hosting)

| Topic | Path |
|-------|------|
| **This index** | `docs/self-host-roadmap.md` |
| **OCI Phase 3 (full)** | [`docs/backend/oci-phase3-setup.md`](backend/oci-phase3-setup.md) |
| Phase plan | [`docs/plans/completed/migration-plan.md`](plans/completed/migration-plan.md) |
| Postgres provider | [`docs/backend/postgres-provider.md`](backend/postgres-provider.md) |
| R2 setup | [`docs/storage/r2-setup.md`](storage/r2-setup.md) |
| Migrations layout | [`supabase/README.md`](../supabase/README.md) |
| Backend overview | [`docs/backend.md`](backend.md) |

---

## Suggested “next” for development (while OCI waits)

Pick what matters most to you:

1. **Product / thesis use** — run the app on Supabase; no infra work.
2. **Phase 4 scripts** — implement `migrate:supabase-to-postgres` and blob export (so cutover is one command after OCI exists).
3. **Client + Postgres gap** — browser still uses Supabase wire until Phase 5 API layer; optional future work.
4. **Python SDK + experiments** — push runs from training code if that is your focus.
5. **Fix build prerender** — static export shows “undefined component” on some pages (pre-existing; compile succeeds).

Tell the agent which lane you want when you come back.

---

## Env cheat sheet (current prod)

```ini
# Required
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Default — leave as supabase until Phase 5
NEXT_PUBLIC_BACKEND_PROVIDER=supabase

# Optional tiered images
NEXT_PUBLIC_BLOB_PROVIDER=tiered
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=thesis-tracker-hot
```

Do **not** set `DATABASE_URL` until OCI Postgres exists.
