/**
 * The theme's stored keys are one list (xstate-11).
 *
 * The delete-account panel removed four of the eleven by hand, so a deleted
 * account left its surfaces, tint, tilt, scanlines, motion and custom theme on
 * the device. The list is pinned here so a new key has to be added on purpose.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { THEME_STORAGE_KEYS, clearStoredAppearance } from "@/lib/theme/theme";

const ELEVEN = [
  "thesis.mode",
  "thesis.theme",
  "thesis.theme.light",
  "thesis.theme.dark",
  "thesis.controlSize",
  "thesis.surfaces",
  "thesis.cardTint",
  "thesis.cardTilt",
  "thesis.scanlines",
  "thesis.reactiveMotion",
  "thesis.customTheme",
];

test("the theme key list is pinned at eleven keys", () => {
  assert.deepEqual([...THEME_STORAGE_KEYS].sort(), [...ELEVEN].sort());
});

test("clearing the appearance removes all eleven keys and nothing else", () => {
  const store = new Map<string, string>(ELEVEN.map((k) => [k, "x"]));
  store.set("thesis.projectId", "p1");
  const g = globalThis as Record<string, unknown>;
  const saved = g.localStorage;
  g.localStorage = { removeItem: (k: string) => void store.delete(k) };
  try {
    clearStoredAppearance();
  } finally {
    g.localStorage = saved;
  }
  assert.deepEqual([...store.keys()], ["thesis.projectId"]);
});

test("clearing the appearance with storage blocked does not throw", () => {
  const g = globalThis as Record<string, unknown>;
  const saved = g.localStorage;
  g.localStorage = {
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
  try {
    assert.doesNotThrow(() => clearStoredAppearance());
  } finally {
    g.localStorage = saved;
  }
});
