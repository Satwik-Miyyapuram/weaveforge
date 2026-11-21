import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");

// Without a cap node:test runs one process per core, which breaks the 1 GB RAM rule.
test("web test runner caps node:test concurrency", () => {
  const src = readFileSync(path.join(root, "apps/web/scripts/run-tests.mjs"), "utf8");
  assert.match(src, /--test-concurrency=/);
});
