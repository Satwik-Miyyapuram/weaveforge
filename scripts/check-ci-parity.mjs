/**
 * The CI boundary-gate list and `check:boundaries` must agree.
 *
 * CI runs the gates as separate steps rather than as the chained script, so a PR
 * can see *which* rule rejected it — and that means the list is written twice.
 * The failure mode is one-directional and silent: a gate added to
 * `check:boundaries` and not to the workflow stops gating merges, in the
 * direction of less checking, with a green build. `docs/building/dev.md`'s table
 * is generated from the script, so nothing prompts anyone either.
 *
 * Scoped to the steps marked `id: gate_*`. Those are the boundary gates: each runs
 * with `if: always()` so the summary step can collect them. CI also runs
 * `check:deployment-surface` and `check:release-drafts`, and those are *not*
 * boundary gates on purpose — the first compares against the built output, so it
 * has to run after `npm run build`, and the second needs a GitHub token and the
 * network. Neither can run inside `check:boundaries`, and a rule demanding they
 * did would be wrong rather than strict.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const chained = packageJson.scripts["check:boundaries"] ?? "";
const inScript = [...new Set([...chained.matchAll(/npm run (check:[\w-]+)/g)].map((m) => m[1]))];

/**
 * The gate steps, in order. A step may set `if:` or `env:` before its `run:`, so
 * each block is the text between one `id: gate_*` and the next step marker.
 */
const workflow = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const gateBlocks = workflow
  .split(/\n\s*- name: /)
  .filter((block) => /\n\s*id: gate_/.test(block));

const inWorkflow = [
  ...new Set(
    gateBlocks
      .map((block) => /run: npm run (check:[\w-]+)/.exec(block)?.[1])
      .filter((name) => typeof name === "string"),
  ),
];

if (inWorkflow.length === 0) {
  // A check that reads nothing passes for the wrong reason — which is the exact
  // failure this whole file is about.
  console.error("FAIL: no `id: gate_*` steps found in ci.yml — this check read nothing.");
  process.exit(1);
}

const missingFromCi = inScript.filter((gate) => !inWorkflow.includes(gate));
const missingFromScript = inWorkflow.filter((gate) => !inScript.includes(gate));

if (missingFromCi.length || missingFromScript.length) {
  console.error("FAIL: the CI boundary gates and check:boundaries disagree.");
  for (const gate of missingFromCi) {
    console.error(`  ${gate} is in check:boundaries and NOT a gate step in ci.yml`);
    console.error("    → it would stop gating merges, silently, with a green build");
  }
  for (const gate of missingFromScript) {
    console.error(`  ${gate} is a gate step in ci.yml and NOT in check:boundaries`);
    console.error("    → a local check:all would pass on something CI rejects");
  }
  process.exit(1);
}

console.log(`CI gate parity OK (${inScript.length} gates, same list in both).`);
