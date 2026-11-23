/**
 * Every repo the Rust dispatcher answers must be exercised end to end somewhere.
 *
 * The contract files each name the repos they cover on line 1
 * (`// contract-repos: a, b`). A repo that is neither named there, nor covered by
 * a test listed in `ELSEWHERE`, nor allowlisted with a reason in `ALLOW`, is a
 * repo whose PostgREST path nothing checks, and this file fails on it.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
// contracts/ -> test/ -> backend/ -> src/ -> web/
const webRoot = path.resolve(here, "../../../..");
const dispatcherPath = path.resolve(webRoot, "../../crates/wf-core/src/repo_query.rs");

/** Repos covered by a test outside the contract suites, keyed to that test file (relative to apps/web). */
const ELSEWHERE: Record<string, string> = {
  crdt_updates: "src/backend/test/crdt-compaction.test.ts",
  crdt_snapshots: "src/backend/test/crdt-snapshot-watermark.test.ts",
  screening_decisions: "src/backend/test/screening-decisions.test.ts",
  lab_snapshots: "src/backend/test/lab-snapshot-comments.test.ts",
};

/** Repos with no end-to-end contract, and why. */
const ALLOW: Record<string, string> = {
  showcase_seed: "bulk demo seed, not a per-row repository",
  blob_objects: "blob storage RPC, covered by the blob storage tests",
  plan_feed_links: "feed RPC, not a row repository",
  account: "account cascade, partly covered by src/backend/test/account-cascade.test.ts",
  experiment_push: "push RPC, not a row repository",
};

/** The repo names the Rust dispatcher answers: every quoted name before `=>` in `repo_step`. */
function dispatcherRepos(): Set<string> {
  const lines = fs.readFileSync(dispatcherPath, "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("pub fn repo_step"));
  assert.ok(start >= 0, `repo_step not found in ${dispatcherPath}`);
  const end = lines.findIndex((l, i) => i > start && l.startsWith("}"));
  const names = new Set<string>();
  for (const line of lines.slice(start, end)) {
    const arm = /^\s*((?:"[^"]+"\s*\|\s*)*"[^"]+")\s*=>/.exec(line);
    if (!arm) continue;
    for (const m of arm[1]!.matchAll(/"([^"]+)"/g)) names.add(m[1]!);
  }
  return names;
}

interface ContractFile {
  file: string;
  header: string[];
  source: string;
}

/** Every `contracts/*.contract.test.ts`, with the repo names on its line 1. */
function contractFiles(): ContractFile[] {
  const dir = here;
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".contract.test.ts"))
    .sort()
    .map((name) => {
      const source = fs.readFileSync(path.join(dir, name), "utf8");
      const first = source.split("\n")[0] ?? "";
      const match = /^\/\/ contract-repos:\s*(.+)$/.exec(first.trim());
      const header = match ? match[1]!.split(",").map((s) => s.trim()).filter(Boolean) : [];
      return { file: name, header, source };
    });
}

const repos = dispatcherRepos();
const contracts = contractFiles();
const covered = new Set(contracts.flatMap((c) => c.header));

test("every repo the Rust dispatcher answers has an end-to-end contract, an end-to-end test elsewhere, or a stated reason", () => {
  const uncovered = [...repos].filter((r) => !covered.has(r) && !(r in ELSEWHERE) && !(r in ALLOW)).sort();
  assert.deepEqual(
    uncovered,
    [],
    `repos with no end-to-end contract, test or allowlist reason: ${uncovered.join(", ")}`,
  );
});

test("every contract file registers tests", () => {
  const empty = contracts.filter((c) => !/\btest\(/.test(c.source)).map((c) => c.file);
  assert.deepEqual(empty, [], `contract files that register no tests: ${empty.join(", ")}`);
});

test("the allowlist names only repos that exist", () => {
  const unknown = [...Object.keys(ALLOW), ...Object.keys(ELSEWHERE)].filter((r) => !repos.has(r)).sort();
  assert.deepEqual(unknown, [], `allowlisted or elsewhere names not in repo_step: ${unknown.join(", ")}`);
  const missing = Object.values(ELSEWHERE).filter((p) => !fs.existsSync(path.resolve(webRoot, p))).sort();
  assert.deepEqual(missing, [], `ELSEWHERE test paths that do not exist: ${missing.join(", ")}`);
});

test("every contract header names only repos that exist", () => {
  const unknown = contracts
    .flatMap((c) => c.header.filter((r) => !repos.has(r)).map((r) => `${c.file}: ${r}`))
    .sort();
  assert.deepEqual(unknown, [], `contract headers naming unknown repos: ${unknown.join(", ")}`);
});
