/**
 * A picture added to a notes page lands at its own size, no bigger than half
 * the page, and selected, so it can be moved at once (design D18, DA-117).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureGeometry } from "@weaveforge/core";

import { renderHook } from "@/lib/test/react-harness";
import { figureBoxForImage } from "../ui/ink-figures";
import { useInkPageMedia, type InkPageMediaDeps } from "../ui/use-ink-page-media";

const A4 = { width: 2100, height: 2970 };

test("a small picture keeps its own size: one CSS pixel is 254/96 page units", () => {
  const box = figureBoxForImage({ width: 100, height: 50 }, { x: 1050, y: 1485 }, A4);
  assert.deepEqual(box, { x: 918, y: 1419, w: 265, h: 132 });
});

test("a big picture is shrunk to half the page width, keeping its shape", () => {
  const box = figureBoxForImage({ width: 4000, height: 2000 }, { x: 1050, y: 1485 }, A4);
  assert.equal(box.w, 1050);
  assert.equal(box.h, 525);
});

test("a tall picture is shrunk to fit the page height too", () => {
  const box = figureBoxForImage({ width: 500, height: 20000 }, { x: 1050, y: 1485 }, A4);
  assert.ok(box.h <= A4.height / 2, `h ${box.h}`);
  assert.ok(Math.abs(box.w / box.h - 500 / 20000) < 0.01);
});

test("a picture dropped by the edge stays on the page", () => {
  const box = figureBoxForImage({ width: 400, height: 400 }, { x: 2090, y: 10 }, A4);
  assert.equal(box.x + box.w, A4.width);
  assert.equal(box.y, 0);
});

test("an added picture is selected once it is on the page", async () => {
  const g = globalThis as Record<string, unknown>;
  const saved = { bitmap: g.createImageBitmap, offscreen: g.OffscreenCanvas, window: g.window };
  g.createImageBitmap = async () => ({ width: 100, height: 50, close() {} });
  g.OffscreenCanvas = class {
    getContext() {
      return { drawImage() {} };
    }
    async convertToBlob() {
      return new Blob(["x"], { type: "image/webp" });
    }
  };
  g.window ??= { addEventListener() {}, removeEventListener() {} };
  const figuresRef: { current: readonly FigureGeometry[] } = { current: [{ path: "old.png", x: 0, y: 0, w: 10, h: 10 }] };
  const selected: number[] = [];
  const deps = {
    noteId: "n1",
    pageSize: A4,
    figuresRef,
    pageIndexRef: { current: 0 },
    textPagesRef: { current: [""] },
    wrapRef: { current: null },
    assets: { upload: async () => "new.webp" },
    onFiguresChange: (next: readonly FigureGeometry[]) => void (figuresRef.current = next),
    selectFigure: (index: number) => void selected.push(index),
    setUnavailable(message: string | null) {
      if (message) throw new Error(message);
    },
    scheduleSave() {},
  } as unknown as InkPageMediaDeps;
  try {
    const h = await renderHook((d: InkPageMediaDeps) => useInkPageMedia(d), deps);
    await h.current.onAddFigure(new File(["x"], "pic.png", { type: "image/png" }), { x: 1050, y: 1485 });
    await h.flush();
    await h.unmount();
    assert.equal(figuresRef.current.length, 2);
    assert.deepEqual(figuresRef.current[1], { x: 918, y: 1419, w: 265, h: 132, path: "new.webp" });
    assert.deepEqual(selected, [1]);
  } finally {
    g.createImageBitmap = saved.bitmap;
    g.OffscreenCanvas = saved.offscreen;
    g.window = saved.window;
  }
});
