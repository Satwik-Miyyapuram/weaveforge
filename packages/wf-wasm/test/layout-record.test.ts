import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { emptyLayout, layoutFromRecord } from "../src/pane-tree.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("a null, empty or unusable record is one empty pane", () => {
  assert.deepEqual(layoutFromRecord(null), emptyLayout());
  assert.deepEqual(layoutFromRecord(""), emptyLayout());
  assert.deepEqual(layoutFromRecord("not json"), emptyLayout());
  assert.deepEqual(layoutFromRecord("null"), emptyLayout());
});

test("a leaf keeps its valid tab modes and drops the retired read mode", () => {
  const layout = layoutFromRecord(
    JSON.stringify({
      root: {
        type: "leaf",
        id: "pane-1",
        tabs: [
          { kind: "vault_page", id: "a", mode: "read" },
          { kind: "vault_page", id: "b", mode: "ink" },
        ],
        activeIndex: 0,
      },
    }),
  );
  assert.deepEqual(layout, {
    root: {
      type: "leaf",
      id: "pane-1",
      tabs: [
        { kind: "vault_page", id: "a" },
        { kind: "vault_page", id: "b", mode: "ink" },
      ],
      activeIndex: 0,
      groups: [],
    },
    focusedPaneId: "pane-1",
  });
});
