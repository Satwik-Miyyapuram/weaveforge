import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRollup } from "../../../src/features/papers/application/compute-rollup.js";
import { encodeRollupOptions } from "../../../src/features/papers/domain/paper-field.js";
import type { PaperFieldDef, PaperFieldValue } from "../../../src/features/papers/domain/paper-field.js";

const relation: PaperFieldDef = {
  id: "rel",
  name: "Uses",
  kind: "relation",
  options: [],
  sortOrder: 0,
};
const score: PaperFieldDef = {
  id: "score",
  name: "Score",
  kind: "number",
  options: [],
  sortOrder: 1,
};
const rollup: PaperFieldDef = {
  id: "sum",
  name: "Score sum",
  kind: "rollup",
  options: encodeRollupOptions({
    relationFieldId: "rel",
    agg: "sum",
    sourceFieldId: "score",
  }),
  sortOrder: 2,
};
const count: PaperFieldDef = {
  id: "count",
  name: "Related count",
  kind: "rollup",
  options: encodeRollupOptions({ relationFieldId: "rel", agg: "count" }),
  sortOrder: 3,
};

const defs = [relation, score, rollup, count];
const values: PaperFieldValue[] = [
  { id: "1", paperId: "a", fieldId: "rel", value: ["b", "c"] },
  { id: "2", paperId: "b", fieldId: "score", value: 2 },
  { id: "3", paperId: "c", fieldId: "score", value: 4 },
];

test("computeRollup count and sum over related papers", () => {
  assert.equal(computeRollup("a", count, defs, values), 2);
  assert.equal(computeRollup("a", rollup, defs, values), 6);
});

test("computeRollup returns null when relation is empty", () => {
  assert.equal(computeRollup("b", count, defs, values), 0);
  assert.equal(computeRollup("b", rollup, defs, values), null);
});
