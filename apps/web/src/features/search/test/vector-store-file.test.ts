import assert from "node:assert/strict";
import { before, test } from "node:test";
import { loadTestCore } from "@/lib/test/load-test-core";
import { packBinary, unpackBinary } from "@/features/search/infrastructure/vector-store";

before(async () => { await loadTestCore(); });

test("the workspace-folder cache file reads back what was written", () => {
  const bytes = new Uint8Array(Float32Array.from([1, 2, 3, 4, 5, 6]).buffer);
  const value = { model: "m", dimensions: 3, bytes, revision: "r", hashes: { a: "x", b: "y" } };
  assert.deepEqual(unpackBinary(packBinary(value)), value);
});

test("a cache file cut inside its JSON head is refused rather than misread", () => {
  const value = { model: "m", dimensions: 3, bytes: new Uint8Array(12), revision: "r" };
  const bytes = packBinary(value);
  assert.equal(unpackBinary(bytes.subarray(0, 10)), null);
});
