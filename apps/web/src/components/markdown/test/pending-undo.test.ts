/**
 * An upload is one undo step (design D19, DA-108). The placeholder and the
 * picture that replaced it were two history events, so undo after an upload
 * first brought back "Uploading…" and only a second undo removed it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo, undoDepth } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import { insertPending, pendingInsertSupport, resolvePending } from "../markdown-pending-insert";

function fakeView(doc: string, caret = doc.length) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [history(), pendingInsertSupport],
  });
  const view = {
    get state() { return state; },
    dispatch(...specs: TransactionSpec[]) { state = state.update(...specs).state; },
  } as unknown as EditorView;
  return { view, doc: () => state.doc.toString() };
}

test("undo after an upload removes the picture in one step", () => {
  const { view, doc } = fakeView("a b", 1);
  const id = insertPending(view, "![Uploading…]()", { ownLine: true });
  resolvePending(view, id, "![cat](vault:a.png)");
  assert.equal(doc(), "a\n\n![cat](vault:a.png)\n\n b");
  assert.equal(undoDepth(view.state), 1);
  assert.equal(view.state.selection.main.head, doc().indexOf(" b"), "caret after the picture");
  undo(view);
  assert.equal(doc(), "a b");
});

test("a selection the picture replaced comes back on undo", () => {
  const { view, doc } = fakeView("one two three", 4);
  view.dispatch({ selection: EditorSelection.range(4, 7) });
  const id = insertPending(view, "…", { ownLine: true });
  resolvePending(view, id, "![x](vault:x.png)");
  undo(view);
  assert.equal(doc(), "one two three");
});

test("typing during the upload keeps its own undo step", () => {
  const { view, doc } = fakeView("a", 1);
  const id = insertPending(view, "…");
  view.dispatch({ changes: { from: 0, insert: "Z" }, userEvent: "input.type" });
  resolvePending(view, id, "![x](vault:x.png)");
  assert.equal(doc(), "Za![x](vault:x.png)");
  while (undo(view)) { /* back to the start, one step at a time */ }
  assert.equal(doc(), "a");
});

test("a writer who moved the caret keeps their place", () => {
  const { view } = fakeView("abc", 3);
  const id = insertPending(view, "…");
  view.dispatch({ selection: EditorSelection.cursor(0) });
  resolvePending(view, id, "![x](vault:x.png)");
  assert.equal(view.state.selection.main.head, 0);
});

test("a failed upload still clears the placeholder", () => {
  const { view, doc } = fakeView("ab", 1);
  const id = insertPending(view, "…");
  resolvePending(view, id, "");
  assert.equal(doc(), "ab");
});
