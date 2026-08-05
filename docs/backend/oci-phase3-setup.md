# Phase 3 — OCI infrastructure setup

> **Status:** Paused — run this when you are ready to provision Oracle Cloud.  
> **Index:** [`docs/self-host-roadmap.md`](../self-host-roadmap.md) · **Plan:** [`plans/completed/migration-plan.md`](../plans/completed/migration-plan.md)

**Goal:** Stand up an empty **shadow environment** on Oracle Cloud: Postgres 16 + MinIO (cold blobs). Production stays on Supabase until Phase 4–5.

**You need:** OCI account, SSH key, Supabase project (auth only), Cloudflare R2 (hot tier — [r2-setup.md](../storage/r2-setup.md)).

**Time:** ~2–4 hours first time.

---

## What Phase 3 delivers

| Component | Runs on | Used for |
|-----------|---------|----------|
| **Postgres 16** | OCI VM + block volume (~50 GB) | App tables, `blob_objects` registry |
| **MinIO** | Same VM + block volume (~100 GB) | Cold blob tier (`BLOB_COLD_*`) |
| **Supabase Auth** | Supabase Cloud (unchanged) | Login only |
| **Cloudflare R2** | Cloudflare (unchanged) | Hot blob tier |

After Phase 3 you will have:

- A working `DATABASE_URL` pointing at OCI
- Schema applied (all files in `supabase/migrations/` through latest, then `migrations-self-hosted-postgres/0025_self_host_auth.sql`)
- MinIO bucket + credentials for cold tier
- **No user-facing change** — prod app can still use Supabase Postgres until Phase 5

---

## Architecture (one VM)

```
                    ┌─────────────────────────────────────┐
  Vercel (Next.js)  │  OCI Always Free ARM VM             │
        │           │  ┌─────────────┐ ┌──────────────┐  │
        │  :5432    │  │ Postgres 16 │ │ MinIO :9000  │  │
        ├──────────►│  │ /mnt/pgdata │ │ /mnt/minio   │  │
        │  :9000    │  └─────────────┘ └──────────────┘  │
        │           └─────────────────────────────────────┘
        │
        ├──────────► Supabase Auth (HTTPS)
        └──────────► Cloudflare R2 (HTTPS)
```

Pick an OCI **region** close to you and your R2 bucket (`weur` / `enam` in [r2-setup.md](../storage/r2-setup.md)).

---

## Part A — OCI account & networking

### A1. Create a compartment (optional but tidy)

1. OCI Console → **Identity & Security** → **Compartments**
2. **Create compartment** → name: `thesis-tracker`

Use this compartment for all resources below.

### A2. VCN (virtual cloud network)

1. **Networking** → **Virtual cloud networks** → **Start VCN Wizard**
2. **Create VCN with Internet Connectivity**
3. Name: `thesis-vcn`, CIDR e.g. `10.0.0.0/16` → **Next** → **Create**

Note the **public subnet** (e.g. `10.0.0.0/24`).

### A3. Security list (firewall rules)

Open the VCN → **Security Lists** → default → **Add Ingress Rules**:

