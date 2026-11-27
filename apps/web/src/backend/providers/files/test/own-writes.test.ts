/**
 * Own-write memory: the folder watcher must tell the app's own write echoing back
 * from an outside edit, so what the app wrote is remembered per path.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { forgetOwnWrites, isOwnWrite, recordOwnWrite } from "../own-writes";

test("an own text write matches only its exact text at its path", () => {
  forgetOwnWrites();
  recordOwnWrite("a.md", "x");
  assert.equal(isOwnWrite("a.md", "x"), true);
  assert.equal(isOwnWrite("a.md", "y"), false);
  assert.equal(isOwnWrite("b.md", "x"), false);
});

test("a later own write at the same path replaces the earlier one", () => {
  forgetOwnWrites();
  recordOwnWrite("a.md", "x");
  recordOwnWrite("a.md", "y");
  assert.equal(isOwnWrite("a.md", "x"), false);
  assert.equal(isOwnWrite("a.md", "y"), true);
});

test("a binary own write is matched by path alone", () => {
  forgetOwnWrites();
  recordOwnWrite("p.pdf", new Uint8Array([1, 2]));
  assert.equal(isOwnWrite("p.pdf", "anything"), true);
});

test("forgetOwnWrites clears everything remembered", () => {
  forgetOwnWrites();
  recordOwnWrite("a.md", "y");
  forgetOwnWrites();
  assert.equal(isOwnWrite("a.md", "y"), false);
});

test("the memory is bounded: the oldest path is forgotten first", () => {
  forgetOwnWrites();
  for (let i = 0; i < 2100; i++) recordOwnWrite(`f-${i}.md`, `t-${i}`);
  assert.equal(isOwnWrite("f-0.md", "t-0"), false);
  assert.equal(isOwnWrite("f-2099.md", "t-2099"), true);
});
