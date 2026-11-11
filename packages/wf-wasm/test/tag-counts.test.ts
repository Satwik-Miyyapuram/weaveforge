import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { paperCountsForTags } from "../src/index.js";

const pkgDir = new URL("../pkg/", import.meta.url);

before(() => {
  initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });
});

test("counts distinct papers per tag, in tagIds order", () => {
  const links = [
    { tagId: "t1", paperId: "a" },
    { tagId: "t1", paperId: "a" },
    { tagId: "t1", paperId: "b" },
    { tagId: "x", paperId: "c" },
  ];
  assert.deepEqual(paperCountsForTags(["t2", "t1"], links), [0, 2]);
});

test("a tag with no links counts 0, and no tags gives an empty list", () => {
  assert.deepEqual(paperCountsForTags(["t1"], []), [0]);
  assert.deepEqual(paperCountsForTags([], [{ tagId: "t1", paperId: "a" }]), []);
});

test("the result is a plain number array, not a typed array", () => {
  const counts = paperCountsForTags(["t1"], [{ tagId: "t1", paperId: "a" }]);
  assert.ok(Array.isArray(counts));
  assert.equal(typeof counts[0], "number");
});
