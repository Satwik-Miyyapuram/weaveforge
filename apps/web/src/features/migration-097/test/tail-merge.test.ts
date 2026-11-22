import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { foldTail, isTailKind } from "../domain/tail-merge";

// A base doc with one text edit, and two independent edits made on copies of it.
function twoEdits() {
  const base = new Y.Doc();
  base.getText("body").insert(0, "hello");
  const baseState = Y.encodeStateAsUpdate(base);

  const a = new Y.Doc();
  Y.applyUpdate(a, baseState);
  a.getText("body").insert(5, " alice");
  const editA = Y.encodeStateAsUpdate(a, Y.encodeStateVector(base));

  const b = new Y.Doc();
  Y.applyUpdate(b, baseState);
  b.getText("body").insert(0, "bob: ");
  const editB = Y.encodeStateAsUpdate(b, Y.encodeStateVector(base));

  return { baseState, editA, editB, base };
}

function textOf(state: Uint8Array): string {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc.getText("body").toString();
}

test("empty base and empty tail fold to an empty doc", () => {
  const result = foldTail(null, []);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(textOf(result.state), "");
});

test("independent edits converge regardless of tail order", () => {
  const { baseState, editA, editB } = twoEdits();
  const ab = foldTail(baseState, [editA, editB]);
  const ba = foldTail(baseState, [editB, editA]);
  assert.equal(ab.ok, true);
  assert.equal(ba.ok, true);
  if (!ab.ok || !ba.ok) return;
  const text = textOf(ab.state);
  assert.equal(text, textOf(ba.state));
  assert.ok(text.includes("alice"));
  assert.ok(text.includes("bob"));
});

test("corrupt tail bytes are reported without document content", () => {
  const { baseState } = twoEdits();
  const result = foldTail(baseState, [new Uint8Array([1, 2, 3])]);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.reason.startsWith("tail update 0 unmergeable"));
  assert.ok(!result.reason.includes("hello"));
});

test("a tail update missing its earlier dependency is rejected", () => {
  const doc = new Y.Doc();
  doc.getText("body").insert(0, "one");
  const u1 = Y.encodeStateAsUpdate(doc);
  const sv1 = Y.encodeStateVector(doc);
  doc.getText("body").insert(3, " two");
  const u2 = Y.encodeStateAsUpdate(doc, sv1);
  void u1;

  const result = foldTail(null, [u2]);
  assert.equal(result.ok, false);
});

test("isTailKind accepts the tail kinds and rejects others", () => {
  assert.equal(isTailKind("log_entries"), true);
  assert.equal(isTailKind("notes"), false);
});
