import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { alignSeries, emaSmooth, tickFormat } from "../src/metric-chart-data.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("alignSeries puts every run on the union step axis with null gaps", () => {
  const chart = alignSeries([
    { id: "a", points: [{ step: 2, value: 20 }, { step: 0, value: 0 }] },
    { id: "b", points: [{ step: 1, value: 10 }] },
  ]);
  assert.deepEqual(chart.steps, [0, 1, 2]);
  assert.deepEqual(chart.aligned[0]!.values, [0, null, 20]);
  assert.deepEqual(chart.aligned[1]!.values, [null, 10, null]);
});

test("the label falls back to the first eight characters of the id", () => {
  const chart = alignSeries([{ id: "0123456789abcdef", points: [] }]);
  assert.equal(chart.aligned[0]!.label, "01234567");
});

test("a supplied label and colour are kept, and an unset colour is absent", () => {
  const chart = alignSeries([{ id: "a", label: "Run A", color: "#f00", points: [] }, { id: "b", points: [] }]);
  assert.equal(chart.aligned[0]!.label, "Run A");
  assert.equal(chart.aligned[0]!.color, "#f00");
  assert.equal("color" in chart.aligned[1]!, false);
});

test("an empty series list gives an empty axis", () => {
  assert.deepEqual(alignSeries([]), { steps: [], aligned: [] });
});

test("a run with no points gives an empty axis for that run only", () => {
  const chart = alignSeries([{ id: "a", points: [] }]);
  assert.deepEqual(chart.steps, []);
  assert.deepEqual(chart.aligned[0]!.values, []);
});

test("emaSmooth keeps gaps as gaps and leaves the first value unbiased", () => {
  const out = emaSmooth([2, null, 4], 0.5);
  assert.equal(out[0], 2);
  assert.equal(out[1], null);
  const expected = (0.5 * 2 * 0.5 + 0.5 * 4) / (1 - 0.25);
  assert.ok(Math.abs((out[2] as number) - expected) < 1e-12);
});

test("emaSmooth with alpha at or below zero returns the values unchanged", () => {
  assert.deepEqual(emaSmooth([1, null, 3], 0), [1, null, 3]);
});

test("emaSmooth of an empty list is empty", () => {
  assert.deepEqual(emaSmooth([], 0.5), []);
});

test("emaSmooth propagates NaN from the input and does not throw", () => {
  const out = emaSmooth([Number.NaN, 1], 0.5);
  assert.equal(out.length, 2);
  assert.ok(Number.isNaN(out[0] as number));
  assert.ok(Number.isNaN(out[1] as number));
  const unchanged = emaSmooth([Number.NaN], 0);
  assert.ok(Number.isNaN(unchanged[0] as number));
});

test("tickFormat picks the fewest exact decimals", () => {
  assert.deepEqual(tickFormat([0, 0.5, 1, 1.5]), { kind: "fixed", digits: 1 });
  assert.deepEqual(tickFormat([0, 50, 100]), { kind: "fixed", digits: 0 });
  assert.deepEqual(tickFormat([0.25, 0.5, 0.75]), { kind: "fixed", digits: 2 });
});

test("tickFormat uses the exponent style for large or tiny values", () => {
  assert.deepEqual(tickFormat([0, 2e6, 4e6]), { kind: "exponential" });
  assert.deepEqual(tickFormat([1e-5, 2e-5]), { kind: "exponential" });
});

test("tickFormat is plain when no value is finite or the list is empty", () => {
  assert.deepEqual(tickFormat([Number.NaN]), { kind: "plain" });
  assert.deepEqual(tickFormat([]), { kind: "plain" });
});
