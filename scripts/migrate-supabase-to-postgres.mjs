#!/usr/bin/env node
/**
 * Copy the Supabase database into the self-hosted one.
 *
 *   SOURCE_DATABASE_URL=postgres://...supabase...  \
 *   DATABASE_URL=postgres://thesis:...@oci:5432/thesis \
 *   node scripts/migrate-supabase-to-postgres.mjs [--dry-run] [--yes]
 *
 * Safe to run more than once. Every insert is `on conflict do nothing` against
 * the primary key, so an interrupted run is finished by running it again, and a
 * completed run repeated is a no-op that reports the same counts.
 *
 * Reads from Supabase and writes to the target. It never writes to the source,
 * so the live database is untouched and a failed migration costs nothing but
 * the time — the app keeps serving from Supabase until you change the env.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  copyTable,
  resyncSequences,
  rowCounts,
  tableLoadOrder,
} from "./lib/pg-migrate.mjs";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "../apps/web/package.json"));
const pg = require("pg");
const { Client } = pg;

/**
 * Move values as text rather than as parsed JavaScript.
 *
 * Two things break otherwise, and neither shows up in a row count.
 *
 * Timestamps: `pg` parses them into `Date`, which holds milliseconds, while
 * Postgres holds microseconds. Every timestamp is silently rounded on the way
 * through — `…35999+00` arrives as `…359+00`.
 *
 * JSON: `pg` parses `jsonb` into a JavaScript value, and a JSON *array* becomes
 * a JS `Array`. Passed back as a parameter, `pg` serializes a JS array as a
 * Postgres array literal, so `[]` is written as `{}` — an empty JSON object.
 * `log_entries.links` and `experiments.artifacts` are jsonb arrays, and this
 * quietly replaced their contents with the wrong type entirely.
 *
 * Read as text, both round-trip byte for byte; Postgres parses them back on
 * insert.
 */
function preserveValueFidelity(pg) {
  const asText = (value) => value;
  const OIDS = [
    1082, 1114, 1184, 1083, 1266, // date, timestamp, timestamptz, time, timetz
    114, 3802,                     // json, jsonb
  ];
  for (const oid of OIDS) pg.types.setTypeParser(oid, asText);
}

preserveValueFidelity(pg);

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const ASSUME_YES = argv.has("--yes");

const SOURCE_URL = process.env.SOURCE_DATABASE_URL;
const TARGET_URL = process.env.DATABASE_URL;

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

if (!SOURCE_URL) {
  fail(
    "Set SOURCE_DATABASE_URL to the Supabase connection string.\n" +
      "  Supabase dashboard → Project Settings → Database → Connection string → URI.\n" +
      "  Use the session pooler or the direct connection; the transaction pooler\n" +
      "  cannot hold the cursors this needs.",
  );
}
if (!TARGET_URL) fail("Set DATABASE_URL to the self-hosted Postgres you are migrating into.");
if (SOURCE_URL === TARGET_URL) fail("SOURCE_DATABASE_URL and DATABASE_URL are the same database.");

/**
 * Whether to negotiate TLS.
 *
 * Supabase refuses unencrypted connections, so the default for anything
 * reachable over a network is on. A local socket or an explicit
 * `sslmode=disable` turns it off — without that, testing the migration against
 * a Postgres on your own machine fails before it reads a row.
 */
