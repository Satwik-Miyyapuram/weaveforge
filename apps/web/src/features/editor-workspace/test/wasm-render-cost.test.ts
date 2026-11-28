/**
 * Every wasm call copies its arguments across. On cold /workspace in WeaveForge
 * Dev, rows that passed their whole subtree and panes that passed both trees on
 * every render cost ~60 ms of the 1000 ms budget.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("explorer rows ask rename and create checks with the row alone", () => {
  const panel = read("../ui/explorer-panel.tsx");
  assert.doesNotMatch(panel, /canRename\(node\)|creatableUnder\(node\)/);
  assert.match(panel, /const rowOnly = \(node: WorkspaceTreeNode\): WorkspaceTreeNode => \(\{ \.\.\.node, children: \[\] \}\);/);
});

test("pane breadcrumbs are worked out once per document while the trees stay the same", () => {
  const screen = read("../ui/workspace-screen.tsx");
  assert.match(screen, /const crumbsOf = useMemo\(\(\) => crumbCache\(tree, listsTree\), \[tree, listsTree\]\);/);
  assert.match(screen, /return shown \? crumbsOf\(shown\) : \[\];/);
});
