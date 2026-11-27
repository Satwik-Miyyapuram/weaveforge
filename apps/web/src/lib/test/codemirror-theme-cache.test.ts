/**
 * A theme switch must not rebuild every editor's CodeMirror theme.
 *
 * The chrome reads CSS variables, so only light/dark changes the extension.
 * Rebuilding it per editor on every data-theme change injected fresh style
 * modules and forced a ~200 ms style recalc per open editor (32 editors made
 * a 6 s freeze). What is pinned: one extension per mode, reused.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createCodeMirrorThemeForSite } from "../theme/codemirror-theme";

test("the same mode returns the same extension", () => {
  assert.equal(createCodeMirrorThemeForSite("dark"), createCodeMirrorThemeForSite("dark"));
  assert.equal(createCodeMirrorThemeForSite("light"), createCodeMirrorThemeForSite("light"));
});

test("light and dark differ", () => {
  assert.notEqual(createCodeMirrorThemeForSite("dark"), createCodeMirrorThemeForSite("light"));
});
