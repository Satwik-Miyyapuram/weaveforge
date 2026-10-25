import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { PaletteDockButton, stepPaletteDock, type PaletteDock } from "@/components/palette-dock";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("arrow keys step one cell round the edge, skipping the empty centre (13-15)", () => {
  assert.equal(stepPaletteDock("top-left", "ArrowRight"), "top");
  assert.equal(stepPaletteDock("top", "ArrowDown"), "bottom");
  assert.equal(stepPaletteDock("left", "ArrowRight"), "right");
  assert.equal(stepPaletteDock("right", "ArrowLeft"), "left");
  assert.equal(stepPaletteDock("bottom", "ArrowUp"), "top");
  assert.equal(stepPaletteDock("bottom-right", "ArrowUp"), "right");
});

test("a step off the edge stays put, and other keys do nothing", () => {
  assert.equal(stepPaletteDock("top-left", "ArrowLeft"), "top-left");
  assert.equal(stepPaletteDock("top-left", "ArrowUp"), "top-left");
  assert.equal(stepPaletteDock("bottom-right", "ArrowDown"), "bottom-right");
  assert.equal(stepPaletteDock("left", "Enter"), "left");
});

test("the handle docks by arrow key and leaves other keys alone", async () => {
  const docked: PaletteDock[] = [];
  let prevented = 0;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(PaletteDockButton, { dock: "left", onDock: (d: PaletteDock) => docked.push(d) }));
  });
  const button = tree!.root.findByType("button");
  const key = (k: string) => button.props.onKeyDown({ key: k, preventDefault: () => prevented++ });
  key("ArrowRight");
  key("ArrowLeft");
  key("Tab");
  assert.deepEqual(docked, ["right"]);
  assert.equal(prevented, 2, "a clamped arrow is still swallowed, Tab is not");
  assert.match(button.props["aria-label"], /arrow keys/);
});
