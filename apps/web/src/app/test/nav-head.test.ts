/** The sidebar head: one button, the mark and the chevron together, folds the sidebar. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const tabbar = read("../tabbar.tsx");
const nav = read("../styles/nav.css");

test("the head is one catalogue nav button holding the mark, the name and the chevron", () => {
  const head = tabbar.match(/<div className="nav-head">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(head, /^\s*<NavButton[^>]*onClick=\{onToggle\}/);
  assert.match(head, /aria-expanded=\{!collapsed\}/);
  assert.match(head, /<WeaveForgeLogo/);
  assert.match(head, /<ChevronIcon/);
  // One button: no second control and no separate brand link.
  assert.equal(head.match(/<(NavButton|IconButton|Link|Button)\b/g)?.length, 1);
  assert.doesNotMatch(tabbar, /nav-brand/);
  assert.doesNotMatch(nav, /nav-brand/);
});

test("rail items keep the square nav radius, never a pill", () => {
  const rail = /:root:root \.layout\.nav-collapsed \.nav \.wf-nav,[^{]*\{[^}]*\}/.exec(nav)?.[0] ?? "";
  assert.ok(rail, "no rail item rule");
  assert.doesNotMatch(rail, /r-pill|50%/);
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

test("the head's chevron turns with the sidebar: its rule targets the .chev span ChevronIcon renders", () => {
  assert.doesNotMatch(nav, /\.nav-head > \.wf-nav > svg/);
  assert.match(nav, /\.nav-head > \.wf-nav > \.chev \{[^}]*transform: rotate\(90deg\)/);
  assert.match(nav, /\.nav-head > \.wf-nav\[aria-expanded="false"\] > \.chev \{[^}]*transform: rotate\(-90deg\)/);
});

test("the account button stands as tall as the project chip beside it, and square", () => {
  assert.match(nav, /\.layout:not\(\.nav-collapsed\) \.nav-account-row > \.popover \{[^}]*align-self: stretch;/);
  assert.match(nav, /\.layout:not\(\.nav-collapsed\) \.nav-account-row > \.popover > \.wf-btn \{[^}]*height: 100%;[^}]*aspect-ratio: 1;/);
});
