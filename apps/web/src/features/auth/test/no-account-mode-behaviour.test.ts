/**
 * Behaviour of the no-account choice against the real Rust core and an
 * in-memory localStorage: a stored "1" reads back as local mode, and turning
 * the choice off clears the key.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadCore, readyCore } from "@/lib/rust-core";
import { isLocalMode, setLocalMode } from "@/backend/providers/files/no-account-mode";

const host = globalThis as { localStorage?: Storage };
const previous = host.localStorage;
const data = new Map<string, string>();
const memory = {
  getItem: (k: string) => data.get(k) ?? null,
  setItem: (k: string, v: string) => void data.set(k, String(v)),
  removeItem: (k: string) => void data.delete(k),
  clear: () => data.clear(),
  key: () => null,
  get length() {
    return data.size;
  },
} as unknown as Storage;

before(async () => {
  host.localStorage = memory;
  await loadCore();
});

after(() => {
  host.localStorage = previous;
});

test("a stored \"1\" reads back as local mode", () => {
  data.clear();
  data.set(readyCore().localModeKey(), "1");
  assert.equal(isLocalMode(), true);
});

test("nothing stored reads as not local mode", () => {
  data.clear();
  assert.equal(isLocalMode(), false);
});

test("setLocalMode(true) stores \"1\" and isLocalMode reads it back", () => {
  data.clear();
  setLocalMode(true);
  assert.equal(data.get(readyCore().localModeKey()), "1");
  assert.equal(isLocalMode(), true);
});

test("setLocalMode(false) clears the key and isLocalMode reads false", () => {
  data.clear();
  data.set(readyCore().localModeKey(), "1");
  setLocalMode(false);
  assert.equal(data.has(readyCore().localModeKey()), false);
  assert.equal(isLocalMode(), false);
});
