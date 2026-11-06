/**
 * The live doc against a fake ShareJS server: two clients type at once, the
 * server orders their ops, and both must end with the server's text.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { LiveDoc, otUpdateOf } from "../application/live-doc";
import { applyOp, transformX, type TextOp } from "../domain/text-ot";

/** Applies ops in arrival order, transforming each past what it missed. */
class FakeServer {
  history: TextOp[] = [];
  constructor(public text: string) {}

  submit(op: TextOp, version: number): TextOp {
    let applied = op;
    for (const past of this.history.slice(version)) [applied] = transformX(applied, past);
    this.text = applyOp(this.text, applied);
    this.history.push(applied);
    return applied;
  }
}

test("a local edit is sent once, and the next waits for the ack", () => {
  const doc = new LiveDoc("ab", 3);
  doc.local([{ p: 2, i: "c" }]);
  assert.deepEqual(doc.take(), { op: [{ p: 2, i: "c" }], version: 3 });
  doc.local([{ p: 3, i: "d" }]);
  assert.equal(doc.take(), null);
  assert.equal(doc.unsaved, true);
  doc.acked();
  assert.deepEqual(doc.take(), { op: [{ p: 3, i: "d" }], version: 4 });
  doc.acked();
  assert.equal(doc.unsaved, false);
  assert.equal(doc.text, "abcd");
  assert.equal(doc.version, 5);
});

test("a remote op past this version asks for a reload", () => {
  const doc = new LiveDoc("ab", 3);
  assert.equal(doc.remote([{ p: 0, i: "x" }], 5), null);
  assert.equal(doc.text, "ab");
});

test("a remote op older than the loaded text is already in it", () => {
  const doc = new LiveDoc("xab", 3);
  assert.deepEqual(doc.remote([{ p: 0, i: "x" }], 2), []);
  assert.equal(doc.text, "xab");
  assert.equal(doc.version, 3);
});

test("two clients typing at once end with the server's text", () => {
  const server = new FakeServer("hello world");
  const a = new LiveDoc(server.text, 0);
  const b = new LiveDoc(server.text, 0);

  a.local([{ p: 5, i: "," }]);
  b.local([{ p: 6, d: "world" }]);
  b.local([{ p: 6, i: "there" }]);
  const fromA = a.take()!;
  const fromB = b.take()!;

  // The server takes A first, then B (which did not see A).
  const appliedA = server.submit(fromA.op, fromA.version);
  const appliedB = server.submit(fromB.op, fromB.version);

  a.acked();
  assert.ok(a.remote(appliedB, 1));
  assert.ok(b.remote(appliedA, 0));
  b.acked();

  assert.equal(server.text, "hello, there");
  assert.equal(a.text, server.text);
  assert.equal(b.text, server.text);
  assert.equal(a.version, 2);
  assert.equal(b.version, 2);
});

test("a remote op transforms past both in-flight and pending edits", () => {
  const server = new FakeServer("abc");
  const doc = new LiveDoc(server.text, 0);
  doc.local([{ p: 3, i: "1" }]);
  const sent = doc.take()!;
  doc.local([{ p: 4, i: "2" }]);
  const other = server.submit([{ p: 0, i: "X" }], 0);
  const shown = doc.remote(other, 0);
  assert.deepEqual(shown, [{ p: 0, i: "X" }]);
  server.submit(sent.op, sent.version);
  doc.acked();
  const next = doc.take()!;
  assert.equal(next.version, 2);
  server.submit(next.op, next.version);
  doc.acked();
  assert.equal(server.text, "Xabc12");
  assert.equal(doc.text, server.text);
});

test("otUpdateApplied events are read, others ignored", () => {
  assert.deepEqual(otUpdateOf({ name: "otUpdateApplied", args: [{ doc: "d", v: 4 }] }), { doc: "d", v: 4 });
  assert.deepEqual(otUpdateOf({ name: "otUpdateApplied", args: [{ doc: "d", v: 4, op: [{ p: 0, i: "x" }] }] }), {
    doc: "d",
    v: 4,
    op: [{ p: 0, i: "x" }],
  });
  assert.equal(otUpdateOf({ name: "connectionAccepted", args: [] }), null);
  assert.equal(otUpdateOf({ name: "otUpdateApplied", args: [{ v: 1 }] }), null);
});