| Source CIDR | Protocol | Dest port | Purpose |
|-------------|----------|-----------|---------|
| `YOUR_HOME_IP/32` | TCP | 22 | SSH (replace with your IP; [whatismyip.com](https://whatismyip.com)) |
| `0.0.0.0/0` | TCP | 22 | *Only if your IP changes often — less secure* |
| `0.0.0.0/0` | TCP | 5432 | Postgres from Vercel/laptop — **restrict later** |
| `0.0.0.0/0` | TCP | 9000 | MinIO API — **restrict later** |

For production hardening, replace `0.0.0.0/0` on 5432/9000 with:

- Your home IP for admin
- Vercel static IPs (if on Pro plan), **or**
- A [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) so Postgres/MinIO are not public

Phase 3 shadow setup often uses public IP + strong passwords; tighten before Phase 5 cutover.

### A4. SSH key

On your laptop:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/oci_thesis -C "thesis-oci"
```

Upload the **public** key when creating the VM (`.pub` file contents).

---

## Part B — Compute instance (ARM Always Free)

### B1. Create instance

1. **Compute** → **Instances** → **Create instance**
2. **Name:** `thesis-tracker`
3. **Placement:** your compartment, AD with **Ampere** capacity (may take retries in busy regions)
4. **Image:** Ubuntu 22.04 or 24.04 (aarch64)
5. **Shape:** `VM.Standard.A1.Flex` — **2 OCPUs**, **12 GB RAM** (Always Free eligible)
6. **Networking:** select `thesis-vcn`, **Assign public IPv4**
7. **Add SSH keys:** paste your public key
8. **Boot volume:** 50 GB default is OK for OS + Docker; data goes on block volumes
9. **Create**

Wait until state **Running**. Copy the **Public IP** (e.g. `129.12.34.56`).

### B2. SSH in

```bash
ssh -i ~/.ssh/oci_thesis ubuntu@YOUR_PUBLIC_IP
```

Ubuntu images use user `ubuntu`; Oracle Linux uses `opc`.

---

## Part C — Block volumes (Postgres + MinIO data)

Do this in the console while logged in via SSH is optional.

### C1. Create volumes

**Storage** → **Block volumes** → **Create**:

| Name | Size | Compartment |
|------|------|-------------|
| `thesis-pgdata` | 50 GB | thesis-tracker |
| `thesis-minio` | 100 GB | thesis-tracker |

### C2. Attach to instance

For each volume: **Attach instance** → select `thesis-tracker` → **Paravirtualized** → attach.

### C3. Format and mount (on the VM)

```bash
# List block devices — new disks are often /dev/sdb and /dev/sdc
lsblk

# Replace sdX with your devices (ONLY ON EMPTY DISKS)
sudo mkfs.ext4 /dev/sdb
sudo mkfs.ext4 /dev/sdc

sudo mkdir -p /mnt/pgdata /mnt/minio
sudo mount /dev/sdb /mnt/pgdata
sudo mount /dev/sdc /mnt/minio

# Persist across reboots — use UUID from blkid
sudo blkid
echo 'UUID=YOUR-PG-UUID  /mnt/pgdata  ext4  defaults,nofail  0  2' | sudo tee -a /etc/fstab
echo 'UUID=YOUR-MINIO-UUID /mnt/minio ext4  defaults,nofail  0  2' | sudo tee -a /etc/fstab

sudo chown -R ubuntu:ubuntu /mnt/pgdata /mnt/minio
```

---

## Part D — Docker & services

### D1. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
# Log out and back in so docker group applies
exit
```

SSH in again, then:

```bash
docker ps
```

### D2. Use repo `docker-compose` (recommended)

On the VM, clone the repo or copy [`infra/oci/docker-compose.yml`](../../infra/oci/docker-compose.yml) and [`.env.example`](../../infra/oci/.env.example):

```bash
mkdir -p ~/thesis-infra && cd ~/thesis-infra
# Copy docker-compose.yml and .env from the repo (git clone or scp)
cp /path/to/thesis_tracker/infra/oci/docker-compose.yml .
cp /path/to/thesis_tracker/infra/oci/.env.example .env
nano .env   # set POSTGRES_PASSWORD, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD
docker compose up -d
docker compose ps
```

Defaults in compose:

| Service | Host port | Data dir |
|---------|-----------|----------|
| Postgres 16 | 5432 | `/mnt/pgdata` |
| MinIO | 9000 (API), 9001 (console) | `/mnt/minio` |

### D3. Manual Docker (alternative)

If you prefer not to use compose:

```bash
# Postgres
docker run -d --name thesis-postgres --restart unless-stopped \
  -e POSTGRES_USER=thesis \
  -e POSTGRES_PASSWORD='CHOOSE_A_STRONG_PASSWORD' \
  -e POSTGRES_DB=thesis \
  -p 5432:5432 \
  -v /mnt/pgdata:/var/lib/postgresql/data \
  postgres:16

# MinIO
docker run -d --name thesis-minio --restart unless-stopped \
  -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=thesisminio \
  -e MINIO_ROOT_PASSWORD='CHOOSE_A_STRONG_PASSWORD' \
  -v /mnt/minio:/data \
  minio/minio server /data --console-address ":9001"
```

---

## Part E — Build your connection strings

### E1. `DATABASE_URL` (Postgres)

Format:

```text
postgres://USER:PASSWORD@HOST:5432/DATABASE
```

Example with OCI public IP:

```ini
DATABASE_URL=postgres://thesis:CHOOSE_A_STRONG_PASSWORD@129.12.34.56:5432/thesis
```

- **USER / PASSWORD / DATABASE:** from `.env` / Docker env
- **HOST:** VM public IP (or tunnel hostname later)
- URL-encode special characters in password (`@` → `%40`, etc.)

**Test from your laptop:**

```bash
psql "postgres://thesis:PASSWORD@129.12.34.56:5432/thesis" -c "select version();"
```

If this fails: check security list, `iptables` on VM (`sudo iptables -L`), and that Postgres container is running.

### E2. MinIO (cold tier)

1. Open `http://YOUR_PUBLIC_IP:9001` (MinIO console) — login with `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`
2. **Buckets** → **Create bucket** → `thesis-tracker-cold`
3. **Access keys** → create key pair for the app (or use root keys only for shadow testing)

App env (server-only — Vercel or `.env.local`):

```ini
BLOB_COLD_ENDPOINT=http://129.12.34.56:9000
BLOB_COLD_ACCESS_KEY_ID=your_minio_access_key
BLOB_COLD_SECRET_ACCESS_KEY=your_minio_secret_key
BLOB_COLD_BUCKET=thesis-tracker-cold
```

MinIO uses path-style S3; the app sets this automatically when `BLOB_COLD_ENDPOINT` is set ([`s3-blob-store.ts`](../../apps/web/src/storage/providers/s3/s3-blob-store.ts)).

**Test MinIO:**

```bash
# Install mc: https://min.io/docs/minio/linux/reference/minio-mc.html
mc alias set oci http://129.12.34.56:9000 ACCESS_KEY SECRET_KEY
mc ls oci/thesis-tracker-cold
```

---

## Part F — Apply database schema (OCI only)

**Do not** use `supabase db push` for the self-hosted auth stub. On your laptop (with repo cloned):

```bash
export DATABASE_URL="postgres://thesis:PASSWORD@129.12.34.56:5432/thesis"

# From repo root — applies all supabase/migrations, then 0025 auth stub
./scripts/apply-migrations-oci.sh
```

Or manually:

```bash
for f in supabase/migrations/*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations-self-hosted-postgres/0025_self_host_auth.sql
```

Verify:

```bash
psql "$DATABASE_URL" -c "\dt public.*"
psql "$DATABASE_URL" -c "select count(*) from pg_tables where schemaname = 'public';"
```

You should see `papers`, `projects`, `blob_objects`, etc.

See [`supabase/README.md`](../../supabase/README.md) for folder meanings.

---

## Part G — Sync Supabase Auth users (stub `auth.users`)

OCI Postgres has a minimal `auth.users` (migration `0025`). RLS policies reference `auth.uid()` from the JWT `sub` your app sets — but foreign keys still expect rows to exist.

For **shadow testing**, seed your own user:

```sql
-- Run on OCI Postgres — use your Supabase user UUID from Authentication → Users
insert into auth.users (id, email)
values ('YOUR-SUPABASE-USER-UUID', 'you@example.com')
on conflict (id) do nothing;
```

For **Phase 4+**, automate sync (Supabase webhook on sign-up, or periodic job with service role listing users). Details in [`postgres-provider.md`](postgres-provider.md).

---

## Part H — Environment variables (shadow / server)

Phase 3 does **not** require flipping production yet. For testing API routes against OCI on Vercel or locally:

```ini
# --- Backend (server-only DATABASE_URL) ---
DATABASE_URL=postgres://thesis:...@129.12.34.56:5432/thesis
NEXT_PUBLIC_BACKEND_PROVIDER=postgres

# --- Auth (unchanged) ---
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# --- Hot blobs (R2) ---
NEXT_PUBLIC_BLOB_PROVIDER=tiered
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=thesis-tracker-hot

# --- Cold blobs (MinIO on OCI) ---
BLOB_COLD_ENDPOINT=http://129.12.34.56:9000
BLOB_COLD_ACCESS_KEY_ID=...
BLOB_COLD_SECRET_ACCESS_KEY=...
BLOB_COLD_BUCKET=thesis-tracker-cold
```

| Variable | Browser? | Notes |
|----------|----------|-------|
| `DATABASE_URL` | **Never** | Server / Vercel only |
| `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` | Yes | Client still uses Supabase wire until Phase 5 API layer |
| `BLOB_COLD_*` | **Never** | Server only |
| Supabase keys | Anon yes, service role **no** | Same as today |

Copy template: [`apps/web/.env.local.example`](../../apps/web/.env.local.example).

---

## Part I — Vercel → OCI connectivity

Your Next.js server (Vercel) must reach **5432** and **9000** on the VM.

| Approach | Pros | Cons |
|----------|------|------|
| Public IP + security list | Simple | Exposed ports; use strong passwords |
| Cloudflare Tunnel | No open DB ports | Extra setup |
| VPN (Tailscale on VM) | Private | Vercel cannot join Tailscale easily |

**Practical Phase 3 path:** public IP, restrict SSH to your IP, Postgres/MinIO open to `0.0.0.0/0` temporarily with long random passwords, then lock down before Phase 5.

Add the same vars in **Vercel → Project → Settings → Environment Variables** (Production + Preview as needed).

---

## Part J — Phase 3 verification checklist

Run through this before Phase 4 (data migration):

- [ ] `ssh ubuntu@PUBLIC_IP` works
- [ ] `docker compose ps` shows postgres + minio healthy
- [ ] `psql "$DATABASE_URL" -c "select 1"` from laptop
- [ ] All migrations applied (no errors); `blob_objects` table exists
- [ ] `0025` applied; `auth.users` exists; your user row inserted
- [ ] MinIO console login works; bucket `thesis-tracker-cold` created
- [ ] `mc ls` or AWS CLI `aws s3 ls --endpoint-url ...` lists bucket
- [ ] R2 hot tier still works ([r2-setup.md](../storage/r2-setup.md))
- [ ] Supabase Auth login still works in the app (unchanged)
- [ ] **Production still on Supabase Postgres** — no cutover yet

Optional server smoke (when you deploy with `DATABASE_URL` on Vercel):

- Hit `/api/blobs/upload` with tiered config — row appears in OCI `blob_objects` (after Phase 4/5 registry location matches)

---

## Part K — Security hardening (before Phase 5)

1. **TLS:** put Caddy/nginx in front of MinIO; for Postgres use stunnel or connect only via tunnel
2. **Firewall:** drop `0.0.0.0/0` on 5432/9000; allow Vercel egress IPs only if available
3. **Secrets:** rotate Postgres + MinIO passwords; store only in Vercel secrets
4. **Backups:** OCI volume backups or `pg_dump` cron to Object Storage
5. **Updates:** `docker compose pull && docker compose up -d` monthly

---

## What comes next

| Phase | Action |
|-------|--------|
| **4** | Copy data Supabase → OCI Postgres, Supabase Storage → R2 ([migration-plan.md](../plans/completed/migration-plan.md)) |
| **5** | Cutover env vars; ~30 min maintenance |
| **6** | Cron tier job R2 → MinIO ([tiering.md](../storage/tiering.md)) |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Cannot create A1 instance | Try another AD/region; Always Free capacity varies |
| `psql: connection refused` | Security list; container not running; wrong IP |
| `password authentication failed` | Match Docker env user/password |
| Migrations fail on `auth.users` | Expected on Cloud — you are on OCI; run `0025` after base migrations |
| MinIO upload 403 from app | Wrong keys; bucket name; endpoint must include `http://` and port `9000` |
| App still uses Supabase DB | Prod not cut over — expected until Phase 5 |

---

## Quick reference

```ini
DATABASE_URL=postgres://thesis:PASSWORD@OCI_PUBLIC_IP:5432/thesis
BLOB_COLD_ENDPOINT=http://OCI_PUBLIC_IP:9000
BLOB_COLD_BUCKET=thesis-tracker-cold
```

Migrations: `./scripts/apply-migrations-oci.sh`  
Docs: [`postgres-provider.md`](postgres-provider.md), [`migration-plan.md`](../plans/completed/migration-plan.md)
