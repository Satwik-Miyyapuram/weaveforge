/**
 * Server appearance over this device's (11-12), and sanitizers that follow the
 * option lists (11-19).
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { UserAppearance } from "@weaveforge/core";
import { mergeServerAppearance } from "@/lib/theme/theme-persistence";
import { CARD_TINT_OPTIONS, THEME_BOOT_SCRIPT, sanitizeCardTint, sanitizeControlSize } from "@/lib/theme/theme";

const LOCAL: UserAppearance = {
  mode: "light",
  lightTheme: "brutal",
  darkTheme: "brutal-dark",
  controlSize: "default",
  surfaces: "borderless",
  reactiveMotion: false,
  cardTint: "full",
  cardTilt: true,
  scanlines: false,
  customTheme: undefined,
};

test("server fields win, missing ones come from this device", () => {
  const merged = mergeServerAppearance(LOCAL, { mode: "dark", cardTilt: false, reactiveMotion: true });
  assert.deepEqual(merged, { ...LOCAL, mode: "dark", cardTilt: false, reactiveMotion: true });
});

test("a null server field falls back to this device, except customTheme", () => {
  const server = { mode: null, controlSize: null, customTheme: null } as unknown as UserAppearance;
  const merged = mergeServerAppearance(LOCAL, server);
  assert.equal(merged.mode, "light");
  assert.equal(merged.controlSize, "default");
  assert.equal(merged.customTheme, null, "null customTheme means: remove the local one");
});

test("an absent customTheme keeps this device's", () => {
  const custom = { vars: {}, motionScale: 1 } as unknown as UserAppearance["customTheme"];
  const merged = mergeServerAppearance({ ...LOCAL, customTheme: custom }, { mode: "dark" });
  assert.equal(merged.customTheme, custom);
});

test("sanitizeCardTint keeps every listed tint and defaults the rest", () => {
  for (const { id } of CARD_TINT_OPTIONS) assert.equal(sanitizeCardTint(id), id);
  for (const bad of [null, undefined, "", "FULL", "toString"]) assert.equal(sanitizeCardTint(bad), "bar");
});

test("the boot script defaults the card tint to bar (D-26)", () => {
  assert.match(THEME_BOOT_SCRIPT, /\?ct:"bar"/);
  assert.doesNotMatch(THEME_BOOT_SCRIPT, /\?ct:"full"/);
});

test("sanitizeControlSize keeps every size and defaults the rest", () => {
  for (const id of ["compact", "default", "comfortable"]) assert.equal(sanitizeControlSize(id), id);
  for (const bad of [null, undefined, "", "huge", "constructor"]) assert.equal(sanitizeControlSize(bad), "default");
});
