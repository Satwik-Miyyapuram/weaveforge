# Cutover runbook — Supabase → self-hosted Postgres

> **Read this once before starting.** Every step is reversible until the last
> one, and the last one is a single environment variable.

Supabase stays the database until you change `NEXT_PUBLIC_BACKEND_PROVIDER`.
Everything before that is a copy: the migration only ever *reads* from Supabase,
so a failed attempt costs time and nothing else.

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

One variable, in your deployment environment:

```ini
NEXT_PUBLIC_BACKEND_PROVIDER=postgres
```

Keep `DATABASE_URL` set, and keep the Supabase variables — auth still needs
them. Redeploy.

### Rolling back

Set it back to `supabase` and redeploy. Supabase still has every row: the
migration never wrote to it, and never deleted anything. The only thing lost is
whatever was written to the new database while it was live — so if you are
rolling back after real use, migrate that back first with the source and target
swapped.

---

## Verify after cutover

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
