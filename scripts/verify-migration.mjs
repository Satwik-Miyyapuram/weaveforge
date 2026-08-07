#!/usr/bin/env node
/**
 * Check a migrated database against the one it came from.
 *
 *   SOURCE_DATABASE_URL=… DATABASE_URL=… node scripts/verify-migration.mjs
 *
 * Row counts alone do not prove a migration. They pass while a column arrived
 * null, while a trigger overwrote what was copied, and while every row landed
 * under the wrong owner. This compares content, and then checks that row-level
 * security still isolates one user from another — which is the property that
 * turns a data bug into a privacy incident if it broke in transit.
 *
 * Read-only on both sides.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rowCounts, tableLoadOrder } from "./lib/pg-migrate.mjs";

import { loadMigrationEnv } from "./lib/load-env.mjs";

loadMigrationEnv(join(dirname(fileURLToPath(import.meta.url)), ".."));
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

const SOURCE_URL = process.env.SOURCE_DATABASE_URL;
const TARGET_URL = process.env.DATABASE_URL;

if (!SOURCE_URL || !TARGET_URL) {
  console.error("\n✖ Set SOURCE_DATABASE_URL and DATABASE_URL.\n");
  process.exit(1);
}

function wantsTls(url) {
  if (/sslmode=disable/.test(url)) return false;
  if (/[?&]host=%2F|[?&]host=\//.test(url)) return false;
  return !/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
}

const clientFor = (url) =>
  new Client({
    connectionString: url,
    ...(wantsTls(url) ? { ssl: { rejectUnauthorized: false } } : {}),
    statement_timeout: 0,
  });

const failures = [];
const notes = [];

function check(ok, message) {
  if (ok) console.log(`  ✓ ${message}`);
  else {
    console.log(`  ✗ ${message}`);
    failures.push(message);
  }
}

/**
 * A content fingerprint per table.
 *
 * Ordered by primary key and hashed as text, so it is insensitive to physical
 * row order but sensitive to any value that differs. Generated columns are
 * excluded: they are recomputed on the target by definition, and a difference
 * there says nothing about the migration.
 */
async function fingerprint(client, table) {
  const { rows: cols } = await client.query(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name=$1
       and is_generated <> 'ALWAYS'
     order by ordinal_position`,
    [table],
  );
  if (cols.length === 0) return null;

  const { rows: pk } = await client.query(
    `select a.attname from pg_index i
     join pg_class c on c.oid=i.indrelid
     join pg_namespace n on n.oid=c.relnamespace
     join pg_attribute a on a.attrelid=c.oid and a.attnum=any(i.indkey)
     where i.indisprimary and n.nspname='public' and c.relname=$1`,
    [table],
  );
  if (pk.length === 0) return null;

  const list = cols.map((c) => `"${c.column_name}"::text`).join(", ");
  const order = pk.map((p) => `"${p.attname}"`).join(", ");
  const { rows } = await client.query(
    `select md5(string_agg(concat_ws('|', ${list}), E'\\n' order by ${order})) as h
     from "public"."${table}"`,
  );
  return rows[0].h;
}

async function main() {
  const source = clientFor(SOURCE_URL);
  const target = clientFor(TARGET_URL);
  await source.connect();
  await target.connect();

  const tables = await tableLoadOrder(target);

  console.log("\n1. Row counts\n");
  const sourceCounts = await rowCounts(source, tables);
  const targetCounts = await rowCounts(target, tables);
  let mismatched = 0;
  for (const table of tables) {
    if (sourceCounts[table] !== targetCounts[table]) {
      mismatched += 1;
      console.log(`  ✗ ${table}: source ${sourceCounts[table]}, target ${targetCounts[table]}`);
    }
  }
  check(mismatched === 0, `${tables.length} tables have matching row counts`);

  console.log("\n2. Content\n");
  let differing = 0;
  let compared = 0;
  for (const table of tables) {
    if (sourceCounts[table] === 0) continue;
    const [a, b] = await Promise.all([fingerprint(source, table), fingerprint(target, table)]);
    if (a === null || b === null) {
      notes.push(`${table}: no primary key, content not compared`);
      continue;
    }
    compared += 1;
    if (a !== b) {
      differing += 1;
      console.log(`  ✗ ${table}: contents differ`);
    }
  }
  check(differing === 0, `${compared} non-empty tables are byte-identical`);

  console.log("\n3. Users and ownership\n");
  const { rows: users } = await target.query("select count(*)::int as n from auth.users");
  const { rows: srcUsers } = await source.query("select count(*)::int as n from auth.users");
  check(users[0].n === srcUsers[0].n, `auth.users: ${users[0].n} of ${srcUsers[0].n}`);

  const { rows: orphans } = await target.query(
    `select count(*)::int as n from papers p
     left join auth.users u on u.id = p.user_id where u.id is null`,
  );
  check(orphans[0].n === 0, "every paper has an owner that exists");

  const { rows: profiles } = await target.query(
    `select count(*)::int as n from profiles where org_setup_complete is null`,
  );
  check(profiles[0].n === 0, "profiles carry their migrated state, not trigger defaults");

  console.log("\n4. Row-level security\n");
  const { rows: rlsOff } = await target.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
  );
  check(
    rlsOff.length === 0,
    rlsOff.length === 0
      ? "every public table has RLS enabled"
      : `tables without RLS: ${rlsOff.map((r) => r.relname).join(", ")}`,
  );

  // The real test: read as one user and confirm another's rows are invisible.
  // Done in a transaction as a non-superuser role, because a superuser bypasses
  // RLS entirely and would pass this while the policies were wide open.
  //
  // Both probe users must actually *own* papers. Picking arbitrary users — say
  // the two lowest ids — usually finds two who own nothing, and then the
  // isolation assertion passes against an empty set: alice sees zero of bob's
  // rows because there are no rows to see. That is a vacuous pass on the one
  // check standing between users and each other's data, so pick deliberately.
  const { rows: owners } = await target.query(
    `select user_id as id, count(*)::int as n
       from papers
      where user_id is not null
      group by user_id
      having count(*) > 0
      order by count(*) desc
      limit 2`,
  );

  if (owners.length === 2) {
    const [alice, bob] = owners;
    await target.query("begin");
    try {
      await target.query("set local role authenticated");
      await target.query("select set_config('request.jwt.claim.sub', $1, true)", [alice.id]);
      const { rows: mine } = await target.query("select count(*)::int as n from papers");
      const { rows: theirs } = await target.query(
        "select count(*)::int as n from papers where user_id = $1",
        [bob.id],
      );
      check(theirs[0].n === 0, `one user cannot read another user's ${bob.n} papers`);
      check(
        mine[0].n > 0,
        mine[0].n > 0
          ? `the signed-in user still sees their own ${mine[0].n} papers`
          : `the signed-in user sees 0 of their own ${alice.n} papers — auth.uid() is likely returning null, so every policy denies`,
      );
    } catch (error) {
      check(false, `RLS probe failed: ${error.message}`);
    } finally {
      await target.query("rollback");
    }
  } else {
    notes.push(
      "fewer than two users own papers; RLS isolation was not probed — this proves nothing either way",
    );
  }

  console.log("");
  for (const note of notes) console.log(`  · ${note}`);

  if (failures.length) {
    console.error(`\n✖ ${failures.length} check(s) failed. Do not cut over.\n`);
    process.exitCode = 1;
  } else {
    console.log("\n✓ The target matches the source and isolates users. Safe to cut over.\n");
  }

  await source.end();
  await target.end();
}

main().catch((error) => {
  console.error(`\n✖ ${error.message}\n`);
  process.exit(1);
});
