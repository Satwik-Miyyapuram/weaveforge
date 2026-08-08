#!/usr/bin/env node
/**
 * Compare the three `experiment_metrics` storage layouts at realistic scale.
 *
 * The live table holds ~1.6k rows, and at that size ~130 B/row of the heap is
 * page slack that does not scale — so measuring the fixes there would flatter
 * or distort them. This builds each layout as a TEMPORARY table, fills all
 * three with the *same* generated points, and measures. Temp tables live in the
 * session's own schema and vanish when it ends, so nothing touches production
 * data.
 *
 *   node scripts/measure-metrics-layouts.mjs [--points 200000] [--chunk 1000]
 *
 * Layouts:
 *   before  today's schema (migration 0016)
 *   fixA    surrogate key and `created_at` dropped, `metric` → `metric_id`
 *   fixB    fixA's key, values packed into `float8[]` chunks
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

const POINTS = arg("points", 200_000);
const CHUNK = arg("chunk", 1000);
/** Ten names, matching the live table's cardinality. */
const METRICS = ["loss", "accuracy", "train_loss", "val_loss", "learning_rate", "f1", "tb/loss", "tb/accuracy", "tb/train_loss", "tb/val_loss"];
const SERIES = METRICS.length;
const PER_SERIES = Math.floor(POINTS / SERIES);

async function sizes(client, table) {
  const { rows } = await client.query(
    `select pg_table_size($1::regclass) as heap, pg_indexes_size($1::regclass) as idx`,
    [table],
  );
  return { heap: Number(rows[0].heap), idx: Number(rows[0].idx) };
}

async function main() {
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    console.log(`Generating ${(PER_SERIES * SERIES).toLocaleString()} points across ${SERIES} series…\n`);

    // One experiment id and one user id, as a single run would produce.
    await client.query(`create temporary table gen as
      select
        '00000000-0000-0000-0000-000000000001'::uuid as experiment_id,
        '00000000-0000-0000-0000-000000000002'::uuid as user_id,
        m.name::text   as metric,
        m.id::smallint as metric_id,
        s.step::int    as step,
        (random() * 10)::float8 as value,
        (now() - (s.step || ' seconds')::interval)::timestamptz as wall_time
      from unnest($1::text[]) with ordinality as m(name, id)
      cross join generate_series(0, $2::int - 1) as s(step)`, [METRICS, PER_SERIES]);

    // --- before: migration 0016 as it stands -------------------------------
    await client.query(`create temporary table l_before (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      experiment_id uuid not null,
      metric text not null,
      step int not null default 0,
      value double precision not null,
      wall_time timestamptz,
      created_at timestamptz not null default now())`);
    await client.query(`insert into l_before (user_id, experiment_id, metric, step, value, wall_time)
      select user_id, experiment_id, metric, step, value, wall_time from gen`);
    await client.query(`create index l_before_series on l_before (experiment_id, metric, step)`);
    await client.query(`create index l_before_user on l_before (user_id)`);

    // --- fixA: surrogate key + created_at gone, metric_id smallint ---------
    await client.query(`create temporary table l_fixa (
      experiment_id uuid not null,
      metric_id smallint not null,
      step int not null,
      value double precision not null,
      wall_time timestamptz,
      user_id uuid not null,
      primary key (experiment_id, metric_id, step))`);
    await client.query(`insert into l_fixa (experiment_id, metric_id, step, value, wall_time, user_id)
      select experiment_id, metric_id, step, value, wall_time, user_id from gen`);
    await client.query(`create index l_fixa_user on l_fixa (user_id)`);

    // --- fixB: chunked arrays ----------------------------------------------
    await client.query(`create temporary table l_fixb (
      experiment_id uuid not null,
      metric_id smallint not null,
      chunk_no int not null,
      start_step int not null,
      steps int[] not null,
      values double precision[] not null,
      wall_times timestamptz[],
      user_id uuid not null,
      primary key (experiment_id, metric_id, chunk_no))`);
    await client.query(
      `insert into l_fixb (experiment_id, metric_id, chunk_no, start_step, steps, values, wall_times, user_id)
       select experiment_id, metric_id, step / $1 as chunk_no, min(step),
              array_agg(step order by step), array_agg(value order by step),
              array_agg(wall_time order by step), (array_agg(user_id))[1]
         from gen group by experiment_id, metric_id, step / $1`,
      [CHUNK],
    );

    await client.query(`analyze l_before; analyze l_fixa; analyze l_fixb`);

    const total = PER_SERIES * SERIES;
    const rows = [];
    for (const [label, table] of [["before", "l_before"], ["fixA", "l_fixa"], ["fixB", "l_fixb"]]) {
      const { heap, idx } = await sizes(client, table);
      rows.push({ label, heap, idx, total: heap + idx, perPoint: (heap + idx) / total });
    }

    const base = rows[0].perPoint;
    console.log(`${"layout".padEnd(8)} ${"heap".padStart(12)} ${"indexes".padStart(12)} ${"total".padStart(12)} ${"B/point".padStart(10)} ${"factor".padStart(8)}`);
    for (const r of rows) {
      console.log(
        `${r.label.padEnd(8)} ${(r.heap / 1048576).toFixed(1).padStart(9)} MB ${(r.idx / 1048576).toFixed(1).padStart(9)} MB ` +
          `${(r.total / 1048576).toFixed(1).padStart(9)} MB ${r.perPoint.toFixed(1).padStart(10)} ${(base / r.perPoint).toFixed(1).padStart(7)}×`,
      );
    }

    console.log(`\npoints measured: ${total.toLocaleString()}  (chunk size ${CHUNK})`);
    for (const r of rows) {
      const fill = Math.round((50 * 1024 ** 3) / r.perPoint);
      console.log(`${r.label.padEnd(8)} 400k-point run = ${((400_000 * r.perPoint) / 1048576).toFixed(1).padStart(6)} MB   points to fill 50 GB = ${fill.toLocaleString()}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
