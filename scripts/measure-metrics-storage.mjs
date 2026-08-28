#!/usr/bin/env node
/**
 * Measure `experiment_metrics` storage on the live database.
 *
 * Reports actual bytes per row — heap, indexes, and the tuple payload — rather
 * than projections, so the storage plan's claims can be checked against reality
 * before and after each fix. Read-only.
 *
 * Usage (through the SSH tunnel — see docs/running/oracle-shift.md):
 *   node scripts/measure-metrics-storage.mjs
 *   node scripts/measure-metrics-storage.mjs --json
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(repoRoot, "secrets", ".env.migration");
  const text = readFileSync(envPath, "utf8");
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (!match) throw new Error(`DATABASE_URL not found in ${envPath}`);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * Every relation the metrics actually live in, across all three layouts.
 *
 * `experiment_metrics` is only a table before 0114; after it, it is the
 * compatibility view and occupies no storage of its own — measuring it would
 * report a reassuring zero while the real bytes sat in `experiment_metric_points`.
 */
const TABLES = [
  "experiment_metrics",
  "experiment_metric_points",
  "experiment_metric_names",
  "experiment_metric_chunks",
];

/** Base tables only — a view has no storage and `pg_table_size` on one is 0. */
async function tableExists(client, table) {
  const { rows } = await client.query(
    `select c.relkind from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = $1`,
    [table],
  );
  return rows.length > 0 && ["r", "p", "m"].includes(rows[0].relkind);
}

async function measureTable(client, table) {
  const { rows: countRows } = await client.query(`select count(*)::bigint as n from ${table}`);
  const rowCount = Number(countRows[0].n);

  const { rows: sizeRows } = await client.query(
    `select pg_table_size($1::regclass)   as heap_bytes,
            pg_indexes_size($1::regclass) as index_bytes,
            pg_total_relation_size($1::regclass) as total_bytes`,
    [table],
  );
  const heap = Number(sizeRows[0].heap_bytes);
  const index = Number(sizeRows[0].index_bytes);
  const total = Number(sizeRows[0].total_bytes);

  const { rows: idxRows } = await client.query(
    `select indexrelname as name, pg_relation_size(indexrelid) as bytes
       from pg_stat_user_indexes where relname = $1 order by 2 desc`,
    [table],
  );

  // Live payload width: what the columns actually occupy, before page overhead.
  const { rows: widthRows } = await client.query(
    `select coalesce(avg(pg_column_size(t.*)), 0)::numeric(10,2) as avg_tuple_bytes
       from ${table} t`,
  );

  const per = (bytes) => (rowCount ? bytes / rowCount : 0);
  return {
    table,
    rowCount,
    totalBytes: total,
    perRow: {
      tuplePayload: Number(widthRows[0].avg_tuple_bytes),
      heap: per(heap),
      indexes: per(index),
      total: per(total),
    },
    indexes: idxRows.map((r) => ({ name: r.name, bytes: Number(r.bytes), perRow: per(Number(r.bytes)) })),
  };
}

/**
 * Points, not rows — the chunked layout stores many points per row, so bytes
 * per *row* stops being the comparable number once Fix B lands.
 */
async function countPoints(client) {
  let points = 0;
  // The row-per-point store, whichever name it currently has.
  for (const t of ["experiment_metric_points", "experiment_metrics"]) {
    if (!(await tableExists(client, t))) continue;
    const { rows } = await client.query(`select count(*)::bigint as n from ${t}`);
    points += Number(rows[0].n);
    break;
  }
  if (await tableExists(client, "experiment_metric_chunks")) {
    const { rows } = await client.query(
      `select coalesce(sum(cardinality(values)), 0)::bigint as n from experiment_metric_chunks`,
    );
    points += Number(rows[0].n);
  }
  return points;
}

async function main() {
  const json = process.argv.includes("--json");
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    const measured = [];
    for (const table of TABLES) {
      if (await tableExists(client, table)) measured.push(await measureTable(client, table));
    }
    const totalPoints = await countPoints(client);
    const totalBytes = measured.reduce((sum, m) => sum + m.totalBytes, 0);
    const bytesPerPoint = totalPoints ? totalBytes / totalPoints : 0;

    if (json) {
      console.log(JSON.stringify({ measured, totalPoints, totalBytes, bytesPerPoint }, null, 2));
      return;
    }

    for (const m of measured) {
      console.log(`\n${m.table} — ${m.rowCount.toLocaleString()} rows, ${(m.totalBytes / 1024).toFixed(0)} kB total`);
      console.log(`  tuple payload   ${m.perRow.tuplePayload.toFixed(1).padStart(8)} B/row`);
      console.log(`  heap            ${m.perRow.heap.toFixed(1).padStart(8)} B/row`);
      console.log(`  indexes         ${m.perRow.indexes.toFixed(1).padStart(8)} B/row`);
      console.log(`  TOTAL           ${m.perRow.total.toFixed(1).padStart(8)} B/row`);
      for (const idx of m.indexes) {
        console.log(`    ${idx.name.padEnd(42)} ${(idx.bytes / 1024).toFixed(0).padStart(6)} kB  ${idx.perRow.toFixed(1).padStart(6)} B/row`);
      }
    }

    console.log(`\n=== headline ===`);
    console.log(`points stored     ${totalPoints.toLocaleString()}`);
    console.log(`bytes on disk     ${totalBytes.toLocaleString()}`);
    console.log(`BYTES PER POINT   ${bytesPerPoint.toFixed(1)}`);
    // The whole reason the plan exists: this table decides when pgdata fills.
    const perPoint = bytesPerPoint || 1;
    console.log(`points to fill 50 GB: ${Math.round((50 * 1024 ** 3) / perPoint).toLocaleString()}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
