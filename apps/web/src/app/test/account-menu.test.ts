/**
 * The account menu says whose it is and reads plainly (DA-97): a header with
 * the person's name and email, the theme row states the theme rather than
 * looking like an action or a state, and every row is one height.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the menu opens on who is signed in", () => {
  const src = read("../header-actions.tsx");
  const menu = src.slice(src.indexOf("<Popover"));
  assert.match(menu, /className="account-menu-head"/);
  assert.match(menu, /profile\?\.fullName/);
  assert.match(menu, /user\.email/);
});

test("the theme row names the setting and its value", () => {
  const src = read("../theme-toggle.tsx");
  assert.doesNotMatch(src, /"Light mode"|"Dark mode"/);
  assert.match(src, /<span>Theme<\/span>/);
  assert.match(src, /className="menu-row-value"/);
  assert.match(src, /aria-label=\{`Theme: \$\{/);
});

test("every row in an account panel is the same height", () => {
  const css = read("../styles/overlays.css");
  const at = css.indexOf(".popover-panel .signout {");
  const rows = css.slice(at, css.indexOf("}", at));
  assert.match(rows, /border: 0/);
  assert.match(rows, /font: inherit/);
  assert.match(rows, /min-height: 36px/);
  assert.match(css, /\.account-menu-head \{/);
});
