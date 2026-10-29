/**
 * Undo on a notes page walks strokes and figure edits back in the order they
 * were made (design D18, DA-113): the bar, Ctrl+Z and the figure surface share
 * one log.
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FigureGeometry } from "@weaveforge/core";

import { renderHook } from "@/lib/test/react-harness";
import type { InkWorkerMessage } from "../application/capture-protocol";
import { useInkEditActions } from "../ui/use-ink-edit-actions";
import { useInkFigures } from "../ui/use-ink-figures";
import { useInkPageHistory } from "../ui/use-ink-page-history";
import { useInkShortcuts, type InkShortcutsDeps } from "../ui/use-ink-shortcuts";

type Listener = (event: unknown) => void;
const g = globalThis as { window?: unknown };
let listeners: Record<string, Listener[]> = {};
let savedWindow: unknown;

beforeEach(() => {
  listeners = {};
  savedWindow = g.window;
  g.window = {
    addEventListener: (type: string, fn: Listener) => void (listeners[type] ??= []).push(fn),
    removeEventListener: (type: string, fn: Listener) => {
      listeners[type] = (listeners[type] ?? []).filter((l) => l !== fn);
    },
  };
});
afterEach(() => {
  g.window = savedWindow;
});
const fire = (type: string, event: unknown = {}) => {
  for (const l of listeners[type] ?? []) l(event);
};

const fig = (x: number): FigureGeometry => ({ path: "a.png", x, y: 0, w: 10, h: 10 });

/** The host's wiring of the three hooks, with a fake worker. */
function usePage(props: { depth: number; pageIndex: number }, sent: InkWorkerMessage[]) {
  const history = useInkPageHistory(props);
  const textPagesRef = { current: [""] };
  const figures = useInkFigures({
    textPagesRef,
    pageIndexRef: { current: 0 },
    scheduleSave: () => {},
    onStep: history.record,
  });
  const edits = useInkEditActions({
    send: (m) => void sent.push(m),
    scheduleSave: () => {},
    scrollRef: { current: null },
    setZoom: () => {},
    project: () => null,
    takeStep: history.take,
    restoreFigures: figures.restoreFigures,
  });
  return { history, figures, edits };
}

test("undo walks back a figure edit and a stroke in the order they were made", async () => {
  const sent: InkWorkerMessage[] = [];
  const h = await renderHook((p: { depth: number; pageIndex: number }) => usePage(p, sent), { depth: 0, pageIndex: 0 });
  assert.equal(h.current.history.canUndo, false);

  await h.rerender({ depth: 1, pageIndex: 0 }); // a stroke
  h.current.figures.onFiguresChange([fig(0)]); // then a figure
  await h.flush();
  assert.deepEqual(h.current.figures.figures, [fig(0)]);
  assert.equal(h.current.history.canUndo, true);

  h.current.edits.onUndo(); // the figure goes first, without the worker
  await h.flush();
  assert.deepEqual(h.current.figures.figures, []);
  assert.deepEqual(sent, []);
  assert.equal(h.current.history.canRedo, true);

  h.current.edits.onUndo(); // then the stroke, by the worker
  await h.rerender({ depth: 0, pageIndex: 0 });
  assert.deepEqual(sent, [{ type: "undo" }]);
  assert.equal(h.current.history.canUndo, false);

  h.current.edits.onRedo();
  await h.rerender({ depth: 1, pageIndex: 0 });
  h.current.edits.onRedo();
  await h.flush();
  assert.deepEqual(sent, [{ type: "undo" }, { type: "redo" }]);
  assert.deepEqual(h.current.figures.figures, [fig(0)]);
  assert.equal(h.current.history.canRedo, false);
  await h.unmount();
});

test("an undo puts figures back without recording a new step", async () => {
  const sent: InkWorkerMessage[] = [];
  const h = await renderHook((p: { depth: number; pageIndex: number }) => usePage(p, sent), { depth: 0, pageIndex: 0 });
  h.current.figures.onFiguresChange([fig(0)]);
  await h.flush();
  h.current.edits.onUndo();
  await h.flush();
  assert.equal(h.current.history.canUndo, false);
  assert.equal(h.current.history.canRedo, true);
  await h.unmount();
});

test("one drag is one step; two presses are two", async () => {
  const sent: InkWorkerMessage[] = [];
  const h = await renderHook((p: { depth: number; pageIndex: number }) => usePage(p, sent), { depth: 0, pageIndex: 0 });
  h.current.figures.onFiguresChange([fig(0)]);
  await h.flush();
  fire("pointerdown");
  for (const x of [1, 2, 3]) {
    h.current.figures.onFigureChange(0, { x });
    await h.flush();
  }
  fire("pointerup");
  fire("pointerdown");
  h.current.figures.onFigureChange(0, { x: 9 });
  await h.flush();
  fire("pointerup");

  h.current.edits.onUndo();
  await h.flush();
  assert.deepEqual(h.current.figures.figures, [fig(3)]);
  h.current.edits.onUndo();
  await h.flush();
  assert.deepEqual(h.current.figures.figures, [fig(0)]);
  await h.unmount();
});

test("a new page starts with an empty history", async () => {
  const sent: InkWorkerMessage[] = [];
  const h = await renderHook((p: { depth: number; pageIndex: number }) => usePage(p, sent), { depth: 0, pageIndex: 0 });
  h.current.figures.onFiguresChange([fig(0)]);
  await h.flush();
  await h.rerender({ depth: 0, pageIndex: 1 });
  assert.equal(h.current.history.canUndo, false);
  h.current.edits.onUndo();
  assert.deepEqual(sent, []);
  await h.unmount();
});

function shortcutDeps(calls: string[]): InkShortcutsDeps {
  return {
    send: () => {},
    onUndo: () => void calls.push("undo"),
    onRedo: () => void calls.push("redo"),
    setTool: () => {},
    onColourChange: () => {},
    selectionCount: 0,
    clearSelection: () => {},
    onDeleteSelection: () => {},
    recognise: () => {},
    onPrint: () => {},
    onExportPng: () => {},
    onExportSvg: () => {},
    scrollRef: { current: null },
    setZoom: () => {},
  };
}

test("Ctrl+Z and Ctrl+Shift+Z use the same undo as the bar", async () => {
  const calls: string[] = [];
  const h = await renderHook(() => useInkShortcuts(shortcutDeps(calls)), undefined);
  const key = (shiftKey: boolean) => ({
    key: "z", code: "KeyZ", target: { tagName: "DIV" }, metaKey: false, ctrlKey: true, shiftKey, altKey: false,
    preventDefault() {},
  });
  fire("keydown", key(false));
  fire("keydown", key(true));
  assert.deepEqual(calls, ["undo", "redo"]);
  await h.unmount();
});

test("the bar's undo state comes from the shared log", () => {
  const host = readFileSync(fileURLToPath(new URL("../ui/ink-host.tsx", import.meta.url)), "utf8");
  assert.match(host, /canUndo=\{pageHistory\.canUndo\}/);
  assert.match(host, /canRedo=\{pageHistory\.canRedo\}/);
  assert.doesNotMatch(host, /history\.undo > 0/);
});
