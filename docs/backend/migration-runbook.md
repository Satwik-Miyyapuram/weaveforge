# Cutover runbook — Supabase → self-hosted Postgres

> **Read this once before starting.**
>
> Steps 1–5 build and verify a replica of your data on OCI. They are ready, and
> every one of them is reversible.
>
> **Step 6, the cutover itself, is not ready** — the browser talks to the
> database over PostgREST, so switching the provider to `postgres` breaks the
> client bundle. Step 6 explains the two ways to finish it. Read it before you
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

## Step 0 — Environment

Put this in a file you do not commit (`.env.migration`):

```ini
# Source: read-only, never written to
SOURCE_DATABASE_URL=postgresql://postgres.abcdef:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres

# Target: the OCI Postgres
DATABASE_URL=postgresql://thesis:PASSWORD@129.12.34.56:5432/thesis

# Auth stays on Supabase, so these stay set after cutover
NEXT_PUBLIC_SUPABASE_URL=https://abcdef.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...

# Only if you are also moving images and artifacts
SUPABASE_SERVICE_ROLE_KEY=eyJ...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=thesis-tracker-hot
```

```bash
set -a && source .env.migration && set +a
```

---

## Step 1 — Preflight

```bash
npm run migrate:preflight
```

Checks both databases are reachable, the schema is applied, `auth.users` exists,
and the connecting user can disable triggers. **It will not let you start a
migration that cannot finish.** Fix anything it reports and run it again.

If it says the target has no schema:

```bash
./scripts/apply-migrations-oci.sh
```

Expect **40 tables and 109 policies**.

---

## Step 2 — Dry run

```bash
npm run migrate:data -- --dry-run
```

Prints what is in the source, writes nothing. Sanity-check the counts against
what you expect to own.

---

## Step 3 — Migrate

```bash
npm run migrate:data
```

Safe to interrupt and safe to repeat. Conflicting rows are updated from the
source, and triggers are disabled during the load so timestamps arrive exactly
as they are on Supabase.

---

## Step 4 — Verify

```bash
npm run migrate:verify
```

This is the gate. It checks four things:

1. **Row counts** match, table by table.
2. **Contents** are byte-identical, by hashing each table ordered by primary key.
3. **Ownership** — every row's owner exists, and profiles kept their real role
   rather than the defaults a trigger would have written.
4. **Row-level security** actually isolates: it connects as `authenticated`,
   sets one user's claim, and asserts another user's rows are invisible.

**Do not continue unless it prints `Safe to cut over`.** Point 4 is not
ceremony — Postgres does not apply RLS to a table's owner, so a
misconfiguration here means every user can read every other user's data, and
nothing else in this list would notice.

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

**Stop. This step is not ready, and setting the variable will break the app.**

`NEXT_PUBLIC_BACKEND_PROVIDER=postgres` throws in the browser bundle, by
design — see `wire-postgres-backend.client.ts`:

> Postgres backend is server-only (pg pool). Keep
> `NEXT_PUBLIC_BACKEND_PROVIDER=supabase` for the browser bundle.

The reason is architectural, not a missing flag. Twenty-two repositories run
**in the browser** and reach the database over HTTP through PostgREST — that is
what `this.db.from("papers")` compiles to. A browser cannot open a Postgres
connection, so pointing the provider at `pg` leaves the client with nothing to
talk to.

So after Steps 1–5 you have a **verified replica** of your data on OCI, kept
current by re-running the migration, and an app still served from Supabase.
That is a real and useful position — it is the shadow environment Phase 3 set
out to build — but it is not a cutover.

### What cutover actually requires

Two options. Neither is done.

**Option A — PostgREST in front of OCI Postgres (recommended).**
Supabase's data API *is* PostgREST. Run the same thing on the OCI box, give it
the Supabase JWT secret so it validates the tokens auth already issues, and the
browser keeps speaking the protocol it speaks today.

- Run the `postgrest/postgrest` container against `DATABASE_URL`, with
  `PGRST_JWT_SECRET` set to Supabase's JWT secret and `PGRST_DB_ANON_ROLE=anon`.
- Split the data endpoint from the auth endpoint: `createSupabaseClient` builds
  one client for both today, so this needs a second URL — auth continues to
  point at Supabase, data points at PostgREST.
- The schema already assumes exactly this: RLS policies, the `authenticated`
  role, and `auth.uid()` reading `request.jwt.claim.sub`. `0026_self_host_grants.sql`
  grants that role what it needs.

Roughly a day: mostly configuration, one real code change to separate the two
client URLs.

**Option B — the Phase 5 API layer.**
Move all twenty-two repositories behind Next API routes so the browser talks to
your server and only the server talks to Postgres. More code, more control,
and it removes the PostgREST dependency entirely. Weeks, not days.

Until one of them exists, leave `NEXT_PUBLIC_BACKEND_PROVIDER=supabase`.

### Rolling back

Nothing to roll back yet — you have not cut over. The migration never wrote to
Supabase and never deleted anything, so the replica can be dropped and rebuilt
freely.

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
Stop and roll back. This means the app is not running as `authenticated`.
Check `pg-runner.ts` still issues `SET LOCAL ROLE`, and that `DATABASE_URL`
does not point at a superuser — a superuser bypasses RLS regardless of role.

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
