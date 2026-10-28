/**
 * The sidebar scrolls, and on a short window the current destination could sit
 * below its fold: on Log at 1426×836 the highlighted row was cut in half by the
 * account block. The column now scrolls just enough to show the current row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scrollTopToReveal } from "../reveal-active-nav";

const view = { top: 120, bottom: 750 };

test("a row already in view does not move the column", () => {
  assert.equal(scrollTopToReveal({ top: 200, bottom: 244 }, view, 0), 0);
  assert.equal(scrollTopToReveal({ top: 120, bottom: 750 }, view, 40), 40, "a row exactly filling the view stays");
});

test("a row below the fold scrolls up just enough to show it whole", () => {
  assert.equal(scrollTopToReveal({ top: 740, bottom: 784 }, view, 0), 34);
  assert.equal(scrollTopToReveal({ top: 900, bottom: 944 }, view, 10), 204);
});

test("a row above the fold scrolls down to its top", () => {
  assert.equal(scrollTopToReveal({ top: 80, bottom: 124 }, view, 100), 60);
});

test("the sidebar reveals its current row on every move", () => {
  const tabbar = readFileSync(fileURLToPath(new URL("../tabbar.tsx", import.meta.url)), "utf8");
  assert.match(tabbar, /revealActiveNav\(navScrollRef\.current\)/);
  assert.match(tabbar, /\[pathname, openGroups\]/, "after a move and after a group opens or folds");
});
