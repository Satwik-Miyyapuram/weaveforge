/**
 * A read-only body renders the whole paper text at once. Deferring the
 * off-screen blocks (`content-visibility: auto`) took a 1500-paragraph body
 * from ~450-820 ms of layout and first frames to ~100 ms in WeaveForge Dev.
 * Headings stay rendered so outline jumps land where they should, and touch
 * pointers render everything, as the deferred card columns do, so the page
 * does not grow under a fling.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const css = readFileSync(fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const deferred = /@media \(pointer: fine\) \{\s*\.document-read-body > :is\(([^)]*)\) \{([^}]*)\}\s*\}/;

test("read bodies defer off-screen blocks for fine pointers", () => {
  const m = css.match(deferred);
  assert.ok(m, "no deferred block rule under (pointer: fine)");
  assert.match(m[2] ?? "", /content-visibility:\s*auto/);
  assert.match(m[2] ?? "", /contain-intrinsic-size:\s*auto\s+\S+/);
});

test("headings are never deferred", () => {
  const m = css.match(deferred);
  assert.ok(m);
  assert.doesNotMatch(m[1] ?? "", /\bh[1-6]\b/);
});
