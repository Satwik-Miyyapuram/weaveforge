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

test("Sign out and Sign in line up with the rows above them", () => {
  // They carried only `signout`, so the shared nav item rule (states.css)
  // skipped them and they kept 12px padding and a 12px gap: the icon sat 2px
  // and the label 6px right of every other row.
  const src = read("../header-actions.tsx");
  const rows = [...src.matchAll(/<RowButton[^>]*?className="([^"]*\bsignout\b[^"]*)"/g)].map((m) => m[1]);
  assert.equal(rows.length, 2);
  for (const cls of rows) assert.match(cls!, /\bheader-link\b/);
});

test("opening the lab flyout does not restyle the account panel", () => {
  // The flyout's lab rows are `.proj-menu-item`s inside the account panel, so a
  // bare `:has(.proj-menu-item)` matched it the moment the flyout opened: the
  // panel's floor went 210px -> 220px, its gap and display changed, and it
  // jumped 12px up. The project panel's rule must skip the account panel.
  const css = read("../styles/overlays.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1]!.trim());
  const proj = selectors.filter((s) => /\.popover-panel:has\(\.proj-menu-item\)/.test(s));
  assert.ok(proj.length > 0, "a project panel rule");
  for (const s of proj) assert.match(s, /:not\(:has\(\.header-link, \.signout\)\)/, s);
});
