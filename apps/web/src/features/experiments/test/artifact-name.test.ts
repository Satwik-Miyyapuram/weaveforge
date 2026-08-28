import test from "node:test";
import assert from "node:assert/strict";
import { safeName } from "../infrastructure/experiment-artifact-store";

test("a picked filename becomes one storage segment", () => {
  assert.equal(safeName("loss curve.png"), "loss-curve.png");
  // Separators and traversal cannot survive: the key is built by joining.
  assert.equal(safeName("../../etc/passwd"), "etc-passwd");
  assert.equal(safeName("..."), "artifact");
  assert.equal(safeName(""), "artifact");
});

test("a very long name is cut rather than refused", () => {
  assert.equal(safeName(`${"a".repeat(300)}.png`).length, 128);
});
