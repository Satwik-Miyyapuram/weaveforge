/**
 * The graph canvas rebuilds its data only when a setting buildGraphData reads
 * changes, so its memo lists those settings by hand. A setting missing from the
 * list leaves the graph stale until something else changes (26-03: editing a
 * colour group did not recolour the nodes).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("every setting buildGraphData reads is a dependency of the canvas memo (26-03)", () => {
  const read_ = new Set(read("../application/build-graph-data.ts").match(/settings\.[a-zA-Z]+/g) ?? []);
  const canvas = read("../ui/graph-canvas.tsx");
  const memo = canvas.slice(canvas.indexOf("buildGraphData(papers"));
  const deps = memo.slice(memo.indexOf("}, ["), memo.indexOf("]);"));
  assert.ok(read_.size > 0);
  const missing = [...read_].filter((field) => !deps.includes(field));
  assert.deepEqual(missing, []);
});
