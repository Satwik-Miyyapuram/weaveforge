/**
 * The text ops Overleaf sends and accepts. The property that matters is
 * convergence: whichever order two edits arrive in, both sides end with the
 * same text. Seeded random ops check it beyond the hand-written cases.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyOp, transformX, type TextOp } from "../domain/text-ot";

function converges(doc: string, ours: TextOp, theirs: TextOp): string {
  const [oursAfter, theirsAfter] = transformX(ours, theirs);
  const here = applyOp(applyOp(doc, ours), theirsAfter);
  const there = applyOp(applyOp(doc, theirs), oursAfter);
  assert.equal(here, there);
  return here;
}

test("inserts and deletes apply in order", () => {
  assert.equal(applyOp("hello", [{ p: 5, i: " world" }, { p: 0, d: "h" }, { p: 0, i: "H" }]), "Hello world");
});

test("a delete that does not match the text throws", () => {
  assert.throws(() => applyOp("abc", [{ p: 1, d: "x" }]), /does not match/);
  assert.throws(() => applyOp("abc", [{ p: 4, i: "x" }]), /past the end/);
});

test("comments change no text", () => {
  assert.equal(applyOp("abc", [{ p: 1, c: "b", t: "t1" }]), "abc");
});

test("two inserts at one spot put ours first, as the server does", () => {
  assert.equal(converges("ab", [{ p: 1, i: "X" }], [{ p: 1, i: "Y" }]), "aXYb");
});

test("an insert inside a remote delete survives", () => {
  assert.equal(converges("abcdef", [{ p: 3, i: "X" }], [{ p: 1, d: "bcde" }]), "aXf");
});

test("overlapping deletes remove the text once", () => {
  assert.equal(converges("abcdef", [{ p: 1, d: "bcd" }], [{ p: 2, d: "cde" }]), "af");
});

test("a delete split by a remote insert keeps the insert", () => {
  assert.equal(converges("abcdef", [{ p: 1, d: "bcde" }], [{ p: 3, i: "X" }]), "aXf");
});

test("multi-component ops converge", () => {
  converges("the quick brown fox", [{ p: 4, d: "quick " }, { p: 0, i: ">" }], [{ p: 10, d: "brown" }, { p: 10, i: "red" }]);
});

test("utf-16 positions keep surrogate pairs whole", () => {
  assert.equal(converges("a😀b", [{ p: 3, i: "X" }], [{ p: 0, i: "Y" }]), "Ya😀Xb");
});

/** A tiny seeded PRNG so failures reproduce. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomOp(doc: string, next: () => number): TextOp {
  const op: TextOp = [];
  let text = doc;
  const count = 1 + Math.floor(next() * 3);
  for (let n = 0; n < count; n += 1) {
    const p = Math.floor(next() * (text.length + 1));
    if (next() < 0.5 || text.length === p) {
      const i = "xyz".slice(0, 1 + Math.floor(next() * 3));
      op.push({ p, i });
      text = text.slice(0, p) + i + text.slice(p);
    } else {
      const d = text.slice(p, p + 1 + Math.floor(next() * 4));
      op.push({ p, d });
      text = text.slice(0, p) + text.slice(p + d.length);
    }
  }
  return op;
}

test("random concurrent edits converge", () => {
  const next = rng(42);
  for (let n = 0; n < 2000; n += 1) {
    const doc = "abcdefghij".slice(0, Math.floor(next() * 11));
    converges(doc, randomOp(doc, next), randomOp(doc, next));
  }
});
