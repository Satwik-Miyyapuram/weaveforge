#!/usr/bin/env node
/**
 * Is everything in place to migrate?
 *
 *   node scripts/migration-preflight.mjs
 *
 * Reads only. Every check that can be made before the first row moves is made
 * here, because the alternative is finding out twenty minutes in — and a
 * half-finished migration is a worse place to be than one that never started.
 *
 * Exits non-zero if anything would stop a migration, so it can gate a script.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "apps/web/package.json"));
const pg = require("pg");
const { Client } = pg;

const problems = [];
const warnings = [];
const ok = [];

function need(name, hint) {
  const value = process.env[name];
  if (value && value.trim()) {
    ok.push(name);
    return value;
  }
  problems.push(`${name} is not set — ${hint}`);
  return null;
}

function optional(name, hint) {
  const value = process.env[name];
  if (value && value.trim()) ok.push(name);
  else warnings.push(`${name} is not set — ${hint}`);
  return value ?? null;
}

console.log("\nMigration preflight\n───────────────────\n");

console.log("1. Environment\n");
const SOURCE_URL = need(
  "SOURCE_DATABASE_URL",
  "the Supabase Postgres URI (Project Settings → Database → Connection string)",
);
const TARGET_URL = need("DATABASE_URL", "the self-hosted Postgres you are migrating into");
need("NEXT_PUBLIC_SUPABASE_URL", "still needed after cutover: auth stays on Supabase");
optional("SUPABASE_SERVICE_ROLE_KEY", "required only to migrate storage objects");
optional("R2_BUCKET", "required only to migrate blobs to the hot tier");
optional("BLOB_COLD_ENDPOINT", "required only to migrate blobs to the cold tier");

if (SOURCE_URL && TARGET_URL && SOURCE_URL === TARGET_URL) {
  problems.push("SOURCE_DATABASE_URL and DATABASE_URL point at the same database");
}

console.log("2. Repository\n");
for (const path of [
  "supabase/migrations-self-hosted-postgres/0000_self_host_prereqs.sql",
  "supabase/migrations-self-hosted-postgres/0026_self_host_grants.sql",
  "scripts/apply-migrations-oci.sh",
  "scripts/migrate-supabase-to-postgres.mjs",
  "scripts/verify-migration.mjs",
]) {
  if (existsSync(join(root, path))) ok.push(path);
  else problems.push(`missing ${path} — is the repo up to date?`);
}
console.log(`  ✓ ${ok.filter((entry) => entry.includes("/")).length} required files present\n`);

function wantsTls(url) {
  if (/sslmode=disable/.test(url)) return false;
  if (/[?&]host=%2F|[?&]host=\//.test(url)) return false;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

async function probe(label, url) {
  const client = new Client({
    connectionString: url,
    ...(wantsTls(url) ? { ssl: { rejectUnauthorized: false } } : {}),
    connectionTimeoutMillis: 15_000,
    statement_timeout: 30_000,
  });
  try {
    await client.connect();
    const { rows: version } = await client.query("show server_version");
    const { rows: tables } = await client.query(
      "select count(*)::int as n from pg_tables where schemaname='public'",
    );
    const { rows: auth } = await client.query(
      "select count(*)::int as n from information_schema.tables where table_schema='auth' and table_name='users'",
    );
    const { rows: superuser } = await client.query(
      "select coalesce(usesuper, false) as s from pg_user where usename = current_user",
    );
    await client.end();
    return {
      reachable: true,
      version: version[0].server_version,
      tables: tables[0].n,
      hasAuth: auth[0].n > 0,
      superuser: superuser[0]?.s ?? false,
    };
  } catch (error) {
    await client.end().catch(() => {});
    return { reachable: false, error: error.message };
  }
}

async function main() {
  console.log("3. Databases\n");

  if (SOURCE_URL) {
    const source = await probe("source", SOURCE_URL);
    if (!source.reachable) {
      problems.push(`cannot reach the source: ${source.error}`);
      console.log(`  ✗ source unreachable`);
    } else {
      console.log(`  ✓ source: Postgres ${source.version}, ${source.tables} tables`);
      if (source.tables === 0) problems.push("the source has no tables in `public` — wrong database?");
    }
  }

  if (TARGET_URL) {
    const target = await probe("target", TARGET_URL);
    if (!target.reachable) {
      problems.push(
        `cannot reach the target: ${target.error}\n` +
          "      Check the OCI security list and the VM firewall allow 5432 from here.",
      );
      console.log(`  ✗ target unreachable`);
    } else {
      console.log(`  ✓ target: Postgres ${target.version}, ${target.tables} tables`);
      if (!target.version.startsWith("16")) {
        warnings.push(`target is Postgres ${target.version}; the schema is verified on 16`);
      }
      if (target.tables === 0) {
        problems.push(
          "the target has no schema. Run:\n" +
            "      DATABASE_URL=… ./scripts/apply-migrations-oci.sh",
        );
      } else if (!target.hasAuth) {
        problems.push("the target has no `auth.users` — 0000_self_host_prereqs.sql was not applied");
      }
      if (!target.superuser) {
        warnings.push(
          "the target user is not a superuser; the migration cannot disable triggers,\n" +
            "      so re-running it would restamp `updated_at`. One clean run is still exact.",
        );
      }
    }
  }

  console.log("");
  if (warnings.length) {
    console.log("Warnings\n");
    for (const warning of warnings) console.log(`  • ${warning}`);
    console.log("");
  }

  if (problems.length) {
    console.error("Blocking\n");
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    console.error("\nFix these, then run this again.\n");
    process.exit(1);
  }

  console.log("Ready. Next:\n");
  console.log("  node scripts/migrate-supabase-to-postgres.mjs --dry-run   # see what would move");
  console.log("  node scripts/migrate-supabase-to-postgres.mjs            # move it");
  console.log("  node scripts/verify-migration.mjs                        # prove it worked\n");
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}\n`);
  process.exit(1);
});
