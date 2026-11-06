import assert from "node:assert/strict";
import test from "node:test";
import { ChangeSet, EditorState } from "@codemirror/state";
import { changesFromOp, opFromChanges } from "../application/codemirror-ops";
import { applyOp, type TextOp } from "../domain/text-ot";

function roundTrip(before: string, spec: Parameters<typeof ChangeSet.of>[0]): string {
  const changes = ChangeSet.of(spec, before.length);
  const after = changes.apply(EditorState.create({ doc: before }).doc).toString();
  assert.equal(applyOp(before, opFromChanges(changes, before)), after);
  return after;
}

test("one typed character is one insert", () => {
  const changes = ChangeSet.of({ from: 2, insert: "x" }, 4);
  assert.deepEqual(opFromChanges(changes, "abcd"), [{ p: 2, i: "x" }]);
});

test("a replaced selection is a delete then an insert at the same spot", () => {
  const changes = ChangeSet.of({ from: 1, to: 3, insert: "XY" }, 4);
  assert.deepEqual(opFromChanges(changes, "abcd"), [{ p: 1, d: "bc" }, { p: 1, i: "XY" }]);
});

test("several ranges at once (multi-cursor) apply to the same text", () => {
  assert.equal(
    roundTrip("hello world", [{ from: 0, insert: ">" }, { from: 5, to: 6 }, { from: 11, insert: "!" }]),
    ">helloworld!",
  );
});

test("an empty transaction is an empty op", () => {
  assert.deepEqual(opFromChanges(ChangeSet.empty(3), "abc"), []);
});

test("an op's editor changes, applied in order, give applyOp's text", () => {
  const op: TextOp = [{ p: 5, i: " world" }, { p: 0, d: "h" }, { p: 0, i: "H" }, { p: 1, c: "e" }];
  let doc = EditorState.create({ doc: "hello" }).doc;
  for (const change of changesFromOp(op)) doc = ChangeSet.of(change, doc.length).apply(doc);
  assert.equal(doc.toString(), applyOp("hello", op));
});
