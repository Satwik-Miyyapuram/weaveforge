/**
 * A page the reader has not painted holds a 0x0 canvas, not the browser's
 * default 300x150 bitmap. Pages 4-6 of an 11-page paper sat at 300x150 each
 * before their first paint (0.9.8 memory plan, B6 rest).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../ui/pdf-reader/pdf-reader.tsx", import.meta.url)), "utf8");

test("page canvases start with no bitmap", () => {
  assert.match(src, /<canvas width=\{0\} height=\{0\} \/>/);
  assert.doesNotMatch(src, /<canvas \/>/);
});
