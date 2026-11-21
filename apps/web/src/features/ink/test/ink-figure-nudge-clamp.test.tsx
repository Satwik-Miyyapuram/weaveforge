/**
 * The arrow keys keep a figure on the page, as a drag does (P2-10). The
 * nudge moved x and y by 10 (100 with Shift) with no clamp, so held keys
 * walked a figure off the page where nothing could pick it up again.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import type { FigureGeometry } from "@weaveforge/core";

import { loadTestCore } from "@/lib/test/load-test-core";
import { InkFigureEditor, type InkFigureEditorProps } from "../ui/ink-figures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

before(loadTestCore);

const PAGE = { width: 2100, height: 2970 };

test("fifty nudges left from the edge leave at least half the figure on the page", () => {
  let figure: FigureGeometry = { path: "p/a.png", x: 0, y: 200, w: 400, h: 300 };
  const props = (): InkFigureEditorProps => ({
    figure,
    index: 0,
    count: 1,
    scale: 0.5,
    pageSize: PAGE,
    imageUrl: "blob:one",
    onChange: (next) => {
      figure = { ...figure, ...next };
    },
    onReorder: () => {},
    onRemove: () => {},
    onClose: () => {},
  });
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(createElement(InkFigureEditor, props()), { createNodeMock: () => ({ focus() {} }) });
  });
  const press = (key: string, shiftKey = false) => {
    const frame = renderer.root.find((n) => n.props.className === "ink-figure-frame");
    act(() => frame.props.onKeyDown({ key, shiftKey, ctrlKey: false, metaKey: false, preventDefault() {} }));
    act(() => renderer.update(createElement(InkFigureEditor, props())));
  };

  for (let i = 0; i < 50; i += 1) press("ArrowLeft");
  assert.ok(figure.x >= -figure.w / 2, `x went to ${figure.x}`);

  for (let i = 0; i < 50; i += 1) press("ArrowDown", true);
  assert.ok(figure.y <= PAGE.height - figure.h / 2, `y went to ${figure.y}`);

  // A nudge inside the page still moves by the step.
  press("ArrowUp");
  assert.equal(figure.y, PAGE.height - figure.h / 2 - 10);
});
