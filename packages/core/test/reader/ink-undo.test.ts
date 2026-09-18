import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_INK_UNDO,
  INK_UNDO_LIMIT,
  pushInkUndo,
  refreshInkUndoAnnotation,
  renameInkUndoId,
  takeInkRedo,
  takeInkUndo,
  type InkUndoState,
} from "../../src/reader/ink-undo.js";
import type { ReaderAnnotation } from "../../src/reader/reader-annotation.js";

function ink(id: string, paths: number[][] = [[0, 0, 10, 10]]): ReaderAnnotation {
  return {
    id,
    origin: "local",
    zoteroKey: null,
    type: "ink",
    color: "#ff6666",
    text: "",
    comment: "",
    tags: [],
    anchor: { zoteroPosition: { pageIndex: 0, paths, width: 1.42 } },
    sortIndex: "00000|000000|00000",
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    syncState: "local",
    zoteroVersion: null,
  };
}

test("undo and redo walk the stack in order", () => {
  let state: InkUndoState = pushInkUndo(EMPTY_INK_UNDO, { kind: "create", annotation: ink("a") });
  state = pushInkUndo(state, { kind: "create", annotation: ink("b") });

  const first = takeInkUndo(state);
  assert.ok(first);
  assert.equal(first.entry.kind, "create");
  assert.equal(first.entry.kind === "create" && first.entry.annotation.id, "b");
  assert.equal(first.state.undo.length, 1);
  assert.equal(first.state.redo.length, 1);

  const again = takeInkRedo(first.state);
  assert.ok(again);
  assert.equal(again.entry, first.entry);
  assert.deepEqual(again.state, state);

  assert.equal(takeInkRedo(state), null, "nothing to redo on a fresh branch");
  assert.equal(takeInkUndo(EMPTY_INK_UNDO), null);
});

test("a new step discards the redo branch and the stack is bounded", () => {
  let state = pushInkUndo(EMPTY_INK_UNDO, { kind: "create", annotation: ink("a") });
  state = takeInkUndo(state)!.state;
  assert.equal(state.redo.length, 1);
  state = pushInkUndo(state, { kind: "create", annotation: ink("b") });
  assert.equal(state.redo.length, 0);

  for (let i = 0; i < INK_UNDO_LIMIT + 10; i++) {
    state = pushInkUndo(state, { kind: "create", annotation: ink(`s${i}`) });
  }
  assert.equal(state.undo.length, INK_UNDO_LIMIT);
  const top = state.undo[state.undo.length - 1]!;
  assert.equal(top.kind === "create" && top.annotation.id, `s${INK_UNDO_LIMIT + 9}`);
});

test("renaming an id follows the row across both stacks and every entry kind", () => {
  let state = pushInkUndo(EMPTY_INK_UNDO, { kind: "create", annotation: ink("old") });
  const before = ink("old").anchor;
  const after = ink("old", [[0, 0, 10, 10], [20, 20, 30, 30]]).anchor;
  state = pushInkUndo(state, { kind: "anchor", id: "old", before, after });
  state = pushInkUndo(state, { kind: "remove", annotation: ink("old") });
  state = pushInkUndo(state, { kind: "create", annotation: ink("other") });
  state = takeInkUndo(state)!.state;

  const renamed = renameInkUndoId(state, "old", "new");
  for (const entry of [...renamed.undo, ...renamed.redo]) {
    if (entry.kind === "anchor") assert.equal(entry.id, "new");
    else assert.notEqual(entry.annotation.id, "old");
  }
  const untouched = renamed.redo[0]!;
  assert.equal(untouched.kind === "create" && untouched.annotation.id, "other");
  assert.equal(renameInkUndoId(state, "old", "old"), state, "a no-op rename is the same object");
});

test("refreshing a snapshot updates the row's create and remove entries only", () => {
  let state = pushInkUndo(EMPTY_INK_UNDO, { kind: "create", annotation: ink("a") });
  state = pushInkUndo(state, { kind: "create", annotation: ink("b") });
  const grown = ink("a", [[0, 0, 10, 10], [50, 50, 60, 60]]);
  const refreshed = refreshInkUndoAnnotation(state, grown);
  const a = refreshed.undo[0]!;
  const b = refreshed.undo[1]!;
  assert.equal(a.kind === "create" && a.annotation.anchor.zoteroPosition?.paths?.length, 2);
  assert.equal(b.kind === "create" && b.annotation.anchor.zoteroPosition?.paths?.length, 1);
});
