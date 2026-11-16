/**
 * A failed inline submit must reopen the box for a retry. The `done` guard is
 * cleared in the catch, so a rejected submit does not leave the person stuck.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../ui/explorer-glyphs.tsx", import.meta.url)), "utf8");

test("a failed submit resets the done guard", () => {
  assert.match(src, /\.catch\(\(\) => \{\s*done\.current = false;\s*\}\);/);
});

test("the submit runs at once, and its rejection carries the catch", () => {
  assert.match(src, /Promise\.resolve\(onSubmit\(value\)\)\.catch\(/);
});
