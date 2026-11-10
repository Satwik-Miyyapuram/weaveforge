import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(async () => {
  await loadTestCore();
});

test("a picked filename becomes one storage segment", () => {
  assert.equal(readyCore().safeName("loss curve.png"), "loss-curve.png");
  // Separators and traversal cannot survive: the key is built by joining.
  assert.equal(readyCore().safeName("../../etc/passwd"), "etc-passwd");
  assert.equal(readyCore().safeName("..."), "artifact");
  assert.equal(readyCore().safeName(""), "artifact");
});

test("a very long name is cut rather than refused", () => {
  assert.equal(readyCore().safeName(`${"a".repeat(300)}.png`).length, 128);
});
