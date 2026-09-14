import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MD_PREVIEW_KEY,
  readMdPreviewMode,
  type MdPreviewMode,
} from "../md-live-preview";

test("a remembered choice is read back, junk is off", () => {
  // localStorage is a browser thing; the module guards for it, so the test
  // provides the smallest window it needs.
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  };
  try {
    assert.equal(readMdPreviewMode(), "off");
    store.set(MD_PREVIEW_KEY, "side");
    assert.equal<MdPreviewMode>(readMdPreviewMode(), "side");
    store.set(MD_PREVIEW_KEY, "below");
    assert.equal<MdPreviewMode>(readMdPreviewMode(), "below");
    // Anything the key does not hold reads as off: a stale value from an
    // older spelling is a preference reset, not a crash.
    store.set(MD_PREVIEW_KEY, "diagonal");
    assert.equal(readMdPreviewMode(), "off");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
