import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { renderHook } from "./react-harness.js";
import { projectScopedKey, usePersistedState } from "@/lib/hooks/use-persisted-state";

const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
const realWindow = g.window;
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  g.window = {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    },
  };
});

afterEach(() => {
  if (hadWindow) g.window = realWindow;
  else delete g.window;
});

test("a project id scopes the key; no project keeps the plain key", () => {
  assert.equal(projectScopedKey("thesis.papers.tags", "p1"), "thesis.papers.tags.p1");
  assert.equal(projectScopedKey("thesis.papers.tags", null), "thesis.papers.tags");
  assert.equal(projectScopedKey("thesis.papers.tags", undefined), "thesis.papers.tags");
  assert.equal(projectScopedKey("thesis.papers.tags", ""), "thesis.papers.tags");
});

test("the stored value loads after mount and changes are written back", async () => {
  data.set("k.p1", JSON.stringify(["a"]));
  const h = await renderHook((key: string) => usePersistedState<string[]>(key, []), "k.p1" as string);
  assert.deepEqual(h.current[0], ["a"]);
  const set = h.current[1];
  set(["a", "b"]);
  await h.flush();
  assert.deepEqual(JSON.parse(data.get("k.p1")!), ["a", "b"]);
  await h.unmount();
});

test("switching to a project with nothing stored starts from the initial value", async () => {
  data.set("k.p1", JSON.stringify(["only-p1"]));
  const h = await renderHook((key: string) => usePersistedState<string[]>(key, []), "k.p1" as string);
  assert.deepEqual(h.current[0], ["only-p1"]);

  await h.rerender("k.p2");
  await h.flush();
  assert.deepEqual(h.current[0], []);
  // Project 1's filter must not leak into project 2's record.
  assert.notDeepEqual(JSON.parse(data.get("k.p2") ?? "[]"), ["only-p1"]);
  assert.deepEqual(JSON.parse(data.get("k.p1")!), ["only-p1"]);
  await h.unmount();
});

test("switching between projects restores each one's own value", async () => {
  data.set("k.p1", JSON.stringify("one"));
  data.set("k.p2", JSON.stringify("two"));
  const h = await renderHook((key: string) => usePersistedState<string>(key, ""), "k.p1" as string);
  assert.equal(h.current[0], "one");
  await h.rerender("k.p2");
  await h.flush();
  assert.equal(h.current[0], "two");
  await h.rerender("k.p1");
  await h.flush();
  assert.equal(h.current[0], "one");
  assert.equal(JSON.parse(data.get("k.p1")!), "one");
  assert.equal(JSON.parse(data.get("k.p2")!), "two");
  await h.unmount();
});
