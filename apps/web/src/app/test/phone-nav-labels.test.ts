/**
 * The phone's floating bar gives each of its five items a fifth of the width.
 * The shared nav item style (states.css, `:root:root`) gave them the
 * sidebar's 10px side padding, so "Search" and "Library" ended in an ellipsis
 * on a 390px phone. The bar's own rule wins on phone widths and keeps the
 * label's room.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../styles/nav.css", import.meta.url)), "utf8");

test("the phone bar's items keep a slim side padding over the shared nav style", () => {
  const at = css.indexOf("@media (max-width: 899px)");
  assert.ok(at >= 0, "a phone-only block");
  const block = css.slice(at, css.indexOf("\n}", at));
  assert.match(block, /:root:root \.nav \.wf-nav \{[^}]*padding-inline:\s*2px/);
});

test("on the narrowest phones the labels step down a size to fit", () => {
  // At 320px an item has 44px for its label; "Library" needs 48 at 14px.
  const at = css.indexOf("@media (max-width: 359px)");
  assert.ok(at >= 0, "a narrow-phone block");
  const block = css.slice(at, css.indexOf("\n}", at));
  assert.match(block, /\.nav \.nav-label \{[^}]*font-size:\s*var\(--fs-xs\)/);
});
