/**
 * Cursor mode on a notes page: the pen points and picks figures, never inks.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { InkPage } from "../ui/ink-page";
import type { InkPageProps } from "../ui/ink-page-props";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= { requestAnimationFrame: () => 0, cancelAnimationFrame() {} };

function pointer(pointerType: string, x: number, y: number) {
  return {
    pointerId: 7,
    pointerType,
    button: 0,
    buttons: 1,
    pressure: 0.5,
    clientX: x,
    clientY: y,
    altKey: false,
    shiftKey: false,
    timeStamp: 1_000,
    nativeEvent: { width: 1, height: 1 },
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false },
    preventDefault() {},
    stopPropagation() {},
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

function mount(extra: Partial<InkPageProps>) {
  const calls = { down: 0, up: 0 };
  const activated: (number | null)[] = [];
  const moved: number[] = [];
  const props: InkPageProps = {
    pageIndex: 0,
    pageSize: { width: 1000, height: 1400 },
    scale: 1,
    paper: "blank",
    tool: "pen",
    project: (x, y) => ({ x, y }),
    penHandlers: {
      onPointerDown: () => void calls.down++,
      onPointerMove: () => {},
      onPointerUp: () => void calls.up++,
      onPointerCancel: () => {},
    },
    canvasRef: createRef<HTMLCanvasElement>() as React.RefObject<HTMLCanvasElement>,
    sheetRef: createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>,
    view: { width: 1000, height: 1400 },
    onErase: () => {},
    penOnly: true,
    penSeen: true,
    figures: [{ x: 100, y: 100, w: 200, h: 100 } as never],
    onFigureChange: (index) => void moved.push(index),
    onFigureActivate: (index) => void activated.push(index),
    ...extra,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(InkPage, props));
  });
  const canvas = renderer.root.findByType("canvas");
  return { canvas, calls, activated, moved };
}

test("in cursor mode a pen on bare paper draws nothing", () => {
  const { canvas, calls } = mount({ cursorMode: true });
  act(() => canvas.props.onPointerDown(pointer("pen", 600, 600)));
  act(() => canvas.props.onPointerUp(pointer("pen", 610, 610)));
  assert.equal(calls.down, 0);
  assert.equal(calls.up, 0);
  assert.equal(canvas.props.style.cursor, "default");
});

test("in cursor mode a pen on a figure grabs the figure", () => {
  const { canvas, calls, moved } = mount({ cursorMode: true });
  act(() => canvas.props.onPointerDown(pointer("pen", 150, 150)));
  act(() => canvas.props.onPointerMove(pointer("pen", 170, 170)));
  assert.equal(calls.down, 0);
  assert.deepEqual(moved, [0]);
});

test("without cursor mode the same pen inks", () => {
  const { canvas, calls } = mount({});
  act(() => canvas.props.onPointerDown(pointer("pen", 600, 600)));
  act(() => canvas.props.onPointerUp(pointer("pen", 610, 610)));
  assert.equal(calls.down, 1);
  assert.equal(calls.up, 1);
});
