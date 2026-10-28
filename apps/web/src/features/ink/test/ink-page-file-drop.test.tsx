/**
 * A file dropped from the OS onto a notes page becomes a figure (design D18,
 * DA-114). The live canvas covers the sheet, so the drop lands on the canvas:
 * the handler has to sit on something the canvas is inside.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement, createRef } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { InkPage } from "../ui/ink-page";
import type { InkPageProps } from "../ui/ink-page-props";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { window?: unknown }).window ??= { requestAnimationFrame: () => 0, cancelAnimationFrame() {} };

function page(onDropFile: InkPageProps["onDropFile"]): ReactTestRenderer {
  const noop = () => {};
  const props: InkPageProps = {
    pageIndex: 0,
    pageSize: { width: 1000, height: 1400 },
    scale: 1,
    paper: "blank",
    tool: "pen",
    project: (x, y) => ({ x: x / 2, y: y / 2 }),
    penHandlers: { onPointerDown: noop, onPointerMove: noop, onPointerUp: noop, onPointerCancel: noop },
    canvasRef: createRef<HTMLCanvasElement>() as React.RefObject<HTMLCanvasElement>,
    sheetRef: createRef<HTMLDivElement>() as React.RefObject<HTMLDivElement>,
    view: { width: 1000, height: 1400 },
    onErase: noop,
    penOnly: true,
    penSeen: true,
    cursorMode: false,
    figures: [],
    onDropFile,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(createElement(InkPage, props));
  });
  return renderer;
}

/** The nearest element at or above `node` that takes `prop`. */
function handlerAbove(node: ReactTestInstance, prop: string): ReactTestInstance | null {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (typeof at.props[prop] === "function") return at;
  }
  return null;
}

const dataTransfer = (files: File[]) => ({ types: ["Files"], files, dropEffect: "none" });

test("a file dropped on the canvas is added where it was dropped", () => {
  const got: Array<[string, unknown]> = [];
  const renderer = page((file, at) => void got.push([file.name, at]));
  const canvas = renderer.root.findByType("canvas");
  const target = handlerAbove(canvas, "onDrop");
  assert.ok(target, "nothing the canvas is inside takes a drop");
  const file = new File(["x"], "pic.png", { type: "image/png" });
  act(() => target.props.onDrop({ preventDefault() {}, clientX: 40, clientY: 60, dataTransfer: dataTransfer([file]) }));
  assert.deepEqual(got, [["pic.png", { x: 20, y: 30 }]]);
});

test("dragging a file over the canvas lights the sheet up", () => {
  const renderer = page(() => {});
  const canvas = renderer.root.findByType("canvas");
  const target = handlerAbove(canvas, "onDragOver");
  assert.ok(target, "nothing the canvas is inside takes a drag-over");
  let accepted = false;
  act(() => target.props.onDragOver({ preventDefault: () => void (accepted = true), dataTransfer: dataTransfer([]) }));
  assert.equal(accepted, true);
  const sheet = renderer.root.find((n) => typeof n.props.className === "string" && n.props.className.includes("ink-sheet"));
  assert.match(sheet.props.className, /is-drag-over/);
});
