import assert from "node:assert/strict";
import test from "node:test";
import { packBinary, unpackBinary } from "@/features/search/infrastructure/vector-store";

test("the workspace-folder cache file reads back what was written", () => {
  const vectors = Float32Array.from([1, 2, 3, 4, 5, 6]).buffer;
  const value = { model: "m", dimensions: 3, ids: ["a#0", "b#0"], vectors, revision: "r", hashes: { a: "x", b: "y" } };
  const back = unpackBinary(packBinary(value))!;
  assert.deepEqual({ ...back, vectors: [...new Float32Array(back.vectors)] }, { ...value, vectors: [1, 2, 3, 4, 5, 6] });
});

test("a truncated cache file is refused rather than misread", () => {
  const value = { model: "m", dimensions: 3, ids: ["a#0"], vectors: new Float32Array(3).buffer, revision: "r" };
  const bytes = packBinary(value);
  assert.equal(unpackBinary(bytes.subarray(0, bytes.length - 4)), null);
});
