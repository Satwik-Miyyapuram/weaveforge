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

test("every row is one menu item, so every row is the same height", () => {
  // The rows were links, buttons and a theme button with their own classes, so
  // the menu had three heights (DA-97). Each is a menu item now; `.wf-item`
  // alone sizes them.
  const src = read("../header-actions.tsx");
  const menu = src.slice(src.indexOf("const links ="));
  assert.doesNotMatch(menu, /<(?:Link|a|button|RowButton)\b/);
  assert.doesNotMatch(menu, /className="[^"]*(?:header-link|signout)/);
  assert.match(read("../theme-toggle.tsx"), /<MenuItemButton\b/);
  assert.match(src, /<div className="wf-menu">/);
  assert.match(read("../styles/overlays.css"), /\.popover-panel:has\(> \.wf-menu\) \{[^}]*padding: 0/);
  assert.match(read("../styles/overlays.css"), /\.account-menu-head \{/);
});

test("the lab you are in is a checked radio row; CSS draws its tick", () => {
  const src = read("../header-actions.tsx");
  assert.match(src, /<MenuItemButton\s+key=\{m\.orgId\}\s+kind="radio"\s+checked=\{m\.orgId === activeOrgId\}/);
  assert.doesNotMatch(src, /✓/);
});
