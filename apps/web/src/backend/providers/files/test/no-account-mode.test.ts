/**
 * The no-account flag: turning it on must stick, or setLocalMode throws so the
 * sign-in screen shows why instead of reloading back onto itself.
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { resetStorageWarning } from "@/lib/safe-storage";
import { isLocalMode, setLocalMode } from "../no-account-mode";

const host = globalThis as { localStorage?: Storage };
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

function memoryStorage(overrides: Partial<Storage> = {}): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => { map.delete(k); },
    setItem: (k, v) => { map.set(k, String(v)); },
    ...overrides,
  };
}

function useStorage(store: Storage | undefined): void {
  Object.defineProperty(globalThis, "localStorage", { value: store, configurable: true, writable: true });
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete host.localStorage;
  resetStorageWarning();
});

test("on and off round-trip through storage", () => {
  useStorage(memoryStorage());
  setLocalMode(true);
  assert.equal(isLocalMode(), true);
  setLocalMode(false);
  assert.equal(isLocalMode(), false);
});

test("a write that throws (storage denied or full) is reported, not swallowed", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    useStorage(memoryStorage({ setItem: () => { throw new Error("QuotaExceededError"); } }));
    assert.throws(() => setLocalMode(true), /Could not remember this choice/);
    assert.equal(isLocalMode(), false);
  } finally {
    console.warn = warn;
  }
});

test("no storage at all is reported too", () => {
  useStorage(undefined);
  assert.throws(() => setLocalMode(true), /Could not remember this choice/);
});

test("turning it off never throws, even with no storage", () => {
  useStorage(undefined);
  assert.doesNotThrow(() => setLocalMode(false));
});
