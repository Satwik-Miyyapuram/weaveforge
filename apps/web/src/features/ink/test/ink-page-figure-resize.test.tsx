/**
 * A corner drag on a notes page resizes with core's `resizeFigureBox`, so the
 * page, the figure editor and the PDF reader round a resize the same way
 * (20-06).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { resizeFigureBox } from "@weaveforge/core";

import { InkPage } from "../ui/ink-page";
import type { InkPageProps } from "../ui/ink-page-props";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= { requestAnimationFrame: () => 0, cancelAnimationFrame() {} };

type Box = { x: number; y: number; w: number; h: number };

function pointer(x: number, y: number, shiftKey = false) {
  return {
    pointerId: 7,
    pointerType: "pen",
    button: 0,
    buttons: 1,
    pressure: 0.5,
    clientX: x,
    clientY: y,
    altKey: false,
    shiftKey,
    timeStamp: 1_000,
    nativeEvent: { width: 1, height: 1 },
    currentTarget: { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false },
    preventDefault() {},
    stopPropagation() {},
  } as unknown as React.PointerEvent<HTMLCanvasElement>;
}

const BOX: Box = { x: 100, y: 100, w: 200, h: 100 };

function drag(from: { x: number; y: number }, to: { x: number; y: number }, shiftKey = false): Box[] {
  const changes: Box[] = [];
  const noop = () => {};
  const props: InkPageProps = {
    pageIndex: 0,
    pageSize: { width: 1000, height: 1400 },
    scale: 1,
    paper: "blank",
    tool: "pen",
    project: (x, y) => ({ x, y }),
    penHandlers: { onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop },
    canvasRef: createRef<HTMLCanvasElement>() as React.RefObject<HTMLCanvasElement>,
    sheetRef: createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>,
    view: { width: 1000, height: 1400 },
    onErase: noop,
    penOnly: true,
    penSeen: true,
    cursorMode: true,
    figures: [{ ...BOX } as never],
    onFigureChange: (_i, box) => void changes.push(box as Box),
    onFigureActivate: noop,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(InkPage, props));
  });
  const canvas = renderer.root.findByType("canvas");
  act(() => canvas.props.onPointerDown(pointer(from.x, from.y)));
  act(() => canvas.props.onPointerMove(pointer(to.x, to.y, shiftKey)));
  return changes;
}

test("a south-east corner drag matches core, rounding included", () => {
  const got = drag({ x: 300, y: 200 }, { x: 300.6, y: 200 });
  assert.deepEqual(got.at(-1), resizeFigureBox(BOX, "se", 0.6, 0));
});

test("a north-west corner drag anchors the far corner like core", () => {
  const got = drag({ x: 100, y: 100 }, { x: 40, y: 95 });
  assert.deepEqual(got.at(-1), resizeFigureBox(BOX, "nw", -60, -5));
});

test("shift frees the aspect like core", () => {
  const got = drag({ x: 300, y: 200 }, { x: 350, y: 260 }, true);
  assert.deepEqual(got.at(-1), resizeFigureBox(BOX, "se", 50, 60, { free: true }));
});

test("a corner never shrinks below the minimum", () => {
  const got = drag({ x: 300, y: 200 }, { x: -500, y: 200 });
  assert.deepEqual(got.at(-1), resizeFigureBox(BOX, "se", -800, 0));
  assert.ok(got.at(-1)!.w >= 30 && got.at(-1)!.h >= 30);
});
