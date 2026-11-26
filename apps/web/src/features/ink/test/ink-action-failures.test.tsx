/**
 * F97-P2-29/30/31: the ink note's copy, export and remove actions.
 *
 * A failed action is reported on screen (the host's `setUnavailable` line),
 * never left as an unhandled rejection; every figure bitmap an export opens is
 * closed, whether the export finishes or throws.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { FigureGeometry, InkStroke } from "@weaveforge/core";

import { renderHook } from "@/lib/test/react-harness";
import { loadTestCore } from "@/lib/test/load-test-core";
import { composeWithFigures, usePageExport, type PageExportDeps } from "../ui/use-page-export";
import { useInkSelection, type UseInkSelectionOptions } from "../ui/use-ink-selection";
import { useInkPageMedia, type InkPageMediaDeps } from "../ui/use-ink-page-media";

before(loadTestCore);

const A4 = { width: 2100, height: 2970 };
const g = globalThis as Record<string, unknown>;

/** Stubs the browser's bitmaps and canvas; counts opens and closes. */
function stubCanvas(drawImage: (source: unknown) => void = () => undefined) {
  const saved = { bitmap: g.createImageBitmap, document: g.document };
  let opened = 0;
  let closed = 0;
  g.createImageBitmap = async () => {
    opened += 1;
    return { width: 10, height: 10, close: () => void (closed += 1) };
  };
  g.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, drawImage, fillStyle: "" }),
      toBlob: (done: (blob: Blob) => void) => done(new Blob(["png"])),
    }),
  };
  return {
    opened: () => opened,
    closed: () => closed,
    restore() {
      g.createImageBitmap = saved.bitmap;
      g.document = saved.document;
    },
  };
}

const figures: FigureGeometry[] = [
  { path: "a.png", x: 0, y: 0, w: 10, h: 10 },
  { path: "b.png", x: 20, y: 0, w: 10, h: 10 },
  { path: "c.png", x: 40, y: 0, w: 10, h: 10 },
];
const fetchBlob = async () => new Blob(["img"]);

test("F97-P2-29: 50 exports close every bitmap they open", async () => {
  const canvas = stubCanvas();
  try {
    for (let i = 0; i < 50; i += 1) {
      await composeWithFigures(new Blob(["ink"]), figures, fetchBlob, A4, 2);
    }
    assert.equal(canvas.opened(), 50 * 4);
    assert.equal(canvas.closed(), canvas.opened());
  } finally {
    canvas.restore();
  }
});

test("F97-P2-29: an export that throws mid-draw still closes every figure bitmap", async () => {
  let draws = 0;
  const canvas = stubCanvas(() => {
    draws += 1;
    if (draws === 1) throw new Error("draw failed");
  });
  try {
    await assert.rejects(composeWithFigures(new Blob(["ink"]), figures, fetchBlob, A4, 2), /draw failed/);
    assert.equal(canvas.opened(), 4);
    assert.equal(canvas.closed(), 4);
  } finally {
    canvas.restore();
  }
});

function exportDeps(over: Partial<PageExportDeps>, errors: string[]): PageExportDeps {
  return {
    requestExport: async () => null,
    requestModel: async () => ({ lines: [] }) as never,
    noteId: "n1",
    pageIndex: 0,
    textPages: { current: [""] },
    pageSize: A4,
    palette: {} as never,
    fetchBlob,
    pageTexts: { current: [""] },
    pageCount: 1,
    savedStrokes: new Map(),
    root: { current: null },
    scale: 1,
    paper: "plain",
    onError: (message) => void errors.push(message),
    ...over,
  };
}

test("F97-P2-30: a failed PNG export or SVG export is reported, not thrown", async () => {
  const errors: string[] = [];
  const deps = exportDeps(
    {
      requestExport: () => Promise.reject(new Error("encode failed")),
      requestModel: () => Promise.reject(new Error("worker gone")),
    },
    errors,
  );
  const h = await renderHook((d: PageExportDeps) => usePageExport(d), deps);
  await h.current.onExportPng();
  await h.current.onExportSvg();
  await h.unmount();
  assert.equal(errors.length, 2);
  assert.match(errors[0]!, /encode failed/);
  assert.match(errors[1]!, /worker gone/);
});

test("F97-P2-30: a failed print is reported, not thrown", async () => {
  const errors: string[] = [];
  const deps = exportDeps({ requestExport: () => Promise.reject(new Error("raster failed")) }, errors);
  const h = await renderHook((d: PageExportDeps) => usePageExport(d), deps);
  await h.current.onPrint();
  await h.unmount();
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /raster failed/);
});

const stroke: InkStroke = {
  points: [0, 0, 10, 10],
  pressures: [],
  width: 6,
  tool: "pen",
  colour: "text",
  t0: 0,
  shape: "none",
  lineIndex: -1,
};

function selectionOptions(over: Partial<UseInkSelectionOptions>): UseInkSelectionOptions {
  return {
    send: () => undefined,
    scheduleSave: () => undefined,
    selection: [7],
    setSelection: () => undefined,
    setSelectionBounds: () => undefined,
    requestModel: async () => ({ lines: [] }) as never,
    sheetInk: { ids: [7], strokes: [stroke] } as never,
    pageSize: A4,
    wrapRef: { current: null },
    onError: () => undefined,
    ...over,
  };
}

test("F97-P2-30: a clipboard that refuses a copy is reported, not thrown", async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const savedWindow = g.window;
  g.window ??= { addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: () => Promise.reject(new Error("clipboard denied")) } },
  });
  const errors: string[] = [];
  try {
    const h = await renderHook(
      (o: UseInkSelectionOptions) => useInkSelection(o),
      selectionOptions({
        requestModel: () => Promise.reject(new Error("worker gone")),
        onError: (message) => void errors.push(message),
      }),
    );
    await h.current.onCopyStrokes();
    await h.current.onCopyAsText();
    await h.unmount();
  } finally {
    if (saved) Object.defineProperty(globalThis, "navigator", saved);
    else Reflect.deleteProperty(globalThis, "navigator");
    g.window = savedWindow;
  }
  assert.equal(errors.length, 2);
  assert.match(errors[0]!, /clipboard denied/);
  assert.match(errors[1]!, /worker gone/);
});

test("F97-P2-31: a page image that cannot be removed is reported, not thrown", async () => {
  const savedWindow = g.window;
  g.window ??= { addEventListener() {}, removeEventListener() {} };
  const { typedCore } = await import("@/lib/rust-core");
  const errors: string[] = [];
  const deps = {
    noteId: "n1",
    pageSize: A4,
    pagesRef: { current: [{ chunkId: "c1", chunk: new Uint8Array(), paper: "plain" }] },
    textPagesRef: { current: [typedCore().withInkPageBackground("", "bg.png")] },
    pageIndexRef: { current: 0 },
    figuresRef: { current: [] },
    wrapRef: { current: null },
    chunks: { write: () => Promise.reject(new Error("disk full")) },
    assets: { upload: async () => "x", fetchBlob },
    onBackgroundCleared() {},
    onFiguresChange() {},
    selectFigure() {},
    setUnavailable(message: string | null) {
      if (message) errors.push(message);
    },
    scheduleSave() {},
  } as unknown as InkPageMediaDeps;
  try {
    const h = await renderHook((d: InkPageMediaDeps) => useInkPageMedia(d), deps);
    await h.current.onRemovePageBackground();
    await h.unmount();
  } finally {
    g.window = savedWindow;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /could not be removed/);
});
