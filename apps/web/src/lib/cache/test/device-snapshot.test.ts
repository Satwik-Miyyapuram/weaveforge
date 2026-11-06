import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { readDeviceSnapshot, writeDeviceSnapshot } from "../device-snapshot";

const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
const realWindow = g.window;

afterEach(() => {
  if (hadWindow) g.window = realWindow;
  else delete g.window;
});

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function app(storage = memoryStorage()) {
  g.window = { localStorage: storage, weaveforge: { fetchTitle: () => Promise.resolve({}) } };
  return storage;
}

test("the app reads back what it wrote", () => {
  app();
  writeDeviceSnapshot("projects", [{ id: "p1" }]);
  assert.deepEqual(readDeviceSnapshot("projects"), [{ id: "p1" }]);
});

test("a key sign-out wipes: it starts with weaveforge.", () => {
  const storage = app();
  writeDeviceSnapshot("projects", []);
  assert.deepEqual([...storage.map.keys()], ["weaveforge.snapshot.projects"]);
});

test("nothing stored, broken JSON or another version reads as none", () => {
  const storage = app();
  assert.equal(readDeviceSnapshot("projects"), null);
  storage.map.set("weaveforge.snapshot.projects", "{not json");
  assert.equal(readDeviceSnapshot("projects"), null);
  storage.map.set("weaveforge.snapshot.projects", JSON.stringify({ v: 999, value: [] }));
  assert.equal(readDeviceSnapshot("projects"), null);
  storage.map.set("weaveforge.snapshot.projects", JSON.stringify([{ id: "raw" }]));
  assert.equal(readDeviceSnapshot("projects"), null);
});

test("a browser neither writes nor reads a snapshot", () => {
  const storage = memoryStorage();
  g.window = { localStorage: storage };
  writeDeviceSnapshot("projects", [{ id: "p1" }]);
  assert.equal(storage.map.size, 0);
  storage.map.set("weaveforge.snapshot.projects", JSON.stringify({ v: 1, value: [{ id: "p1" }] }));
  assert.equal(readDeviceSnapshot("projects"), null);
});
