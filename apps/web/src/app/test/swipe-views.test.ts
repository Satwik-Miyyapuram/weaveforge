import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeTarget } from "../swipe-views";

const items = ["papers", "lists", "graph"];

test("swipe left moves to the next tab, right to the previous", () => {
  assert.equal(swipeTarget(items, 1, -80), "graph");
  assert.equal(swipeTarget(items, 1, 80), "papers");
});

test("swiping past either end goes nowhere", () => {
  assert.equal(swipeTarget(items, 2, -80), undefined);
  assert.equal(swipeTarget(items, 0, 80), undefined);
});

test("a view that is not one of the phone tabs goes nowhere, not to the first tab (14-15)", () => {
  assert.equal(swipeTarget(items, -1, -80), undefined);
  assert.equal(swipeTarget(items, -1, 80), undefined);
});
