/**
 * The account button sits beside the project chip and must move like it.
 *
 * It used the design system's ghost icon class, which has no shadow at rest and
 * gains one on hover, while the brutal themes draw it as a solid box like the
 * chip. The result jumped on hover and pressed a different distance from its
 * neighbour. It is a plain secondary button now, the chip's own family.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

test("the account trigger is a secondary button, not the ghost icon class", () => {
  const src = read("../header-actions.tsx");
  // The Popover's default look is the secondary Button; `look="custom"` would drop it.
  const block = /<Popover\s[^>]*?ariaLabel="Account"[\s\S]*?label=/.exec(src)?.[0] ?? "";
  assert.ok(block, "account popover found");
  assert.doesNotMatch(block, /look="custom"/);
  const trigger = /triggerClassName="([^"]+)"/.exec(block)?.[1] ?? "";
  assert.ok(!trigger.split(" ").includes("header-overflow-btn"), `trigger class: ${trigger}`);
});

test("the brutal themes add no hover effect of their own to the account row", () => {
  const css = read("../styles/brutal.css");
  assert.doesNotMatch(css, /\.nav-account-row[^{]*:hover\s*\{/);
});

test("both account-row popover triggers stay sunk at the press depth while open", () => {
  // Pressing sinks a button by --wf-press; an open menu keeps its trigger there.
  // A trigger outside this rule pops back up on release, and one pressing a
  // different distance slides on release: both read as a jump.
  const css = read("../styles/states.css");
  const rule = /:is\(([^)]*)\)\.popover-trigger\[aria-expanded="true"\]\s*\{\s*translate: var\(--wf-press\) var\(--wf-press\)/.exec(css)?.[1] ?? "";
  for (const cls of [".btn-secondary", ".proj-chip"]) assert.ok(rule.split(", ").includes(cls), `open-trigger rule: ${rule}`);
});
