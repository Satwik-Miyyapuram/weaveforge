# Self-host roadmap — WeaveForge

**Last updated:** Phases 0–2 and **all Phase 4–5 code** complete. Phase 3 is provisioning — the only work left that is not already written.

**The whole shift lives in one document: [`backend/oracle-shift-guide.md`](backend/oracle-shift-guide.md).** Fresh OCI account through to cutover — VM, firewall, containers, schema, data copy, the one variable that flips it, and the troubleshooting. Nothing else to open.

---

## Where you are now

| Phase | Status | What it means for you |
|-------|--------|------------------------|
| 0 Schema | ✅ Done | Supabase migrations applied |
| 1 Storage (R2 hot) | ✅ Done | Optional `NEXT_PUBLIC_BLOB_PROVIDER=tiered` |
| 2 Postgres code | ✅ Done | Code ready; **not** used in prod yet |
| **3 OCI infra** | 🔨 **Your turn** | VM + Postgres + PostgREST + MinIO — [`oracle-shift-guide.md`](backend/oracle-shift-guide.md) Stage 1 |
| 4 Shadow migrate | ✅ Scripted | `npm run migrate` — preflight, schema, copy, verify. Waiting on Phase 3 |
| 5 Cutover | ✅ Scripted | One variable, `NEXT_PUBLIC_DATA_URL` — **not** `NEXT_PUBLIC_BACKEND_PROVIDER` |
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
   Cloud migrations live in [`supabase/migrations/`](../supabase/migrations/). Run `supabase db push` after pulling.
4. **Use the product** — papers, experiments, Python SDK, sharing, E2EE, etc.

Nothing breaks if Phase 3 waits months.

---

## When you are ready for OCI (Phase 3)

Open **[`docs/backend/oracle-shift-guide.md`](backend/oracle-shift-guide.md)** and work down it, top to bottom. Stage 1 is the console clicking; stages 2 and 3 are the data and the cutover.

**Repo assets:**

| File | Purpose |
|------|---------|
| [`infra/oci/docker-compose.yml`](../infra/oci/docker-compose.yml) | Postgres 16 + PostgREST + MinIO on the VM |
| [`infra/oci/.env.example`](../infra/oci/.env.example) | Passwords / paths on VM |
| [`scripts/apply-migrations-oci.mjs`](../scripts/apply-migrations-oci.mjs) | Apply schema to OCI Postgres (`npm run migrate:schema`) |

**You will end up with:**

```ini
DATABASE_URL=postgres://thesis:PASSWORD@OCI_PUBLIC_IP:5432/thesis
BLOB_COLD_ENDPOINT=http://OCI_PUBLIC_IP:9000
BLOB_COLD_BUCKET=weaveforge-cold
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
| 4 Shadow migrate | [`oracle-shift-guide.md`](backend/oracle-shift-guide.md) Stage 2 | `npm run migrate` — preflight, schema, copy, verify. Blobs: `npm run migrate:blobs`. Reads from Supabase, never writes. |
| 5 Cutover | [`oracle-shift-guide.md`](backend/oracle-shift-guide.md) Stage 3 | Vercel env: `NEXT_PUBLIC_DATA_URL` → your PostgREST. Leave `NEXT_PUBLIC_BACKEND_PROVIDER=supabase`; keep Supabase Auth |
| 6 Tiering | [`storage/tiering.md`](storage/tiering.md) | Cron when R2 fills |

---

## Doc map (self-hosting)

| Topic | Path |
|-------|------|
| **This index** | `docs/self-host-roadmap.md` |
| **The shift — everything, one doc** | [`docs/backend/oracle-shift-guide.md`](backend/oracle-shift-guide.md) |
| Phase plan | [`docs/plans/completed/migration-plan.md`](plans/completed/migration-plan.md) |
| Postgres provider | [`docs/backend/postgres-provider.md`](backend/postgres-provider.md) |
| R2 setup | [`docs/storage/r2-setup.md`](storage/r2-setup.md) |
| Migrations layout | [`supabase/README.md`](../supabase/README.md) |
| Backend overview | [`docs/backend.md`](backend.md) |

---

## Suggested “next” for development (while OCI waits)

Pick what matters most to you:

1. **Product / thesis use** — run the app on Supabase; no infra work.
2. ~~**Phase 4 scripts**~~ — done and verified: `npm run migrate:preflight | migrate:schema | migrate:data | migrate:verify | migrate:blobs`, written up in [`oracle-shift-guide.md`](backend/oracle-shift-guide.md) Stage 2. This gets a **verified replica** onto OCI. It does **not** cut over — see below.
3. ~~**Phase 5**~~ — also done. PostgREST is in [`docker-compose.yml`](../infra/oci/docker-compose.yml) and the cutover is one variable, `NEXT_PUBLIC_DATA_URL`. Twenty-two repositories run in the browser and reach the database through PostgREST, which is why `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` throws in the client bundle by design. Detail in the runbook's Step 6.
4. **Python SDK + experiments** — push runs from training code if that is your focus.
5. **Fix build prerender** — static export shows “undefined component” on some pages (pre-existing; compile succeeds).

Tell the agent which lane you want when you come back.

---

## Env cheat sheet (current prod)

```ini
# Required
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Leave as supabase permanently. This is a server-side switch; setting
# `postgres` breaks the browser bundle. The cutover is NEXT_PUBLIC_DATA_URL.
NEXT_PUBLIC_BACKEND_PROVIDER=supabase

# Unset today. At cutover, point this at your own PostgREST and redeploy —
# that is the whole of Phase 5. Removing it again rolls back.
# NEXT_PUBLIC_DATA_URL=https://oci.example.com:3000

# Optional tiered images
NEXT_PUBLIC_BLOB_PROVIDER=tiered
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=weaveforge-hot
```

Do **not** set `DATABASE_URL` until OCI Postgres exists.
