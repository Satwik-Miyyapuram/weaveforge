#!/usr/bin/env node
/**
 * One command for the whole migration.
 *
 *   npm run migrate
 *
 * Runs preflight, applies the schema if it is missing, copies the data, and
 * verifies the result. Stops at the first failure with the reason. Safe to run
 * again after fixing whatever it named — every stage is idempotent.
 *
 * Reads from Supabase and never writes to it, so this cannot damage what you
 * have today. The app keeps serving from Supabase throughout.
 *
 * A port of migrate-to-oracle.sh. Two things it does that the shell cannot:
 * it runs on Windows, where `npm run` hands the script to cmd.exe and `./x.sh`
 * is a syntax error; and it loads `.env.migration` itself, so there is no
 * `set -a && source …` step to remember or to get wrong.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { loadMigrationEnv } from "./lib/load-env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const OFF = "\x1b[0m";

const step = (label) => console.log(`\n${BLUE}━━ ${label}${OFF}`);

function die(message) {
  console.error(`\n${RED}✖ ${message}${OFF}\n`);
  process.exit(1);
}

function run(script, args = []) {
  const result = spawnSync(process.execPath, [join(root, "scripts", script), ...args], {
    stdio: "inherit",
    cwd: root,
  });
  return result.status === 0;
}

/**
 * Three answers, not two: "empty" is the only one worth acting on. Applying a
 * schema is pointless without a target address, and hopeless when the target
 * cannot be reached — in both cases preflight has already said something more
 * useful than a second failure would.
 *
 * @returns {Promise<"empty" | "populated" | "unusable">}
 */
async function targetSchemaState() {
  if (!process.env.DATABASE_URL) return "unusable";
  const { Client } = createRequire(join(root, "apps/web/package.json"))("pg");
  const url = process.env.DATABASE_URL;
  const client = new Client({
    connectionString: url,
    ...(/sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url)
      ? {}
      : { ssl: { rejectUnauthorized: false } }),
    connectionTimeoutMillis: 15_000,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      "select count(*)::int as n from pg_tables where schemaname = 'public'",
    );
    return rows[0].n > 0 ? "populated" : "empty";
  } catch {
    return "unusable";
  } finally {
    await client.end().catch(() => {});
  }
}

if (loadMigrationEnv(root)) console.log(`${DIM}Loaded .env.migration${OFF}`);

step("1/4  Preflight");
if (!run("migration-preflight.mjs")) {
  // Preflight already printed what is wrong and how to fix it. The one thing it
  // can fix itself is a missing schema, so offer that rather than stopping.
  if ((await targetSchemaState()) !== "empty") {
    die("Preflight found problems that need you. Fix them and run this again.");
  }
  step("1b/4  Applying the schema");
  if (!run("apply-migrations-oci.mjs")) die("Schema failed to apply.");
  if (!run("migration-preflight.mjs")) die("Still not ready after applying the schema.");
}

step("2/4  What will move");
if (!run("migrate-supabase-to-postgres.mjs", ["--dry-run"])) die("Could not read the source.");

step("3/4  Copying");
if (!run("migrate-supabase-to-postgres.mjs", ["--yes"])) {
  die("The copy failed. Nothing was committed; run this again.");
}

step("4/4  Verifying");
if (!run("verify-migration.mjs")) {
  die("Verification failed. Do not point anything at this database yet.");
}

console.log(`\n${GREEN}✓ Done.${OFF} The replica on OCI matches Supabase and isolates users.\n`);
console.log(`${DIM}Next, if you want to move traffic there too:${OFF}`);
console.log(`${DIM}  docs/running/oracle-shift.md → Stage 3${OFF}\n`);
