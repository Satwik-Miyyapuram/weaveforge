import { test } from "node:test";
import assert from "node:assert/strict";
import { testArgs } from "../../../apps/web/scripts/lib/test-args.mjs";

const dirs = new Set(["src/features/ink", "src/features/ink/test"]);
const isDir = (p) => dirs.has(p);
const run = (argv, env = {}) => testArgs(argv, { isDir, env });

test("no args runs the whole suite", () => {
  assert.deepEqual(run([]), [
    "--test-concurrency=1",
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
  ]);
});

test("a directory runs only the tests under it", () => {
  assert.deepEqual(run(["src/features/ink"]), [
    "--test-concurrency=1",
    "src/features/ink/**/*.test.ts",
    "src/features/ink/**/*.test.tsx",
  ]);
});

test("a Windows-style or trailing-slash directory is normalised", () => {
  assert.deepEqual(run(["src\\features\\ink\\test\\"]), [
    "--test-concurrency=1",
    "src/features/ink/test/**/*.test.ts",
    "src/features/ink/test/**/*.test.tsx",
  ]);
});

test("named test files run alone", () => {
  assert.deepEqual(run(["src/a.test.ts", "src/b.test.tsx"]), [
    "--test-concurrency=1",
    "src/a.test.ts",
    "src/b.test.tsx",
  ]);
});

test("an option value is not taken for a directory", () => {
  assert.deepEqual(run(["--test-name-pattern", "startup", "src/features/ink"]), [
    "--test-concurrency=1",
    "--test-name-pattern",
    "startup",
    "src/features/ink/**/*.test.ts",
    "src/features/ink/**/*.test.tsx",
  ]);
});

test("an option alone still runs the whole suite", () => {
  assert.deepEqual(run(["--test-name-pattern", "startup"]), [
    "--test-concurrency=1",
    "--test-name-pattern",
    "startup",
    "src/**/*.test.ts",
    "src/**/*.test.tsx",
  ]);
});

test("concurrency comes from WF_TEST_CONCURRENCY or an explicit flag", () => {
  assert.equal(run([], { WF_TEST_CONCURRENCY: "2" })[0], "--test-concurrency=2");
  const own = run(["--test-concurrency=8", "src/a.test.ts"]);
  assert.deepEqual(own, ["--test-concurrency=8", "src/a.test.ts"]);
});
