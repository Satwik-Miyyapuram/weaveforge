# Cutover runbook — Supabase → self-hosted Postgres

> **Read this once before starting.**
>
> Steps 1–5 build and verify a replica of your data on OCI. They are ready, and
> every one of them is reversible.
>
> **Step 6, the cutover, is a second variable** — `NEXT_PUBLIC_DATA_URL`,
> pointing at a PostgREST you run. Not `NEXT_PUBLIC_BACKEND_PROVIDER`, which is
> server-side only and will break the browser bundle. Read Step 6 before you
> plan the day.

Supabase stays the database throughout. The migration only ever *reads* from
it, so a failed attempt costs time and nothing else, and the app keeps serving
from Supabase the entire time.

**Auth never moves.** Users keep signing in through Supabase Auth. What moves is
the data they own.

---

## What you need

| | |
|---|---|
| OCI Postgres 16 reachable on 5432 | [`oci-phase3-setup.md`](oci-phase3-setup.md) Parts A–E |
| The Supabase connection string | Dashboard → Project Settings → Database → **URI** |
| ~15 minutes | Longer if the library is large |

Use the **session pooler or direct connection**, not the transaction pooler —
the migration holds cursors the transaction pooler will not.

---

## The whole thing

Put this in a file you do not commit (`.env.migration`):

```ini
# Source — read only, never written to.
# Supabase → Project Settings → Database → Connection string → URI.
# Session pooler or direct; NOT the transaction pooler.
SOURCE_DATABASE_URL=postgresql://postgres.abcdef:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres

# Target — the OCI Postgres.
DATABASE_URL=postgresql://thesis:PASSWORD@129.12.34.56:5432/thesis

# Auth stays on Supabase for good; these never go away.
NEXT_PUBLIC_SUPABASE_URL=https://abcdef.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Only for images and artifacts (Step 5).
SUPABASE_SERVICE_ROLE_KEY=eyJ...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=thesis-tracker-hot
```

Then:

```bash
set -a && source .env.migration && set +a
npm run migrate
```

That runs preflight, applies the schema if it is missing, copies the data, and
verifies the result. It stops at the first problem and says what to do about
it, and every stage is safe to repeat — so after fixing whatever it named, run
it again.

Expect, on a clean target: **40 tables, 109 policies**, then a table-by-table
copy, then eight green checks ending in `Safe to cut over`.

### If you would rather go step by step

```bash
npm run migrate:preflight   # is everything in place?
npm run migrate:schema      # apply the schema
npm run migrate:data -- --dry-run
npm run migrate:data
npm run migrate:verify
```

### What the verify step actually checks

1. **Row counts**, table by table.
2. **Contents** — each table hashed, ordered by primary key. Byte-identical or
   it fails.
3. **Ownership** — every row's owner exists, and profiles kept their real role
   rather than the defaults a trigger would have written.
4. **Isolation** — it connects as `authenticated`, sets one user's claim, and
   asserts another user's rows are invisible.

**Do not go further unless it prints `Safe to cut over`.** Point 4 is the one
that matters most: Postgres does not apply RLS to a table's owner, so a
misconfiguration there means every user can read every other user's data, and
nothing else in the list would notice.

---

## Step 5 — Blobs (optional)

Only images and experiment artifacts live in storage. Papers are fetched from
arXiv and cached in the browser, so there is nothing to move for them.

```bash
npm run migrate:blobs -- --dry-run   # what is there
npm run migrate:blobs                # to R2 (hot)
npm run migrate:blobs -- --cold      # to MinIO (cold)
```

Nothing is deleted from Supabase Storage. Leave it until you are sure.

---

## Step 6 — Cut over

Setting `NEXT_PUBLIC_BACKEND_PROVIDER=postgres` **will not work** and is not
what you want. Twenty-two repositories run in the browser and reach the
database over HTTP through PostgREST — that is what `this.db.from("papers")`
compiles to — and a browser cannot open a Postgres connection. The provider
switch is for server-side code only.

