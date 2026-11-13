import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

test("the batch cap is a real bound, not a placeholder", () => {
  const cap = readyCore().maxSignedUrlPaths();
  assert.ok(Number.isInteger(cap));
  assert.ok(cap > 0 && cap <= 1000);
});
