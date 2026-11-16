import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The pitch paints from the very top edge.
 *
 * The floating header has a 12px top margin. `.page` only clips overflow, which
 * does not stop margins collapsing, so that 12px leaked out of `.page` and the
 * page began 12px lower: the strip above it showed the html/body background
 * (the app's default theme, not the CRT cream), which read as a thin line at
 * the top of the page. `display: flow-root` keeps the margin inside `.page`.
 */

const css = readFileSync(
  fileURLToPath(new URL("../scrolly.module.css", import.meta.url)),
  "utf8",
);

test("the page root is a block formatting context, so the header margin stays inside it", () => {
  const rule = css.match(/^\.page \{[^}]*\}/m)?.[0];
  assert.ok(rule, ".page rule is missing");
  assert.match(rule, /display:\s*flow-root/);
});

test("the header keeps its 12px gap inside the page, not above it", () => {
  const rule = css.match(/^\.top \{[^}]*\}/m)?.[0];
  assert.ok(rule, ".top rule is missing");
  assert.match(rule, /margin:\s*12px auto 0/);
});
