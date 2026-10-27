/**
 * The experiment page said the status twice ("Running" in the bar, "running"
 * in Record), repeated Record's facts in a meta line, had a "− slider + 1 / row"
 * control with no name, Y ticks of mixed precision (0.5000, 1.000, 120.0),
 * link artifacts all reading "artifact", no copy on the run command, and an
 * activity row called "Logged" (design D22, DA-141).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatTicks } from "../ui/metric-chart-data";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../ui/${rel}`, import.meta.url)), "utf8");
const detail = read("experiment-detail-screen.tsx");

test("one axis shows one precision", () => {
  assert.deepEqual(formatTicks([0, 0.5, 1, 1.5]), ["0.0", "0.5", "1.0", "1.5"]);
  assert.deepEqual(formatTicks([0, 50, 100, 150]), ["0", "50", "100", "150"]);
  assert.deepEqual(formatTicks([0.25, 0.5, 0.75]), ["0.25", "0.50", "0.75"]);
  assert.deepEqual(formatTicks([0.001, 0.002]), ["0.001", "0.002"]);
  // Too large or too small for fixed decimals: one exponent style for all.
  assert.deepEqual(formatTicks([0, 2e6, 4e6]), ["0.0e+0", "2.0e+6", "4.0e+6"]);
  assert.deepEqual(formatTicks([1e-5, 2e-5]), ["1.0e-5", "2.0e-5"]);
  assert.deepEqual(formatTicks([]), []);
});

test("the chart uses the shared tick formatter", () => {
  assert.match(read("metric-chart.tsx"), /values: \(_u, splits\) => formatTicks\(splits\)/);
});

test("status shows once, and the meta line only stands in for a shut panel", () => {
  assert.doesNotMatch(detail, /\["Status", exp\.status\]/);
  assert.match(detail, /\{meta && !asideOpen && <p className="record-mono record-meta">/);
});

test("the chart size control is named", () => {
  const grid = read("metric-grid.tsx");
  assert.match(grid, /aria-label="Charts per row"/);
  assert.match(grid, /\{cols\} per row/);
  assert.doesNotMatch(grid, /\{cols\} \/ row/);
});

test("link artifacts show their file name", () => {
  const panels = read("experiment-panels.tsx");
  assert.doesNotMatch(panels, />\s*artifact\s*</);
  assert.match(panels, /\{figureLabel\(url, i\)\}\s*<\/Chip>/);
});

test("the run command can be copied", () => {
  assert.match(detail, /<RecordSection\s+label="Run command"\s+tag=\{\s*<Button size="sm" onClick=\{\(\) => void copyRunCommand\(\)\}>/);
  assert.match(detail, /navigator\.clipboard\.writeText\(exp\.runCommand\)/);
});

test("the activity row says the run was created", () => {
  assert.doesNotMatch(detail, /what: "Logged"/);
  assert.match(detail, /what: "Created"/);
});
