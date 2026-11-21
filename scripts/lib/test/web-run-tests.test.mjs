import assert from "node:assert/strict";
import { test } from "node:test";
import { testArgs } from "../../../apps/web/scripts/lib/test-args.mjs";

// Without a cap node:test runs one process per core, which breaks the 1 GB RAM rule (P1-8).
test("web test runner runs one test file at a time by default", () => {
  const args = testArgs([], { isDir: () => false, env: {} });
  assert.equal(args[0], "--test-concurrency=1");
});