/**
 * `errorMessage` is the one spelling of `x instanceof Error ? x.message : ...`
 * (xhelp-01). Every inline copy it replaced must read the same text.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorMessage, NotFoundError } from "../../src/index.js";

test("an Error gives its message, subclasses included", () => {
  assert.equal(errorMessage(new Error("boom")), "boom");
  assert.equal(errorMessage(new TypeError("bad type")), "bad type");
  assert.equal(errorMessage(new NotFoundError("gone")), "gone");
});

test("an Error with an empty message gives the empty message, even with a fallback", () => {
  assert.equal(errorMessage(new Error("")), "");
  assert.equal(errorMessage(new Error(""), "fallback"), "");
});

test("anything else is stringified", () => {
  assert.equal(errorMessage("offline"), "offline");
  assert.equal(errorMessage(42), "42");
  assert.equal(errorMessage(undefined), "undefined");
  assert.equal(errorMessage(null), "null");
  assert.equal(errorMessage({ message: "not an Error" }), "[object Object]");
});

test("a fallback replaces the stringified non-Error", () => {
  assert.equal(errorMessage("offline", "Could not save."), "Could not save.");
  assert.equal(errorMessage(undefined, "Could not save."), "Could not save.");
  assert.equal(errorMessage({ message: "x" }, ""), "");
  assert.equal(errorMessage(new Error("real"), "Could not save."), "real");
});

test("a thrown value whose toString throws still gets a message from the fallback", () => {
  const hostile = { toString() { throw new Error("no"); } };
  assert.equal(errorMessage(hostile, "fallback"), "fallback");
});
