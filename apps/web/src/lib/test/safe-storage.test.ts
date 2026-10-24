import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import {
  readStored,
  readStoredJson,
  removeStored,
  resetStorageWarning,
  writeStored,
  writeStoredJson,
} from "../safe-storage";

const g = globalThis as { window?: unknown };
const hadWindow = "window" in g;
const realWindow = g.window;
const realWarn = console.warn;
let warnings: unknown[][] = [];

beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => void warnings.push(args);
  resetStorageWarning();
});

afterEach(() => {
  console.warn = realWarn;
  if (hadWindow) g.window = realWindow;
  else delete g.window;
});

function memoryStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

function throwingStorage() {
  const fail = () => {
    throw new Error("SecurityError: storage is disabled");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

test("reads, writes and removes in localStorage by default", () => {
  const local = memoryStorage({ a: "1" });
  g.window = { localStorage: local, sessionStorage: memoryStorage() };
  assert.equal(readStored("a"), "1");
  assert.equal(readStored("missing"), null);
  writeStored("b", "2");
  assert.equal(local.map.get("b"), "2");
  removeStored("a");
  assert.equal(local.map.has("a"), false);
  assert.equal(warnings.length, 0);
});

test("the session area is sessionStorage, kept apart from local", () => {
  const local = memoryStorage();
  const session = memoryStorage({ s: "x" });
  g.window = { localStorage: local, sessionStorage: session };
  assert.equal(readStored("s", "session"), "x");
  assert.equal(readStored("s"), null);
  writeStored("t", "y", "session");
  assert.equal(session.map.get("t"), "y");
  assert.equal(local.map.has("t"), false);
  removeStored("s", "session");
  assert.equal(session.map.has("s"), false);
});

test("throwing storage gives null and no throw, and warns once", () => {
  g.window = { localStorage: throwingStorage(), sessionStorage: throwingStorage() };
  assert.equal(readStored("a"), null);
  assert.doesNotThrow(() => writeStored("a", "1"));
  assert.doesNotThrow(() => removeStored("a"));
  assert.equal(readStored("a", "session"), null);
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0]![0]), /storage/i);
});

test("a storage getter that throws (blocked cookies) is handled the same way", () => {
  g.window = {
    get localStorage(): never {
      throw new Error("SecurityError: access denied");
    },
  };
  assert.equal(readStored("a"), null);
  assert.doesNotThrow(() => writeStored("a", "1"));
  assert.equal(warnings.length, 1);
});

test("no window (server render) is quiet: null, no throw, no warning", () => {
  delete g.window;
  assert.equal(readStored("a"), null);
  assert.doesNotThrow(() => writeStored("a", "1"));
  assert.doesNotThrow(() => removeStored("a"));
  assert.equal(readStoredJson("a", 7), 7);
  assert.equal(warnings.length, 0);
});

test("without a window, a global localStorage is used; no store at all is quiet", () => {
  delete g.window;
  const globals = globalThis as { localStorage?: unknown };
  const local = memoryStorage({ a: "1" });
  globals.localStorage = local;
  try {
    assert.equal(readStored("a"), "1");
    writeStored("b", "2");
    assert.equal(local.map.get("b"), "2");
  } finally {
    delete globals.localStorage;
  }
  g.window = {};
  assert.equal(readStored("a"), null);
  assert.doesNotThrow(() => writeStored("a", "1"));
  assert.equal(warnings.length, 0);
});

test("JSON: round trip, and the fallback for missing or malformed values", () => {
  const local = memoryStorage({ bad: "{not json" });
  g.window = { localStorage: local };
  writeStoredJson("obj", { n: 1, list: ["a"] });
  assert.equal(local.map.get("obj"), '{"n":1,"list":["a"]}');
  assert.deepEqual(readStoredJson("obj", null), { n: 1, list: ["a"] });
  assert.deepEqual(readStoredJson("missing", { d: true }), { d: true });
  assert.equal(readStoredJson("bad", "fallback"), "fallback");
  // A malformed value is data, not a broken store: no warning.
  assert.equal(warnings.length, 0);
});

test("JSON: a stored null reads back as null, not the fallback", () => {
  g.window = { localStorage: memoryStorage({ n: "null" }) };
  assert.equal(readStoredJson<string | null>("n", "fallback"), null);
});
