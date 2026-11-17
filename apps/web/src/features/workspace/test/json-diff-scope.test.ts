/**
 * Removals from a project's JSON folder file are only drawn for the project the
 * workspace is showing. The stores hold every project's rows, so another
 * project's file never lists them, and would otherwise report them all dropped.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { JsonDiffEntry } from "@weaveforge/core";
import { scopeJsonRemovals } from "../application/parts-1";

function entry(action: string, id: string): JsonDiffEntry {
  return { action, kind: "tags", path: "p", existing: { id }, row: { id } } as unknown as JsonDiffEntry;
}

test("another project's file never reads its stored rows as removed", () => {
  const entries = [entry("removed", "other-project-tag"), entry("created", "new"), entry("unchanged", "same")];
  const kept = scopeJsonRemovals(entries, false);
  assert.deepEqual(
    kept.map((e) => e.action),
    ["created", "unchanged"],
  );
});

test("the active project keeps its removals", () => {
  const entries = [entry("removed", "dropped"), entry("created", "new")];
  assert.deepEqual(
    scopeJsonRemovals(entries, true).map((e) => e.action),
    ["removed", "created"],
  );
});
