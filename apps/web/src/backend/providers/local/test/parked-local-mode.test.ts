import { afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { loadTestCore } from "@/lib/test/load-test-core";
import { isLocalMode, parkLocalMode, resumeParkedLocalMode, setLocalMode } from "../local-identity";

// A no-account window on a folder still on the database starts on sign-in so the upgrade can run;
// the choice waits and comes back once the folder is on files.
const store = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

before(loadTestCore);
beforeEach(() => {
  store.clear();
  (globalThis as { window?: unknown }).window = fakeWindow;
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

test("a parked choice leaves local mode and comes back once the folder is on files", () => {
  setLocalMode(true);
  parkLocalMode();
  assert.equal(isLocalMode(), false, "sign-in while the folder upgrades");
  assert.equal(resumeParkedLocalMode(false), false, "not yet on files");
  assert.equal(isLocalMode(), false);
  assert.equal(resumeParkedLocalMode(true), true);
  assert.equal(isLocalMode(), true);
  assert.equal(resumeParkedLocalMode(true), false, "restored once");
});

test("choosing either way while parked drops the parked choice", () => {
  parkLocalMode();
  setLocalMode(false);
  assert.equal(resumeParkedLocalMode(true), false);
  assert.equal(isLocalMode(), false);
});

test("nothing parked: a folder on files does not turn local mode on", () => {
  assert.equal(resumeParkedLocalMode(true), false);
  assert.equal(isLocalMode(), false);
});
