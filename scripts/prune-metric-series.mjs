#!/usr/bin/env node
/**
 * Retention pass for Fix C — apply the downsampling rule to metric series that
 * were written before it existed, or by a writer that bypassed the ingest route.
 *
 * The rule lives in `@weaveforge/core` (`downsample-metrics.ts`) and is a pure
 * function of `step`, so this and the ingest route cannot drift: both ask the
 * same predicate the same question, and a series this pass has finished is
 * exactly the series ingest would have produced.
 *
 *   node scripts/prune-metric-series.mjs            # report only, changes nothing
 *   node scripts/prune-metric-series.mjs --apply    # delete the off-grid points
 *
 * Dry by default because it deletes measurements. Run it, read the report, then
 * run it again with --apply.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

import { KEEP_ALL_BELOW_STEP, stepsToPrune } from "../packages/core/dist/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(path.join(repoRoot, "secrets", ".env.migration"), "utf8");
  const match = /^DATABASE_URL=(.*)$/m.exec(text);
  if (!match) throw new Error("DATABASE_URL not found in secrets/.env.migration");
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const apply = process.argv.includes("--apply");

async function main() {
  const client = new pg.Client({ connectionString: loadDatabaseUrl() });
  await client.connect();
  try {
    const { rows: series } = await client.query(
      `select experiment_id, metric_id, count(*)::int as n, max(step)::int as max_step
         from experiment_metric_points
        group by experiment_id, metric_id
        having max(step) >= $1
        order by n desc`,
      [KEEP_ALL_BELOW_STEP],
    );

    if (series.length === 0) {
      console.log(
        `No series reaches step ${KEEP_ALL_BELOW_STEP.toLocaleString()} — nothing is over budget.`,
      );
      return;
    }

    let totalPruned = 0;
    for (const s of series) {
      const { rows: stepRows } = await client.query(
        `select step from experiment_metric_points
          where experiment_id = $1 and metric_id = $2`,
        [s.experiment_id, s.metric_id],
      );
      const prune = stepsToPrune(stepRows.map((r) => r.step));
      if (prune.length === 0) continue;

      console.log(
        `${s.experiment_id} metric_id=${s.metric_id}: ${s.n} points → ${s.n - prune.length} ` +
          `(dropping ${prune.length}, max step ${s.max_step})`,
      );
      totalPruned += prune.length;

      if (apply) {
        // Chunked so a very long series does not build one enormous parameter
        // array; the predicate is the same either way.
        for (let i = 0; i < prune.length; i += 5_000) {
          await client.query(
            `delete from experiment_metric_points
              where experiment_id = $1 and metric_id = $2 and step = any($3::int[])`,
            [s.experiment_id, s.metric_id, prune.slice(i, i + 5_000)],
          );
        }
      }
    }

    console.log(
      `\n${apply ? "Deleted" : "Would delete"} ${totalPruned.toLocaleString()} points ` +
        `across ${series.length} series over budget.`,
    );
    if (!apply && totalPruned > 0) console.log("Re-run with --apply to make the change.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
