/**
 * The line the caret is on and the selected text read as two different things
 * (design D19, DA-107). Both were accent tints, 7 % and 30 %, so a selection
 * inside the active line looked like the line highlight and vice versa.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

test("the editor theme reads its tints from two separate tokens", () => {
  const src = read("lib/theme/codemirror-theme.ts");
  assert.match(src, /selection:\s*"var\(--editor-selection\)"/);
  assert.match(src, /lineHighlight:\s*"var\(--editor-active-line\)"/);
});

test("the active line is a neutral wash, the selection keeps the accent", () => {
  const css = read("app/styles/base.css");
  const line = /--editor-active-line:\s*([^;]+);/.exec(css)?.[1] ?? "";
  const sel = /--editor-selection:\s*([^;]+);/.exec(css)?.[1] ?? "";
  assert.match(sel, /var\(--accent\)/, "selection");
  assert.ok(line.length > 0, "active line token");
  assert.doesNotMatch(line, /--accent/, "an accent wash reads as a faint selection");
});
