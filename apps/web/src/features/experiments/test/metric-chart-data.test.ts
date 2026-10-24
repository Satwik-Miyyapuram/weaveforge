import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { alignSeries, emaSmooth, readPrefs, writePrefs } from "../ui/metric-chart-data";

/** The chart's data half after the split (35-18): behaviour and pref keys unchanged. */

function installSession(): Map<string, string> {
  const map = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    },
  });
  return map;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "sessionStorage");
});

test("alignSeries puts every run on the union of steps, gaps as null", () => {
  const { steps, aligned } = alignSeries([
    { id: "run-aaaaaaaaaa", points: [{ step: 2, value: 4 }, { step: 0, value: 1 }] },
    { id: "b", label: "B", points: [{ step: 1, value: 9 }] },
  ] as never);
  assert.deepEqual(steps, [0, 1, 2]);
  assert.deepEqual(aligned[0]!.values, [1, null, 4]);
  assert.equal(aligned[0]!.label, "run-aaaa");
  assert.deepEqual(aligned[1]!.values, [null, 9, null]);
  assert.equal(aligned[1]!.label, "B");
});

test("alignSeries with no runs is empty", () => {
  assert.deepEqual(alignSeries([]), { steps: [], aligned: [] });
});

test("emaSmooth keeps gaps and leaves the first value unbiased", () => {
  const out = emaSmooth([2, null, 4], 0.5);
  assert.equal(out[0], 2);
  assert.equal(out[1], null);
  assert.ok(Math.abs(out[2]! - (0.5 * 2 * 0.5 + 0.5 * 4) / (1 - 0.25)) < 1e-12);
});

test("prefs keep their session key name metric-chart:<metric>", () => {
  const map = installSession();
  assert.deepEqual(readPrefs("loss"), { hidden: [], smooth: 0 });
  writePrefs("loss", { hidden: ["a"], smooth: 0.6 });
  assert.deepEqual([...map.keys()], ["metric-chart:loss"]);
  assert.deepEqual(readPrefs("loss"), { hidden: ["a"], smooth: 0.6 });
});

test("prefs read with no session storage fall back to defaults", () => {
  assert.deepEqual(readPrefs("acc"), { hidden: [], smooth: 0 });
});
