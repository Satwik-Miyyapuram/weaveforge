#!/usr/bin/env node
/**
 * Tier-0 preflight: every gate that needs no build and no build lock.
 *
 * Runs lint, the tsgo typecheck, each check:boundaries gate and cargo fmt in
 * parallel (3 at a time), never stops at the first failure, and prints one
 * summary. Run it before `git push`, fix everything it lists in one batch,
 * then push (the pre-push hook still runs the full set).
 *
 *   npm run preflight
 *   WF_PREFLIGHT_JOBS=1 npm run preflight     (low memory)
 *
 * The gate list is read from `check:boundaries` in package.json, so a gate
 * added there is picked up here without a second list to keep in step.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preflightGates } from "./lib/preflight-gates.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const gates = preflightGates(pkg.scripts);
const jobs = Number(process.env.WF_PREFLIGHT_JOBS ?? 3);

function run(gate) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(gate.cmd, { cwd: root, shell: true, env: { ...process.env, FORCE_COLOR: "0" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ ...gate, code: code ?? 1, out, ms: Date.now() - started }));
  });
}

const results = [];
const queue = [...gates];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const result = await run(queue.shift());
      console.log(`${result.code === 0 ? "ok  " : "FAIL"} ${result.name} (${(result.ms / 1000).toFixed(1)} s)`);
      results.push(result);
    }
  }),
);

const failed = results.filter((r) => r.code !== 0);
for (const r of failed) {
  console.log(`\n===== FAIL ${r.name}: ${r.cmd} =====`);
  console.log(r.out.trim().split("\n").slice(-60).join("\n"));
}
console.log(`\n${results.length - failed.length}/${results.length} gates passed.`);
process.exit(failed.length ? 1 : 0);
