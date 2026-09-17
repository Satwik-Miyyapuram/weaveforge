/**
 * `InkFigureEditor`, at the level a hand uses it.
 *
 * The geometry itself is core's (`resizeFigureBox`, `cropFigureTo`) and is
 * tested there; what is pinned here is the wiring — that the frame sits where
 * the figure is, that every handle is there, that the order buttons know
 * which ends of the stack they are at, that the keys do what the titles say,
 * and that the crop tool applies through `onChange` as a box plus insets.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { act, create, type ReactTestInstance } from "react-test-renderer";
import type { FigureGeometry } from "@weaveforge/core";

import { InkFigureEditor, type InkFigureEditorProps } from "../ui/ink-figures";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIGURE: FigureGeometry = { path: "p/a.png", x: 100, y: 200, w: 400, h: 300 };
const PAGE = { width: 2100, height: 2970 };

function mount(overrides: Partial<InkFigureEditorProps> = {}) {
  const calls = {
    change: [] as InkFigureEditorProps["onChange"] extends (n: infer N) => void ? N[] : never,
    reorder: [] as string[],
    remove: 0,
    close: 0,
  };
  const props: InkFigureEditorProps = {
    figure: FIGURE,
    index: 1,
    count: 3,
    scale: 0.5,
    pageSize: PAGE,
    imageUrl: "blob:one",
    onChange: (next) => calls.change.push(next),
    onReorder: (step) => calls.reorder.push(step),
    onRemove: () => (calls.remove += 1),
    onClose: () => (calls.close += 1),
    ...overrides,
  };
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(InkFigureEditor, props), {
      createNodeMock: () => ({ focus() {} }),
    });
  });
  return { root: renderer!.root, calls };
}

function button(root: ReactTestInstance, text: string): ReactTestInstance {
  return root.findAll((n) => n.type === "button" && n.children.join("") === text)[0]!;
}

function frame(root: ReactTestInstance): ReactTestInstance {
  return root.find((n) => typeof n.props.className === "string" && n.props.className === "ink-figure-frame");
}

test("editor: the frame is the figure's box at the sheet's scale, with eight handles", () => {
  const { root } = mount();
  const box = frame(root);
  assert.deepEqual(box.props.style, { left: 50, top: 100, width: 200, height: 150 });
  const handles = root.findAll((n) => n.props["data-handle"] !== undefined);
  assert.deepEqual(
    handles.map((h) => h.props["data-handle"]),
    ["nw", "n", "ne", "e", "se", "s", "sw", "w"],
  );
});

test("editor: the order buttons stop at the ends of the stack", () => {
  const middle = mount({ index: 1, count: 3 });
  for (const label of ["Forward", "Backward", "Front", "Back"]) {
    assert.equal(button(middle.root, label).props.disabled, false, label);
  }
  const top = mount({ index: 2, count: 3 });
  assert.equal(button(top.root, "Forward").props.disabled, true);
  assert.equal(button(top.root, "Front").props.disabled, true);
  assert.equal(button(top.root, "Backward").props.disabled, false);
  const bottom = mount({ index: 0, count: 3 });
  assert.equal(button(bottom.root, "Back").props.disabled, true);
  assert.equal(button(bottom.root, "Forward").props.disabled, false);

  act(() => button(middle.root, "Front").props.onClick());
  act(() => button(middle.root, "Backward").props.onClick());
  assert.deepEqual(middle.calls.reorder, ["front", "backward"]);
});

test("editor: keys nudge, order, remove and close", () => {
  const { root, calls } = mount();
  const key = (key: string, mods: Partial<KeyboardEvent> = {}) =>
    act(() =>
      frame(root).props.onKeyDown({ key, preventDefault() {}, shiftKey: false, ctrlKey: false, metaKey: false, ...mods }),
    );
  key("ArrowRight");
  key("ArrowDown", { shiftKey: true });
  assert.deepEqual(
    calls.change.map((c) => [c.x, c.y]),
    [
      [110, 200],
      [100, 300],
    ],
  );
  key("]", { ctrlKey: true });
  key("[", { ctrlKey: true, shiftKey: true });
  assert.deepEqual(calls.reorder, ["forward", "back"]);
  key("Delete");
  assert.equal(calls.remove, 1);
  key("Escape");
  assert.equal(calls.close, 1);
});

test("editor: uncrop is offered only for a cropped figure and lifts the crop", () => {
  const plain = mount();
  assert.equal(button(plain.root, "Uncrop"), undefined);
  const cropped = mount({ figure: { ...FIGURE, crop: [50, 0, 0, 0] } });
  act(() => button(cropped.root, "Uncrop").props.onClick());
  assert.deepEqual(cropped.calls.change, [{ x: -300, y: 200, w: 800, h: 300, crop: undefined }]);
});

test("editor: the crop tool applies the kept rectangle as the box, with insets", () => {
  const { root, calls } = mount();
  act(() => button(root, "Crop").props.onClick());
  // The tool is up: the whole picture, the kept rectangle, and its own bar.
  assert.ok(root.findAll((n) => n.props.className === "ink-figure-crop-full").length === 1);
  const kept = root.find((n) => n.props.className === "ink-figure-frame ink-figure-crop-kept");
  assert.deepEqual(kept.props.style, { left: 50, top: 100, width: 200, height: 150 });
  // Drag the east handle in by 200 page units (100 px at scale 0.5).
  const east = root.find((n) => n.props["data-handle"] === "e");
  const target = { setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} };
  const ev = (clientX: number) => ({
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX,
    clientY: 0,
    shiftKey: false,
    currentTarget: target,
    preventDefault() {},
    stopPropagation() {},
  });
  act(() => east.props.onPointerDown(ev(300)));
  act(() => east.props.onPointerMove(ev(200)));
  act(() => east.props.onPointerUp(ev(200)));
  act(() => button(root, "Apply").props.onClick());
  assert.deepEqual(calls.change, [{ x: 100, y: 200, w: 200, h: 300, crop: [0, 0, 50, 0] }]);
  // Applying closes the tool: the ordinary bar is back.
  assert.ok(button(root, "Forward"));
});
