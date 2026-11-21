// The wet layer during a stroke: with `wetLayerAboveSvg` on, the canvas dock is
// raised over the sheet's SVG ink and overlays for the stroke, then dropped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { setWetLayerAbove } from "../application/wet-layer";

function dock() {
  const attrs = new Map<string, string>();
  return {
    attrs,
    el: {
      setAttribute: (k: string, v: string) => void attrs.set(k, v),
      removeAttribute: (k: string) => void attrs.delete(k),
    } as unknown as Element,
  };
}

test("the dock is raised for a stroke when the knob is on, and dropped after", () => {
  const { el, attrs } = dock();
  setWetLayerAbove(el, true, true);
  assert.ok(attrs.has("data-wet-above"));
  setWetLayerAbove(el, false, true);
  assert.ok(!attrs.has("data-wet-above"));
});

test("with the knob off the dock never moves", () => {
  const { el, attrs } = dock();
  setWetLayerAbove(el, true, false);
  assert.ok(!attrs.has("data-wet-above"));
  setWetLayerAbove(null, true, true); // no dock yet: nothing to do, no throw
});

test("the raised dock sits over the overlay, the chip and the figure editor", () => {
  const css = readFileSync(
    fileURLToPath(new URL("../../../app/styles/editor-workspace.css", import.meta.url)),
    "utf8",
  );
  const rule = /\.ink-canvas-dock\[data-wet-above\]\s*\{[^}]*z-index:\s*(\d+)/.exec(css);
  assert.ok(rule, "a raised-dock rule exists");
  assert.ok(Number(rule[1]) > 4, `z-index ${rule[1]} is above the chip (4)`);
});
