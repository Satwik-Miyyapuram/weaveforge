/**
 * A new import diff starts with no picks (P2-234). The preview kept its
 * per-path choices across diffs, so after a re-check a conflict could be
 * settled with a choice made against an older copy of the file.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ImportPreview } from "../ui/workspace-folder-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function diff() {
  return {
    entries: [{ action: "conflict", entity: { path: "notes/a.md" }, reason: "edited on both sides" }],
    counts: { created: 0, updated: 0, removed: 0, unchanged: 0, conflict: 1 },
  } as never;
}

function importLabel(r: ReactTestRenderer): string {
  const button = r.root.findAll((node) => node.type === "button" && /Import \d/.test(String(node.props.children)));
  return String(button[0]?.props.children);
}

test("a new diff drops the picks made against the old one", () => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(createElement(ImportPreview, { diff: diff(), onApplied: () => undefined }));
  });
  assert.equal(importLabel(r), "Import 0 changes");
  act(() => r.root.find((node) => typeof node.props.onChoose === "function").props.onChoose("theirs"));
  assert.equal(importLabel(r), "Import 1 change", "the pick counts");
  act(() => r.update(createElement(ImportPreview, { diff: diff(), onApplied: () => undefined })));
  assert.equal(importLabel(r), "Import 0 changes", "a fresh diff starts unpicked");
  act(() => r.unmount());
});
