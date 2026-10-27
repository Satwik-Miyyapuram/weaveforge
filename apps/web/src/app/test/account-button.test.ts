/**
 * The account button sits beside the project chip and must move like it.
 *
 * It once had its own class, which jumped on hover and pressed a different
 * distance from its neighbour. It is now the catalogue's one icon button
 * (`trigger="icon"`), so it moves exactly like every other button.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the account trigger is the one icon button, chosen by name", () => {
  const src = read("../header-actions.tsx");
  const block = /<Popover\s[\s\S]*?ariaLabel=[^\n]*"Account"[\s\S]*?label=/.exec(src)?.[0] ?? "";
  assert.ok(block, "account popover found");
  assert.match(block, /trigger="icon"/);
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