The browser's data API is PostgREST, and Supabase's *is* PostgREST. So the
cutover is to run your own, in front of your own Postgres, and point the client
at it. Auth stays with Supabase for good.

`infra/oci/docker-compose.yml` already includes the service.

### On the OCI box

Add to `~/thesis-infra/.env`:

```ini
# Supabase → Project Settings → API → JWT Settings → JWT Secret.
# PostgREST validates the tokens Supabase Auth issues, so it needs the same one.
SUPABASE_JWT_SECRET=...

# Your app's origin. `*` is fine while this is only you.
CORS_ALLOWED_ORIGINS=https://your-app.vercel.app
```

```bash
docker compose up -d postgrest
curl -s http://localhost:3000/papers -H "Authorization: Bearer <a real token>" | head
```

An empty array is success — RLS is applied and that token owns no rows *yet*
on this database. `401` means the JWT secret is wrong. A row you recognise
means it is working.

### In the app

One variable:

```ini
NEXT_PUBLIC_DATA_URL=https://oci.example.com:3000
```

Leave `NEXT_PUBLIC_SUPABASE_URL` and the anon key exactly as they are, and
leave `NEXT_PUBLIC_BACKEND_PROVIDER=supabase`. Redeploy.

Table reads and writes now go to your Postgres; sign-in, sessions, storage and
realtime still go to Supabase. Nothing else in the app changes, because nothing
else knows the difference.

### Rolling back

Remove `NEXT_PUBLIC_DATA_URL` and redeploy. Supabase still holds every row —
the migration never wrote to it and never deleted anything. If you had already
been writing to OCI, migrate those rows back first by swapping
`SOURCE_DATABASE_URL` and `DATABASE_URL` and running `npm run migrate` again.

### Put the box behind TLS before anyone else uses it

A bare `:3000` over the public internet sends session tokens in the clear. Fine
for a shadow environment you are testing alone; not fine once it is real. Put
Caddy or nginx in front with a certificate, and point `NEXT_PUBLIC_DATA_URL` at
`https://`.

---

## Verify after cutover

*(Applies once Step 6 is done.)*

- Sign in. You are signing in through Supabase either way; if this fails the
  problem is auth config, not the migration.
- Open a paper, a note, and the graph.
- **Sign in as a second user and confirm you cannot see the first one's work.**
  Step 4 proves this at the database; this proves it through the app.
- Write something, reload, confirm it persisted.

---

## Troubleshooting

**`permission denied for table …` after cutover**
`0026_self_host_grants.sql` was not applied. Run
`./scripts/apply-migrations-oci.sh` again — it is idempotent.

**Users see each other's data**
Stop and roll back. Either the app is not running as `authenticated` — check
`pg-runner.ts` still issues `SET LOCAL ROLE` — or `DATABASE_URL` points at a
superuser, which bypasses RLS regardless of role. `PGRST_DB_URI` may connect as
the owner; PostgREST switches role per request, which is what makes it safe.

**Every list is empty after pointing at PostgREST, with no error**
`auth.uid()` is returning null, so every policy denies. Re-apply
`0000_self_host_prereqs.sql`: it reads both `request.jwt.claim.sub` (Supabase's
shape) and `request.jwt.claims` (stock PostgREST's). An older copy read only
the first and returned null behind PostgREST.

**`401` from the data API**
`PGRST_JWT_SECRET` does not match the one Supabase signs with. Copy it again
from Project Settings → API → JWT Settings.

**CORS errors in the browser console**
`CORS_ALLOWED_ORIGINS` does not include your app's origin.

**`cannot insert a non-DEFAULT value into column`**
A generated column. The migration excludes them; if you see this, the target
schema is a different version from the source. Re-apply migrations.

**Migration is slow**
It is one round trip per table plus batched inserts. Most of the wait is
latency to Supabase — run it from somewhere near your Supabase region rather
than from home.

**`no pg_hba.conf entry for host`**
The OCI VM is not accepting your IP. Check the security list, the VM firewall,
and `pg_hba.conf` on the instance.
