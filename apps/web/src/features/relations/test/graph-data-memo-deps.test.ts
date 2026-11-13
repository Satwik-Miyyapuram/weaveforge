/**
 * The graph canvas rebuilds its data only when a setting buildGraphData reads
 * changes, so its memo lists those settings by hand. A setting missing from the
 * list leaves the graph stale until something else changes (26-03: editing a
 * colour group did not recolour the nodes).
 *
 * The builder now lives in Rust (wf-core `graph_build`), so this reads its source.
 * Rust field names are snake_case; the memo uses camelCase, so they are mapped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const toCamel = (snake: string) => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

test("every setting buildGraphData reads is a dependency of the canvas memo (26-03)", () => {
  // Builder body only (the test module at the end is not builder code).
  const builder = read("../../../../../../crates/wf-core/src/relations/graph_build.rs").split("#[cfg(test)]")[0];
  // Settings helpers the builder calls: show_relation_edges .. effective_relation_types.
  const settingsRs = read("../../../../../../crates/wf-core/src/relations/graph_settings.rs");
  const helpers = settingsRs.slice(
    settingsRs.indexOf("pub fn show_relation_edges"),
    settingsRs.indexOf("/// How many filters"),
  );
  const read_ = new Set(
    [...(builder + helpers).matchAll(/settings\.([a-z_]+)/g)].map((m) => `settings.${toCamel(m[1] ?? "")}`),
  );
  const canvas = read("../ui/graph-canvas.tsx");
  const memo = canvas.slice(canvas.indexOf("buildGraphData(papers"));
  const deps = memo.slice(memo.indexOf("}, ["), memo.indexOf("]);"));
  assert.ok(read_.size > 0);
  const missing = [...read_].filter((field) => !deps.includes(field));
  assert.deepEqual(missing, []);
});
