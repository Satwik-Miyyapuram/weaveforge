import assert from "node:assert/strict";
import { test } from "node:test";
import { ANIMATION_SPEEDS, CARD_TINTS, CONTROL_SIZES } from "../../../src/features/settings/domain/user-appearance.js";
import { rust } from "../../../src/shared/rust.js";

test("normalizeAppearance returns undefined for absent payloads", () => {
  assert.equal(rust().normalizeAppearance(null), undefined);
  assert.equal(rust().normalizeAppearance(undefined), undefined);
});

test("normalizeAppearance accepts every listed control size and card tint, nothing else (05-19)", () => {
  assert.deepEqual([...CONTROL_SIZES], ["compact", "default", "comfortable"]);
  assert.deepEqual([...CARD_TINTS], ["full", "bar", "border", "none"]);
  for (const controlSize of CONTROL_SIZES) assert.deepEqual(rust().normalizeAppearance({ controlSize }), { controlSize });
  for (const cardTint of CARD_TINTS) assert.deepEqual(rust().normalizeAppearance({ cardTint }), { cardTint });
  for (const bad of ["Compact", "", "length", 1, null]) {
    assert.equal(rust().normalizeAppearance({ controlSize: bad, cardTint: bad }), undefined, String(bad));
  }
});

test("normalizeAppearance keeps valid fields only", () => {
  assert.deepEqual(rust().normalizeAppearance({ mode: "dark", lightTheme: "latte", darkTheme: "dracula" }), {
    mode: "dark",
    lightTheme: "latte",
    darkTheme: "dracula",
  });
  assert.deepEqual(rust().normalizeAppearance({ mode: "auto", lightTheme: "  ", darkTheme: "mocha" }), {
    darkTheme: "mocha",
  });
  assert.deepEqual(rust().normalizeAppearance({ controlSize: "compact", mode: "light" }), {
    mode: "light",
    controlSize: "compact",
  });
  assert.deepEqual(rust().normalizeAppearance({ controlSize: "huge" }), undefined);
  assert.equal(rust().normalizeAppearance({}), undefined);
});

test("normalizeAppearance keeps the CRT tilt and scanline switches when boolean", () => {
  assert.deepEqual(rust().normalizeAppearance({ cardTilt: false, scanlines: true }), { cardTilt: false, scanlines: true });
  assert.equal(rust().normalizeAppearance({ cardTilt: "off", scanlines: 0 }), undefined);
});

test("normalizeAppearance keeps an animation speed from the list, nothing else", () => {
  assert.deepEqual([...ANIMATION_SPEEDS], [0.25, 0.5, 1, 2, 4]);
  for (const animationSpeed of ANIMATION_SPEEDS) {
    assert.deepEqual(rust().normalizeAppearance({ animationSpeed }), { animationSpeed });
  }
  for (const bad of [0, 3, 8, -1, "2", null, Number.NaN]) {
    assert.equal(rust().normalizeAppearance({ animationSpeed: bad }), undefined, String(bad));
  }
});