function wantsTls(url) {
  if (/sslmode=disable/.test(url)) return false;
  if (/[?&]host=%2F|[?&]host=\//.test(url)) return false; // unix socket
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

function clientFor(url) {
  return new Client({
    connectionString: url,
    ...(wantsTls(url) ? { ssl: { rejectUnauthorized: false } } : {}),
    // A migration is a long job; a short statement timeout turns a large table
    // into a failure two thirds of the way through.
    statement_timeout: 0,
    query_timeout: 0,
  });
}

async function confirm(question) {
  if (ASSUME_YES || DRY_RUN) return true;
  process.stdout.write(`${question} [y/N] `);
  const answer = await new Promise((resolve) => {
    process.stdin.once("data", (data) => resolve(String(data).trim().toLowerCase()));
  });
  return answer === "y" || answer === "yes";
}

/**
 * Everything that must be true before a single row moves.
 *
 * Checked up front and all at once: discovering the schema was never applied
 * after twenty minutes of copying is a worse way to learn it than a sentence
 * before the run starts.
 */
async function preflight(source, target) {
  const problems = [];

  const { rows: targetTables } = await target.query(
    "select count(*)::int as n from pg_tables where schemaname = 'public'",
  );
  if (targetTables[0].n === 0) {
    problems.push(
      "The target has no tables in `public`. Apply the schema first:\n" +
        "      DATABASE_URL=… ./scripts/apply-migrations-oci.sh",
    );
  }

  const { rows: authSchema } = await target.query(
    "select count(*)::int as n from information_schema.tables where table_schema='auth' and table_name='users'",
  );
  if (authSchema[0].n === 0) {
    problems.push(
      "The target has no `auth.users`. Apply `0000_self_host_prereqs.sql` — see supabase/migrations-self-hosted-postgres/README.md.",
    );
  }

  const { rows: sourceTables } = await source.query(
    "select count(*)::int as n from pg_tables where schemaname = 'public'",
  );
  if (sourceTables[0].n === 0) problems.push("The source has no tables in `public`. Wrong database?");

  // A target that already holds data is not fatal — this is resumable — but it
  // should be said out loud rather than discovered from the counts afterwards.
  const { rows: existing } = await target.query(
    "select coalesce(sum(n_live_tup), 0)::int as n from pg_stat_user_tables where schemaname = 'public'",
  );

  return { problems, targetHasRows: existing[0].n > 0, targetRowEstimate: existing[0].n };
}

/**
 * Copy `auth.users` before anything else.
 *
 * Almost every table has a foreign key to it. Supabase owns the real user
 * records; the self-hosted side keeps a stub with the columns the schema reads,
 * and it has to be populated before a single `papers` row can land.
 */
async function copyAuthUsers(source, target) {
  const { rows } = await source.query(
    "select id, email, raw_user_meta_data, created_at from auth.users",
  );
  if (rows.length === 0) return { copied: 0, read: 0 };

  let copied = 0;
  for (const user of rows) {
    const result = await target.query(
      `insert into auth.users (id, email, raw_user_meta_data, created_at)
       values ($1, $2, coalesce($3, '{}'::jsonb), coalesce($4, now()))
       on conflict (id) do nothing`,
      [user.id, user.email, user.raw_user_meta_data, user.created_at],
    );
    copied += result.rowCount ?? 0;
  }
  return { copied, read: rows.length };
}

async function main() {
  const source = clientFor(SOURCE_URL);
  const target = clientFor(TARGET_URL);

  console.log("→ Connecting …");
  await source.connect();
  await target.connect();

  const { problems, targetHasRows, targetRowEstimate } = await preflight(source, target);
  if (problems.length) {
    console.error("\n✖ Not ready to migrate:\n");
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error("");
    process.exit(1);
  }

  const order = await tableLoadOrder(target);
  console.log(`→ ${order.length} tables, loaded parents-first`);
  if (targetHasRows) {
    console.log(`→ The target already holds roughly ${targetRowEstimate} rows; existing rows are left alone.`);
  }

  if (DRY_RUN) {
    const before = await rowCounts(source, order);
    console.log("\nSource row counts (nothing was written):\n");
    for (const table of order) {
      if (before[table] > 0) console.log(`  ${String(before[table]).padStart(8)}  ${table}`);
    }
    const total = Object.values(before).reduce((sum, n) => sum + n, 0);
    console.log(`\n  ${String(total).padStart(8)}  total\n`);
    await source.end();
    await target.end();
    return;
  }

  if (!(await confirm(`Copy into ${TARGET_URL.replace(/:[^:@/]*@/, ":***@")}?`))) {
    console.log("Cancelled. Nothing was written.");
    process.exit(0);
  }

  console.log("\n→ auth.users");
  const users = await copyAuthUsers(source, target);
  console.log(`  ${users.copied} inserted of ${users.read} read`);

  await target.query("begin");

  // Silence user triggers for the load.
  //
  // Without this the migration is not idempotent, which matters because the
  // whole design invites re-running it: `papers_set_updated_at` and its
  // siblings fire on the UPDATE half of an upsert and stamp `now()` over the
  // timestamp just copied. The first run looks right and the second quietly
  // rewrites every `updated_at` in the database.
  //
  // `replica` also defers foreign keys, which is what lets a self-referencing
  // table — the note tree points at itself — load in any row order.
  let triggersSilenced = false;
  try {
    await target.query("set local session_replication_role = replica");
    triggersSilenced = true;
  } catch {
    // Needs superuser on some managed servers. Deferring constraints still
    // gets the load through; the timestamps are what suffer.
    await target.query("set constraints all deferred");
    console.log("  note: could not disable triggers (needs superuser) — re-running may restamp updated_at");
  }

  const results = [];
  for (const table of order) {
    try {
      const result = await copyTable(source, target, table);
      results.push(result);
      if (result.copied > 0 || result.read > 0) {
        const note = result.dropped?.length ? `  (dropped: ${result.dropped.join(", ")})` : "";
        console.log(`  ${String(result.copied).padStart(8)}  ${table}${note}`);
      }
    } catch (error) {
      await target.query("rollback");
      console.error(`\n✖ Failed on "${table}": ${error.message}`);
      console.error("  Nothing was committed. Fix the cause and run again — this is resumable.\n");
      process.exit(1);
    }
  }

  await target.query("commit");
  if (triggersSilenced) console.log("\n→ triggers were disabled for the load; timestamps are the source's");

  const sequences = await resyncSequences(target);
  console.log(`\n→ ${sequences} sequences resynced`);

  // Compare, rather than assume. A silent shortfall is the failure mode that
  // matters: the app starts, looks fine, and a table is missing half its rows.
  const sourceCounts = await rowCounts(source, order);
  const targetCounts = await rowCounts(target, order);
  const short = order.filter((table) => targetCounts[table] < sourceCounts[table]);

  console.log("\n→ Verification");
  if (short.length === 0) {
    const total = Object.values(targetCounts).reduce((sum, n) => sum + n, 0);
    console.log(`  every table matches or exceeds the source — ${total} rows present\n`);
  } else {
    console.error("  tables with fewer rows than the source:\n");
    for (const table of short) {
      console.error(`    ${table}: source ${sourceCounts[table]}, target ${targetCounts[table]}`);
    }
    console.error("\n  Run again to retry; only the missing rows will be written.\n");
    process.exitCode = 1;
  }

  await source.end();
  await target.end();
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}\n`);
  process.exit(1);
});
