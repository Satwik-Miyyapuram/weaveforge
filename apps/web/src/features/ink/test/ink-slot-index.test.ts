// A page slot names its index in `data-page` (a static slot) or `data-ghost`
// (a placeholder). Scroll tracking and hit-testing read it through one helper.
import { test } from "node:test";
import assert from "node:assert/strict";

import { slotIndex } from "../ui/use-ink-layout";

const slot = (attrs: Record<string, string>) => ({
  getAttribute: (name: string) => attrs[name] ?? null,
});

test("a static slot's data-page parses", () => {
  assert.equal(slotIndex(slot({ "data-page": "3" })), 3);
});

test("a placeholder slot's data-ghost parses", () => {
  assert.equal(slotIndex(slot({ "data-ghost": "7" })), 7);
});

test("page zero is an index, not a miss", () => {
  assert.equal(slotIndex(slot({ "data-ghost": "0" })), 0);
});

test("data-page wins when a slot carries both", () => {
  assert.equal(slotIndex(slot({ "data-page": "2", "data-ghost": "5" })), 2);
});

test("a slot with no index, or a junk one, is null", () => {
  assert.equal(slotIndex(slot({})), null);
  assert.equal(slotIndex(slot({ "data-page": "" })), null);
  assert.equal(slotIndex(slot({ "data-ghost": "abc" })), null);
});
