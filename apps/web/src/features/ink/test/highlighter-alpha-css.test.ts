/**
 * The freeform page's highlighter (canvas.css) is as see-through as the notes'
 * and the PDF's. CSS cannot import HIGHLIGHTER_ALPHA, so this pins the literal.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";

test("the freeform highlighter's opacity is HIGHLIGHTER_ALPHA", () => {
  const css = readFileSync(fileURLToPath(new URL("../../../app/styles/canvas.css", import.meta.url)), "utf8");
  const rule = css.match(/\.canvas-ink__stroke--highlighter\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule, "no .canvas-ink__stroke--highlighter rule in canvas.css");
  for (const property of ["stroke-opacity", "fill-opacity"]) {
    const value = rule.match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`))?.[1]?.trim();
    assert.equal(Number(value), HIGHLIGHTER_ALPHA, `${property} is ${value}`);
  }
});
