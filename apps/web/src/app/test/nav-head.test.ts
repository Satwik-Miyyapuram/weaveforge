/** The sidebar head: the brand goes Home, a separate chevron folds the sidebar (DA-89). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const tabbar = read("../tabbar.tsx");
const nav = read("../styles/nav.css");

test("the brand is a link Home, not the collapse control", () => {
  const brand = tabbar.match(/<Link[^>]*className="nav-brand"[^>]*>/s)?.[0];
  assert.ok(brand, "no nav-brand link");
  assert.match(brand, /href=\{homeNavItem\.path\}/);
  assert.doesNotMatch(brand, /onToggle/);
});

test("collapsing is its own labelled button", () => {
  const button = tabbar.match(/<IconButton[^>]*onClick=\{onToggle\}[^>]*>/s)?.[0];
  assert.ok(button, "no nav-collapse button");
  assert.match(button, /onClick=\{onToggle\}/);
  assert.match(button, /aria-expanded=\{!collapsed\}/);
  assert.match(button, /label=/);
  assert.doesNotMatch(tabbar, /nav-brand-toggle/);
  assert.doesNotMatch(nav, /nav-brand-toggle/);
});

test("the rail separates its groups with a short rule (DA-87)", () => {
  assert.match(nav, /\.layout\.nav-collapsed \.nav-group::before\s*\{[^}]*height:\s*1px;[^}]*background:\s*var\(--line\)/);
});

test("the rail names its icons with a styled tip, not the slow native one (DA-87)", () => {
  const tip = read("../rail-tip.tsx");
  assert.match(tip, /role="tooltip"/);
  assert.match(tabbar, /useRailTip\(collapsed\)/);
  // A native title would show a second, slower tip over the styled one.
  assert.doesNotMatch(tabbar, /title=\{collapsed \? (item|homeNavItem)\.label/);
  assert.doesNotMatch(tabbar, /title=\{collapsed \? "Search"/);
  assert.match(nav, /\.rail-tip\s*\{/);
});
