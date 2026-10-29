/**
 * The account button sits beside the project chip and must move like it.
 *
 * It once had its own class, which jumped on hover and pressed a different
 * distance from its neighbour. Then it was a ghost icon button: flat at rest
 * beside a chip with a shadow, so hovering it alone grew a shadow from nothing.
 * It is now the chip's own secondary button, without the caret, so the two rest
 * and lift alike.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the account trigger is the chip's secondary button, without a caret", () => {
  const src = read("../header-actions.tsx");
  const block = /<Popover\s[\s\S]*?ariaLabel=[^\n]*"Account"[\s\S]*?label=/.exec(src)?.[0] ?? "";
  assert.ok(block, "account popover found");
  assert.match(block, /caret=\{false\}/);
  assert.match(block, /trigger=\{alone \? "icon" : "button"\}/);
  assert.doesNotMatch(block, /triggerClassName|iconOnly/);
});

test("the brutal themes add no hover effect of their own to the account row", () => {
  const css = read("../styles/brutal.css");
  assert.doesNotMatch(css, /\.nav-account-row[^{]*:hover\s*\{/);
});

test("an open popover's button stays sunk at the press depth", () => {
  // Pressing sinks a button by --wf-press; an open menu keeps its trigger there,
  // so it does not pop back up on release.
  const css = read("../styles/states.css");
  assert.match(css, /\.wf-btn\[aria-expanded="true"\] \{ translate: var\(--wf-press\) var\(--wf-press\); box-shadow: none;/);
});

test("the account button sits on the project chip's centre line, not at the row's top", () => {
  // The row stretches its children to the chip's height; the account popover
  // must centre its shorter icon button rather than pin it to the top.
  const css = read("../styles/nav.css");
  assert.match(css, /\.nav-account-row > \.popover \{ align-self: center; \}/);
});

test("a caret-less trigger keeps an icon's size and puts its count on the corner", () => {
  // As a plain secondary button its icon shrank to a few pixels beside the
  // inline count, which the button then clipped.
  const css = read("../styles/shell.css");
  const bare = String.raw`.popover > .wf-btn:not(.wf-icon, :has(.popover-caret))`;
  assert.ok(css.includes(`${bare} > svg { width: 18px; height: 18px; flex: none; }`), "icon sized");
  // Not `.popover:has(... :has())`: nested :has is invalid and drops the whole rule.
  assert.ok(css.includes(".popover > .wf-btn:not(:has(.popover-caret)) > .popover-badge {"), "count on the corner");
  assert.doesNotMatch(css, /:has\([^)]*:has\(/, "no nested :has");
  // Its own width must not set the row height through the square rule.
  assert.ok(css.includes(`${bare} { padding-inline: 0; aspect-ratio: 1; }`), "square, no side padding");
});

test("in the collapsed rail, with no chip beside it, the account is the plain icon button", () => {
  // Alone in the rail a solid square read heavy; the icon button is what it was there.
  const bar = read("../tabbar.tsx");
  assert.match(bar, /<HeaderActions inbox=\{false\} alone=\{collapsed\} \/>/);
});

test("the line above the account row stays put when the sidebar opens or closes", () => {
  // Measured, it sat 18px lower in the rail: 8px less column padding below,
  // 4px less above the row, and a 36px row against the chip's 42px.
  const css = read("../styles/nav.css");
  // Below the row only the scroll box's own 16px (room for shadows), as above it.
  assert.match(css, /\n  \.nav \{[^}]*padding: 24px 0 0;/);
  assert.match(css, /\.layout\.nav-collapsed \.nav \{[^}]*padding: 24px var\(--rail-pad\) 0;/);
  assert.match(css, /\.layout\.nav-collapsed \.nav-bottom\.desktop-only \{[^}]*padding-top: 16px; padding-bottom: 16px;/);
  assert.match(css, /\n  \.nav-account-row \{[^}]*gap: 8px; min-height: 42px;/);
});
