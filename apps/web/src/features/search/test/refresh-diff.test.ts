import assert from "node:assert/strict";
import test, { before } from "node:test";
import type { SearchDoc } from "@weaveforge/core";

import { loadTestCore } from "@/lib/test/load-test-core";
import { readyCore } from "@/lib/rust-core";

before(async () => {
  await loadTestCore();
});

const doc = (id: string, body: string, degree = 0): SearchDoc => ({
  id: `note:${id}`,
  kind: "note",
  entityId: id,
  title: id,
  aliases: [],
  headings: [],
  tags: [],
  path: "",
  body,
  updatedAt: "2026-01-01T00:00:00.000Z",
  href: `/notes/${id}`,
  degree,
});

test("with nothing remembered, every fresh doc is (re-)added and the gone one removed", () => {
  const out = readyCore().diffRefreshPlan(new Map(), ["note:a", "note:gone"], [doc("a", "x")]);
  assert.deepEqual(out.remove, ["note:gone"]);
  assert.deepEqual(out.add.map((d) => d.id), ["note:a"]);
});

test("an unchanged doc is left alone; an edited one is re-added", () => {
  const first = readyCore().diffRefreshPlan(new Map(), [], [doc("a", "x"), doc("b", "y")]);
  const out = readyCore().diffRefreshPlan(first.prints, ["note:a", "note:b"], [doc("a", "x"), doc("b", "edited")]);
  assert.deepEqual(out.remove, []);
  assert.deepEqual(out.add.map((d) => d.id), ["note:b"]);
});

test("a deleted doc is removed, and forgotten", () => {
  const first = readyCore().diffRefreshPlan(new Map(), [], [doc("a", "x"), doc("b", "y")]);
  const out = readyCore().diffRefreshPlan(first.prints, ["note:a", "note:b"], [doc("a", "x")]);
  assert.deepEqual(out.remove, ["note:b"]);
  assert.deepEqual(out.add, []);
  assert.equal(out.prints.has("note:b"), false);
});

test("a new link degree counts as a change, since it ranks the doc", () => {
  const first = readyCore().diffRefreshPlan(new Map(), [], [doc("a", "x", 0)]);
  const out = readyCore().diffRefreshPlan(first.prints, ["note:a"], [doc("a", "x", 2)]);
  assert.deepEqual(out.add.map((d) => d.id), ["note:a"]);
});

test("a remembered doc the index no longer holds is added back", () => {
  const first = readyCore().diffRefreshPlan(new Map(), [], [doc("a", "x")]);
  const out = readyCore().diffRefreshPlan(first.prints, [], [doc("a", "x")]);
  assert.deepEqual(out.add.map((d) => d.id), ["note:a"]);
});

test("prints from other kinds survive a refresh of one kind", () => {
  const prints = new Map([["paper:p", "{}"]]);
  const out = readyCore().diffRefreshPlan(prints, [], [doc("a", "x")]);
  assert.equal(out.prints.get("paper:p"), "{}");
});
