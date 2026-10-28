import { test } from "node:test";
import assert from "node:assert/strict";

import { MD_PREVIEW_KEY, readMdPreviewMode, type MdPreviewMode } from "@/lib/hooks/use-md-preview-mode";
import { previewBody } from "../md-live-preview";

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

test("a storage that throws reads as off (28-05)", () => {
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: () => {
        throw new Error("SecurityError");
      },
    },
  };
  try {
    assert.equal(readMdPreviewMode(), "off");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});

test("the preview shows the editor's text, even when emptied (28-10)", () => {
  assert.equal(previewBody(null, "saved"), "saved");
  assert.equal(previewBody("", "saved"), "");
  assert.equal(previewBody("  \n", "saved"), "  \n");
  assert.equal(previewBody("live", "saved"), "live");
});
