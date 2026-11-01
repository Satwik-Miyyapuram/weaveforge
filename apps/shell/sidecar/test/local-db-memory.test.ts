/**
 * Memory budget for the local database, the largest part of the main process.
 *
 * Measured in a fresh process so other tests do not count. RSS differs by
 * platform: with the app's engine params it settles at ~325 MB on Windows
 * (~420 MB with Postgres' default 128 MB cache) and ~436 MB on the Linux CI
 * runner. Each budget sits ~40 MB above its measurement.
 *
 * One sample was flaky on Linux CI (378-485 MB for the same code): allocator
 * and page-cache noise only ever adds RSS. So the probe runs three times and
 * the lowest run is judged; a real regression raises all three.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const BUDGET_MB = process.platform === "linux" ? 480 : 375;

test(`the local database opens within ${BUDGET_MB} MB RSS`, () => {
  const probe = path.join(__dirname, "fixtures", "local-db-rss-probe.ts");
  const runs = [1, 2, 3].map(() => {
    const out = execFileSync(process.execPath, ["--expose-gc", "--import", "tsx", probe], {
      encoding: "utf8",
      timeout: 120_000,
    });
    const mb = Number(out.trim());
    assert.ok(Number.isFinite(mb), `probe printed ${JSON.stringify(out)}`);
    return mb;
  });
  const rss = Math.min(...runs);
  console.log(`local database RSS: ${runs.join(", ")} MB (judged ${rss})`);
  assert.ok(rss <= BUDGET_MB, `local database RSS ${rss} MB exceeds ${BUDGET_MB} MB (runs: ${runs.join(", ")})`);
});
