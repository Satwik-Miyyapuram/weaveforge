import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";

import { docChangeListener } from "../ui/doc-change-listener";

test("a dispatched change reaches the callback, a selection move does not", () => {
  const seen: string[] = [];
  const box = { current: (view: EditorView) => void seen.push(view.state.doc.toString()) };
  let state = EditorState.create({ doc: "old", extensions: docChangeListener(box) });
  const [listener] = state.facet(EditorView.updateListener);
  assert.ok(listener, "listener registered");

  // A paste is a transaction with no DOM input event behind it.
  const paste = state.update({ changes: { from: 3, insert: "\npasted" } });
  state = paste.state;
  listener({ docChanged: true, view: { state } } as unknown as ViewUpdate);
  listener({ docChanged: false, view: { state } } as unknown as ViewUpdate);
  assert.deepEqual(seen, ["old\npasted"]);

  // The box is read on every change, so the caller can swap the callback.
  box.current = () => void seen.push("swapped");
  listener({ docChanged: true, view: { state } } as unknown as ViewUpdate);
  assert.equal(seen.at(-1), "swapped");
});
