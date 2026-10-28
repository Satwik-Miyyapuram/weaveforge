/** Which sidebar groups are unfolded, and that the choice survives a restart (DA-88). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadOpenGroups, saveOpenGroups, toggleGroup, withActive } from "../nav-open-groups";

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

test("the group you are in is open even on first run", () => {
  assert.deepEqual(loadOpenGroups(memory(), "work"), ["work"]);
});

test("groups the reader opened stay open after a restart", () => {
  const store = memory();
  saveOpenGroups(store, ["library", "write"]);
  assert.deepEqual(loadOpenGroups(store, "work"), ["library", "write", "work"]);
});

test("the current group is not added twice", () => {
  assert.deepEqual(withActive(["work"], "work"), ["work"]);
  assert.deepEqual(withActive(["work"], null), ["work"]);
});

test("toggling opens a closed group and closes an open one", () => {
  assert.deepEqual(toggleGroup(["work"], "library"), ["work", "library"]);
  assert.deepEqual(toggleGroup(["work", "library"], "work"), ["library"]);
});

test("broken or blocked storage falls back to the current group", () => {
  assert.deepEqual(loadOpenGroups(memory({ "weaveforge.nav.openGroups": "{not json" }), "write"), ["write"]);
  assert.deepEqual(loadOpenGroups(memory({ "weaveforge.nav.openGroups": '{"a":1}' }), null), []);
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.deepEqual(loadOpenGroups(throwing, "work"), ["work"]);
  assert.doesNotThrow(() => saveOpenGroups(throwing, ["work"]));
  assert.deepEqual(loadOpenGroups(undefined, "work"), ["work"]);
});
