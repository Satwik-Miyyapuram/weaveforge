/**
 * A zoom keeps the finished text layer and moves `--scale-factor`; a rotation,
 * an unfinished layer or an evicted one is rebuilt. Rebuilding measured every
 * glyph, so a pane resize with six readers open took over a second.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { clearTextLayerBuilt, markTextLayerBuilt, rescaleTextLayer } from "../ui/pdf-reader/pdf-text-layer";

function fakeLayer() {
  const props = new Map<string, string>();
  const el = { dataset: {} as Record<string, string>, style: { setProperty: (k: string, v: string) => props.set(k, v) } };
  return { el: el as unknown as HTMLElement, props };
}

test("a finished layer at the same rotation is rescaled", () => {
  const { el, props } = fakeLayer();
  markTextLayerBuilt(el, 90);
  assert.equal(rescaleTextLayer(el, 90, 1.5), true);
  assert.equal(props.get("--scale-factor"), "1.5");
});

test("a new rotation is rebuilt", () => {
  const { el, props } = fakeLayer();
  markTextLayerBuilt(el, 0);
  assert.equal(rescaleTextLayer(el, 90, 1.5), false);
  assert.equal(props.size, 0);
});

test("an unfinished or cleared layer is rebuilt", () => {
  const { el } = fakeLayer();
  assert.equal(rescaleTextLayer(el, 0, 1), false);
  markTextLayerBuilt(el, 0);
  clearTextLayerBuilt(el);
  assert.equal(rescaleTextLayer(el, 0, 1), false);
});
