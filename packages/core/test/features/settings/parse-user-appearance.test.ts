import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD_TINTS, CONTROL_SIZES, normalizeAppearance } from "../../../src/features/settings/domain/user-appearance.js";

test("normalizeAppearance returns undefined for absent payloads", () => {
  assert.equal(normalizeAppearance(null), undefined);
  assert.equal(normalizeAppearance(undefined), undefined);
});

test("normalizeAppearance accepts every listed control size and card tint, nothing else (05-19)", () => {
  assert.deepEqual([...CONTROL_SIZES], ["compact", "default", "comfortable"]);
  assert.deepEqual([...CARD_TINTS], ["full", "bar", "border", "none"]);
  for (const controlSize of CONTROL_SIZES) assert.deepEqual(normalizeAppearance({ controlSize }), { controlSize });
  for (const cardTint of CARD_TINTS) assert.deepEqual(normalizeAppearance({ cardTint }), { cardTint });
  for (const bad of ["Compact", "", "length", 1, null]) {
    assert.equal(normalizeAppearance({ controlSize: bad, cardTint: bad }), undefined, String(bad));
  }
});

test("normalizeAppearance keeps valid fields only", () => {
  assert.deepEqual(normalizeAppearance({ mode: "dark", lightTheme: "latte", darkTheme: "dracula" }), {
    mode: "dark",
    lightTheme: "latte",
    darkTheme: "dracula",
  });
  assert.deepEqual(normalizeAppearance({ mode: "auto", lightTheme: "  ", darkTheme: "mocha" }), {
    darkTheme: "mocha",
  });
  assert.deepEqual(normalizeAppearance({ controlSize: "compact", mode: "light" }), {
    mode: "light",
    controlSize: "compact",
  });
  assert.deepEqual(normalizeAppearance({ controlSize: "huge" }), undefined);
  assert.equal(normalizeAppearance({}), undefined);
});

test("normalizeAppearance keeps the CRT tilt and scanline switches when boolean", () => {
  assert.deepEqual(normalizeAppearance({ cardTilt: false, scanlines: true }), { cardTilt: false, scanlines: true });
  assert.equal(normalizeAppearance({ cardTilt: "off", scanlines: 0 }), undefined);
});
