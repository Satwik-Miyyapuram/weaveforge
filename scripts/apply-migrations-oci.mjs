#!/usr/bin/env node
/**
 * Apply the schema to OCI / self-hosted Postgres.
 *
 *   DATABASE_URL=postgres://... node scripts/apply-migrations-oci.mjs
 *
 * A port of apply-migrations-oci.sh that speaks the wire protocol directly
 * instead of shelling out to `psql`. Same files, same order, same stop-on-first-
 * error behaviour.
 *
 * The reason it exists: `psql` ships in the Postgres *client* tools, which on
 * Windows means the EnterpriseDB installer — an installer that needs admin
 * rights and whose CDN intermittently returns 403. The `pg` driver is already a
 * dependency of the app, so this has nothing to install and runs the same on
 * every platform. The .sh remains for anyone who prefers it.
 *
 * Order matters and used to be wrong. The base migrations reference
 * `auth.users` in a foreign key and `auth.uid()` in an RLS policy from 0001
 * onwards, so the self-hosted prerequisites — roles, the auth/storage/realtime
 * schemas — have to exist before the first of them runs.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

import { loadMigrationEnv } from "./lib/load-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
loadMigrationEnv(root);
const require = createRequire(join(root, "apps/web/package.json"));
const { Client } = require("pg");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: Set DATABASE_URL (postgres://user:pass@host:5432/weaveforge)");
  process.exit(1);
}

const MIGRATIONS = join(root, "supabase/migrations");
const SELF_HOSTED = join(root, "supabase/migrations-self-hosted-postgres");
const PREREQS = join(SELF_HOSTED, "0000_self_host_prereqs.sql");

/** Same rule the preflight uses: TLS everywhere except a local socket or loopback. */
function wantsTls(url) {
  if (/sslmode=disable/.test(url)) return false;
  if (/[?&]host=%2F|[?&]host=\//.test(url)) return false;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

function sqlFilesIn(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * One file, one simple query. Postgres runs a multi-statement simple query in
 * an implicit transaction, so a failure anywhere in a file rolls that file back
 * whole — which is what `ON_ERROR_STOP=1` gets you per invocation of psql.
 *
 * These files carry no `\` meta-commands, so there is nothing psql would have
 * interpreted that the server will not.
 */
async function applyFile(client, path) {
  console.log(`    ${basename(path)}`);
  try {
    await client.query(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`\n✖ ${basename(path)} failed\n`);
    console.error(`  ${error.message}`);
    if (error.position) console.error(`  at character ${error.position}`);
    if (error.hint) console.error(`  hint: ${error.hint}`);
    error.reported = true;
    throw error;
  }
}

async function main() {
  const client = new Client({
    connectionString: DATABASE_URL,
    ...(wantsTls(DATABASE_URL) ? { ssl: { rejectUnauthorized: false } } : {}),
    connectionTimeoutMillis: 15_000,
  });

  await client.connect();

  try {
    // Refuse to replay the base migrations over a database that already holds
    // data, unless asked twice.
    //
    // The DDL is re-runnable. The migrations are not, quite: several also seed
    // or backfill rows, and replaying those duplicates them — organizations
    // gain copies, tag backfills run a second time. Worse, a migration written
    // against the schema of its day can contradict today's rows: 0062 adds a
    // `profiles_role_check` that 0064 later widens, so on a populated database
    // it fails with "check constraint is violated by some row" and leaves the
    // schema half-applied.
    //
    // The failure is quiet in the way that matters — the copy still verifies as
    // byte-identical on the tables that were not touched, so it looks like the
    // migration is fine and only the extras give it away.
    const followUpsOnly = process.argv.includes("--follow-ups-only");

    const { rows: state } = await client.query(
      `select
         (select count(*) from pg_tables where schemaname = 'public') as tables,
         (select coalesce(sum(n_live_tup), 0) from pg_stat_user_tables) as rows`,
    );
    const populated = Number(state[0].tables) > 0 && Number(state[0].rows) > 0;

    // Only the base migrations are unsafe to replay. The follow-ups are all
    // `create or replace` and `grant`, so they are exempt — and they are the
    // reason anyone re-runs this against a live database.
    if (populated && !followUpsOnly && !process.env.ALLOW_REAPPLY_OVER_DATA) {
      console.error(
        `\n✖ This database already has ${state[0].tables} tables and ~${state[0].rows} rows.\n\n` +
          "  Re-running the base migrations over existing data duplicates seeded rows and can\n" +
          "  fail partway on constraints that current data does not satisfy, leaving the schema\n" +
          "  half-applied.\n\n" +
          "  If you only need the self-hosted follow-ups — which is the usual reason to re-run —\n" +
          "  apply those alone:\n\n" +
          "      npm run migrate:schema -- --follow-ups-only\n\n" +
          "  To rebuild from scratch instead, drop and recreate the database, then run this again.\n" +
          "  To override deliberately: ALLOW_REAPPLY_OVER_DATA=1\n",
      );
      process.exitCode = 1;
      return;
    }

    if (followUpsOnly) {
      console.log("==> Self-hosted follow-ups only (base migrations skipped) ...");
    } else {
      console.log("==> Self-hosted prerequisites (roles, auth/storage/realtime stubs) ...");
      await applyFile(client, PREREQS);

      console.log("==> Base migrations (Supabase-compatible schema) ...");
      for (const file of sqlFilesIn(MIGRATIONS)) await applyFile(client, file);
    }

    console.log("==> Self-hosted follow-ups ...");
    for (const file of sqlFilesIn(SELF_HOSTED)) {
      // Already applied above, before anything could depend on it — unless we
      // skipped the base migrations, in which case it has not run at all.
      if (file === PREREQS && !followUpsOnly) continue;
      await applyFile(client, file);
    }

    console.log("==> Verifying ...");
    const { rows } = await client.query(
      `select
         (select count(*) from pg_tables where schemaname = 'public') as tables,
         (select count(*) from pg_policies where schemaname = 'public') as policies`,
    );
    console.log(`    ${rows[0].tables} tables, ${rows[0].policies} policies`);
    console.log("==> Done.");
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  // A failure inside a migration has already been reported against its file.
  // Anything else — most often an unreachable host — has not been reported at
  // all, and "run this again" is useless advice without it.
  if (!error.reported) console.error(`\n✖ ${error.message}\n`);
  console.error(
    "Schema was not fully applied. Fix the error above and run this again —\n" +
      "every migration is written to be safe to re-run.\n",
  );
  process.exitCode = 1;
});
