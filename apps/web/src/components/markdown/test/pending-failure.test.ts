/**
 * A picture lands on its own line, so its insert adds blank lines around the
 * placeholder (DA-104). When the upload then fails, the placeholder went but the
 * blank lines stayed: "keep this" became "keep this\n\n".
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { history } from "@codemirror/commands";
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

test("a failed upload leaves the note as it was", () => {
  const { view, doc } = fakeView("keep this");
  const id = insertPending(view, "![Uploading…]()", { ownLine: true });
  resolvePending(view, id, "");
  assert.equal(doc(), "keep this");
});

test("mid-sentence, both blank lines go with it", () => {
  const { view, doc } = fakeView("a b", 1);
  const id = insertPending(view, "![Uploading…]()", { ownLine: true });
  resolvePending(view, id, "");
  assert.equal(doc(), "a b");
});

test("writing done while it uploaded is kept", () => {
  const { view, doc } = fakeView("start ");
  const id = insertPending(view, "![Uploading…]()", { ownLine: true });
  view.dispatch({ changes: { from: 0, insert: "PRE " } });
  view.dispatch({ changes: { from: view.state.doc.length, insert: " POST" } });
  resolvePending(view, id, "");
  assert.equal(doc(), "PRE start  POST");
});

test("a blank line the writer has since typed into is left alone", () => {
  const { view, doc } = fakeView("a b", 1);
  const id = insertPending(view, "![Uploading…]()", { ownLine: true });
  view.dispatch({ changes: { from: 2, insert: "note" } }); // into the blank line above
  resolvePending(view, id, "");
  assert.equal(doc(), "a\nnote\n\n\n b");
});
