#!/usr/bin/env node
/**
 * Archive settled metric points into chunks (Fix B of the metrics storage plan).
 *
 * Calls `experiment_metrics_rollup()`, which packs whole chunks out of
 * `experiment_metric_points` and leaves a hot tail of recent points as rows.
 * Run it periodically — nothing calls it automatically, because rolling up on
 * the write path would put an array rewrite in front of every ingest.
 *
 *   node scripts/rollup-metric-chunks.mjs
 *   node scripts/rollup-metric-chunks.mjs --chunk 250 --hot-tail 250
 *   node scripts/rollup-metric-chunks.mjs --vacuum
 *
 * `--vacuum` reclaims the pages the archived rows leave behind. Without it the
 * heap keeps its current size and reuses the space for new points, which is
 * fine in steady state but means the on-disk figure will not drop. It takes an
 * ACCESS EXCLUSIVE lock, so it is opt-in rather than automatic.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(path.join(repoRoot, "secrets", ".env.migration"), "utf8");
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (!match) throw new Error("DATABASE_URL not found in secrets/.env.migration");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

const CHUNK = arg("chunk", 250);
const HOT_TAIL = arg("hot-tail", 250);
const VACUUM = process.argv.includes("--vacuum");

const bytes = (n) => `${(n / 1048576).toFixed(1)} MB`;

async function footprint(client) {
  const { rows } = await client.query(
    `select coalesce(pg_total_relation_size(to_regclass('public.experiment_metric_points')), 0)
              + coalesce(pg_total_relation_size(to_regclass('public.experiment_metric_chunks')), 0) as total,
            (select count(*) from experiment_metric_points) as loose,
            coalesce((select sum(cardinality(steps)) from experiment_metric_chunks), 0) as archived`,
  );
  return {
    total: Number(rows[0].total),
    loose: Number(rows[0].loose),
    archived: Number(rows[0].archived),
  };
}

async function main() {
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    const before = await footprint(client);
    console.log(
      `before: ${before.loose.toLocaleString()} loose + ${before.archived.toLocaleString()} archived = ${bytes(before.total)}`,
    );

    const { rows } = await client.query(`select experiment_metrics_rollup($1, $2) as archived`, [
      CHUNK,
      HOT_TAIL,
    ]);
    const archived = Number(rows[0].archived);
    console.log(`archived ${archived.toLocaleString()} points into chunks of ${CHUNK}`);

    if (archived === 0) {
      console.log(
        `nothing to do — a series needs more than ${(CHUNK + HOT_TAIL).toLocaleString()} points ` +
          `before a full chunk can be sealed behind the hot tail.`,
      );
    }

    if (VACUUM && archived > 0) {
      // Cannot run inside a transaction, which is why this lives here and not
      // in the migration.
      console.log("vacuuming experiment_metric_points to release the freed pages…");
      await client.query(`vacuum full experiment_metric_points`);
    }

    const after = await footprint(client);
    console.log(
      `after:  ${after.loose.toLocaleString()} loose + ${after.archived.toLocaleString()} archived = ${bytes(after.total)}`,
    );
    const points = after.loose + after.archived;
    if (points > 0) console.log(`${(after.total / points).toFixed(1)} B/point`);
    if (!VACUUM && archived > 0) {
      console.log("re-run with --vacuum to release the pages the archived rows left behind.");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
