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

// --- indexing the values (review-2 F10) ------------------------------------
//
// The function is called once per row *per rollup column*, so a `values.find`
// per lookup made it O(rows × values). It now builds one `(paperId, fieldId)`
// index per call. These tests pin the behaviour that indexing must not change.

const labels: PaperFieldDef = {
  id: "label",
  name: "Label",
  kind: "text",
  options: [],
  sortOrder: 4,
};
const avg: PaperFieldDef = {
  id: "avg",
  name: "Score average",
  kind: "rollup",
  options: encodeRollupOptions({
    relationFieldId: "rel",
    agg: "avg",
    sourceFieldId: "score",
  }),
  sortOrder: 5,
};
const labelList: PaperFieldDef = {
  id: "labels",
  name: "Labels",
  kind: "rollup",
  options: encodeRollupOptions({
    relationFieldId: "rel",
    agg: "values",
    sourceFieldId: "label",
  }),
  sortOrder: 6,
};

test("every aggregation sees the same values as a naive scan would", () => {
  const defsAll = [relation, score, labels, avg, labelList, rollup, count];
  const valuesAll: PaperFieldValue[] = [
    ...values,
    { id: "4", paperId: "b", fieldId: "label", value: "VAE" },
    { id: "5", paperId: "c", fieldId: "label", value: "diffusion" },
    { id: "6", paperId: "d", fieldId: "rel", value: ["b", "c"] },
  ];

  assert.equal(computeRollup("a", count, defsAll, valuesAll), 2);
  assert.equal(computeRollup("a", rollup, defsAll, valuesAll), 6);
  assert.equal(computeRollup("a", avg, defsAll, valuesAll), 3);
  assert.deepEqual(computeRollup("a", labelList, defsAll, valuesAll), [
    "VAE",
    "diffusion",
  ]);

  // The same function over a *different* paper's relations resolves against the
  // same index without leaking the first paper's values.
  assert.equal(computeRollup("d", rollup, defsAll, valuesAll), 6);
  assert.equal(computeRollup("d", count, defsAll, valuesAll), 2);
  assert.equal(computeRollup("c", rollup, defsAll, valuesAll), null);
});

test("a duplicate (paperId, fieldId) row still resolves to the first value", () => {
  // `find` returned the first match; the index must too, or an existing
  // duplicate row would silently change a computed column.
  const duplicated: PaperFieldValue[] = [
    { id: "1", paperId: "a", fieldId: "rel", value: ["b"] },
    { id: "2", paperId: "b", fieldId: "score", value: 2 },
    { id: "3", paperId: "b", fieldId: "score", value: 99 },
  ];
  assert.equal(computeRollup("a", rollup, defs, duplicated), 2);
  assert.equal(computeRollup("a", count, defs, duplicated), 1);
});

test("the indexed lookup matches a naive scan over many rows and fields", () => {
  // 400 papers × 4 relation targets each, plus a second relation field and a
  // second source field: enough that a per-lookup scan would be visible.
  const relation2: PaperFieldDef = {
    id: "rel2",
    name: "Also uses",
    kind: "relation",
    options: [],
    sortOrder: 8,
  };
  const rollup2: PaperFieldDef = {
    id: "sum2",
    name: "Second sum",
    kind: "rollup",
    options: encodeRollupOptions({
      relationFieldId: "rel2",
      agg: "sum",
      sourceFieldId: "score",
    }),
    sortOrder: 9,
  };
  const defsBig = [relation, relation2, score, rollup, rollup2, count];

  const valuesBig: PaperFieldValue[] = [];
  const paperIds = Array.from({ length: 400 }, (_, i) => `p${i}`);
  for (const [index, id] of paperIds.entries()) {
    valuesBig.push({ id: `v${id}`, paperId: id, fieldId: "score", value: index });
    const targets = [
      paperIds[(index + 1) % paperIds.length]!,
      paperIds[(index + 2) % paperIds.length]!,
      paperIds[(index + 3) % paperIds.length]!,
    ];
    valuesBig.push({ id: `r${id}`, paperId: id, fieldId: "rel", value: targets });
    valuesBig.push({
      id: `r2${id}`,
      paperId: id,
      fieldId: "rel2",
      value: targets.slice(0, 2),
    });
  }

  // Naive scan, exactly what the old implementation did.
  const naiveSum = (paperId: string, relationFieldId: string): number | null => {
    const relationValue = valuesBig.find(
      (v) => v.paperId === paperId && v.fieldId === relationFieldId,
    )?.value;
    const relatedIds = Array.isArray(relationValue) ? relationValue : [];
    const related = relatedIds.flatMap((id) => {
      const row = valuesBig.find((v) => v.paperId === id && v.fieldId === "score");
      return row ? [row.value] : [];
    });
    const numbers = related
      .map((value) => (typeof value === "number" ? value : Number(value)))
      .filter((n) => Number.isFinite(n));
    return numbers.length === 0 ? null : numbers.reduce((a, b) => a + b, 0);
  };

  for (const id of paperIds) {
    assert.equal(computeRollup(id, rollup, defsBig, valuesBig), naiveSum(id, "rel"));
    assert.equal(computeRollup(id, rollup2, defsBig, valuesBig), naiveSum(id, "rel2"));
    assert.equal(computeRollup(id, count, defsBig, valuesBig), 3);
  }
});
