import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeAppearance, parseUserAppearance } from "../../../src/features/settings/domain/user-appearance.js";

test("parseUserAppearance returns null for absent payloads", () => {
  assert.equal(parseUserAppearance(null), null);
  assert.equal(parseUserAppearance(undefined), null);
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
