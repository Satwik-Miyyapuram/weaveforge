import { test } from "node:test";
import assert from "node:assert/strict";

import type { InkStroke } from "../application/freeform-ink";
import { strokeClass } from "../ui/canvas-ink";

const pen: InkStroke = { id: "s1", x: 0, y: 0, w: 2, c: "#000000", t: "pen", p: [0, 0] };

test("a highlighter stroke is drawn translucent; a pen stroke is not", () => {
  assert.equal(strokeClass(pen, false), "canvas-ink__stroke");
  assert.equal(strokeClass({ ...pen, t: "highlighter" }, false), "canvas-ink__stroke canvas-ink__stroke--highlighter");
});

test("a selected stroke is marked whatever its tool", () => {
  assert.equal(strokeClass(pen, true), "canvas-ink__stroke canvas-ink__stroke--selected");
  assert.equal(
    strokeClass({ ...pen, t: "highlighter" }, true),
    "canvas-ink__stroke canvas-ink__stroke--highlighter canvas-ink__stroke--selected",
  );
});
