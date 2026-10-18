import { test } from "node:test";
import assert from "node:assert/strict";

import type { InkRenderStroke } from "../ui/ink-strokes";
import {
  chooseCanvasMode,
  paintInkCanvas,
  releaseInkCanvas,
} from "../ui/ink-page-canvas";

class FakePath2D {
  d: string | undefined;
  constructor(d?: string) {
    this.d = d;
  }
}

globalThis.Path2D = FakePath2D as unknown as typeof Path2D;

interface Call {
  name: string;
  args: unknown[];
}

function recordingContext(width = 800, height = 600) {
  const calls: Call[] = [];
  const strokes: unknown[] = [];
  let strokeStyle = "";
  let lineWidth = 1;
  let globalAlpha = 1;
  let lineCap = "";
  let lineJoin = "";

  const canvas = { width, height };

  const ctx = {
    canvas,
    get strokeStyle() {
      return strokeStyle;
    },
    set strokeStyle(val: string) {
      strokeStyle = val;
    },
    get lineWidth() {
      return lineWidth;
    },
    set lineWidth(val: number) {
      lineWidth = val;
    },
    get globalAlpha() {
      return globalAlpha;
    },
    set globalAlpha(val: number) {
      globalAlpha = val;
    },
    get lineCap() {
      return lineCap;
    },
    set lineCap(val: string) {
      lineCap = val;
    },
    get lineJoin() {
      return lineJoin;
    },
    set lineJoin(val: string) {
      lineJoin = val;
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      calls.push({ name: "setTransform", args: [a, b, c, d, e, f] });
    },
    clearRect(x: number, y: number, w: number, h: number) {
      calls.push({ name: "clearRect", args: [x, y, w, h] });
    },
    stroke(path?: unknown) {
      calls.push({ name: "stroke", args: [path] });
      strokes.push(path);
    },
  };

  return { ctx, calls, strokes };
}

class FakeImageBitmap {
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

let lastCreatedOffscreen: FakeOffscreenCanvas | null = null;

function getLastCreatedOffscreen(): FakeOffscreenCanvas | null {
  return lastCreatedOffscreen;
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  readonly ctxRecording: ReturnType<typeof recordingContext>;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.ctxRecording = recordingContext(width, height);
    lastCreatedOffscreen = this;
  }

  getContext(type: string) {
    if (type === "2d") return this.ctxRecording.ctx;
    return null;
  }

  transferToImageBitmap() {
    return new FakeImageBitmap(this.width, this.height);
  }
}

class FakeBitmapRenderingContext {
  transferred: unknown = undefined;
  transferFromImageBitmap(bitmap: unknown) {
    this.transferred = bitmap;
  }
}

interface FakeCanvasWithBitmap {
  width: number;
  height: number;
  bitmapCtx: FakeBitmapRenderingContext;
  recording2d: ReturnType<typeof recordingContext>;
  getContext(type: string): unknown;
}

interface FakeCanvasWithoutBitmap {
  width: number;
  height: number;
  bitmapCtx: null;
  recording2d: ReturnType<typeof recordingContext>;
  getContext(type: string): unknown;
}

function createFakeDOMCanvas(options: { supportsBitmap: false }): FakeCanvasWithoutBitmap;
function createFakeDOMCanvas(options?: { supportsBitmap?: true }): FakeCanvasWithBitmap;
function createFakeDOMCanvas(options?: { supportsBitmap?: boolean }): FakeCanvasWithBitmap | FakeCanvasWithoutBitmap {
  const supportsBitmap = options?.supportsBitmap ?? true;
  const bitmapCtx = supportsBitmap ? new FakeBitmapRenderingContext() : null;
  const recording2d = recordingContext();

  return {
    width: 0,
    height: 0,
    bitmapCtx,
    recording2d,
    getContext(type: string) {
      if (type === "bitmaprenderer") return bitmapCtx;
      if (type === "2d") return recording2d.ctx;
      return null;
    },
  } as FakeCanvasWithBitmap | FakeCanvasWithoutBitmap;
}

const sampleStrokes: readonly InkRenderStroke[] = [
  {
    points: [0, 0, 10, 10, 20, 20],
    width: 2,
    colour: "#000000",
    highlighter: false,
  },
];

test("paintInkCanvas in bitmap mode draws to OffscreenCanvas, transfers bitmap, and zeroes offscreen canvas", () => {
  const originalOffscreen = globalThis.OffscreenCanvas;
  try {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    const canvas = createFakeDOMCanvas();
    lastCreatedOffscreen = null;

    paintInkCanvas(canvas as unknown as HTMLCanvasElement, sampleStrokes, 400, 500, 2, "bitmaprenderer");

    assert.equal(canvas.width, 400, "DOM canvas width is set");
    assert.equal(canvas.height, 500, "DOM canvas height is set");
    const offscreen = getLastCreatedOffscreen();
    assert.ok(offscreen, "OffscreenCanvas was instantiated");
    assert.equal(offscreen.width, 0, "OffscreenCanvas width was zeroed");
    assert.equal(offscreen.height, 0, "OffscreenCanvas height was zeroed");

    const transformCall = offscreen.ctxRecording.calls.find((c: Call) => c.name === "setTransform");
    assert.ok(transformCall, "drawInkStrokes called setTransform on offscreen ctx");
    assert.deepEqual(transformCall.args, [2, 0, 0, 2, 0, 0], "same unitsToPx passed as 2D path");
    assert.equal(offscreen.ctxRecording.strokes.length, 1, "stroke was drawn on offscreen ctx");

    assert.ok(canvas.bitmapCtx.transferred instanceof FakeImageBitmap, "transferred ImageBitmap to DOM canvas");
  } finally {
    globalThis.OffscreenCanvas = originalOffscreen;
  }
});

test("paintInkCanvas 2D fallback unchanged when OffscreenCanvas is missing", () => {
  const originalOffscreen = globalThis.OffscreenCanvas;
  try {
    // Simulate environment without OffscreenCanvas.
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    const canvas = createFakeDOMCanvas();

    paintInkCanvas(canvas as unknown as HTMLCanvasElement, sampleStrokes, 400, 500, 2, "2d");

    assert.equal(canvas.width, 400, "DOM canvas width is set");
    assert.equal(canvas.height, 500, "DOM canvas height is set");

    const transformCall = canvas.recording2d.calls.find((c: Call) => c.name === "setTransform");
    assert.ok(transformCall, "drawInkStrokes called setTransform on DOM 2D ctx");
    assert.deepEqual(transformCall.args, [2, 0, 0, 2, 0, 0]);
    assert.equal(canvas.recording2d.strokes.length, 1, "stroke was drawn on DOM 2D ctx");
  } finally {
    globalThis.OffscreenCanvas = originalOffscreen;
  }
});

test("paintInkCanvas in bitmap mode falls back to 2D when OffscreenCanvas is missing", () => {
  const originalOffscreen = globalThis.OffscreenCanvas;
  try {
    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    const canvas = createFakeDOMCanvas();

    paintInkCanvas(canvas as unknown as HTMLCanvasElement, sampleStrokes, 300, 400, 1.5, "bitmaprenderer");

    assert.equal(canvas.width, 300, "DOM canvas width is set");
    assert.equal(canvas.height, 400, "DOM canvas height is set");
    assert.equal(canvas.recording2d.strokes.length, 1, "stroke was drawn on DOM 2D ctx");
  } finally {
    globalThis.OffscreenCanvas = originalOffscreen;
  }
});

test("releaseInkCanvas zeroes width/height and transfers null in bitmap mode", () => {
  const canvas = createFakeDOMCanvas();
  canvas.width = 400;
  canvas.height = 500;
  canvas.bitmapCtx.transferred = new FakeImageBitmap(400, 500);

  releaseInkCanvas(canvas as unknown as HTMLCanvasElement, "bitmaprenderer");

  assert.equal(canvas.bitmapCtx.transferred, null, "transferred null to detach image bitmap");
  assert.equal(canvas.width, 0, "canvas width reset to 0");
  assert.equal(canvas.height, 0, "canvas height reset to 0");
});

test("releaseInkCanvas zeroes width/height in 2D mode", () => {
  const canvas = createFakeDOMCanvas();
  canvas.width = 400;
  canvas.height = 500;

  releaseInkCanvas(canvas as unknown as HTMLCanvasElement, "2d");

  assert.equal(canvas.width, 0, "canvas width reset to 0");
  assert.equal(canvas.height, 0, "canvas height reset to 0");
});

test("chooseCanvasMode picks bitmaprenderer only when OffscreenCanvas and bitmaprenderer are available", () => {
  const originalOffscreen = globalThis.OffscreenCanvas;
  try {
    globalThis.OffscreenCanvas = FakeOffscreenCanvas as unknown as typeof OffscreenCanvas;
    const bitmapCanvas = createFakeDOMCanvas({ supportsBitmap: true });
    assert.equal(chooseCanvasMode(bitmapCanvas as unknown as HTMLCanvasElement), "bitmaprenderer");

    const noBitmapCanvas = createFakeDOMCanvas({ supportsBitmap: false });
    assert.equal(chooseCanvasMode(noBitmapCanvas as unknown as HTMLCanvasElement), "2d");

    delete (globalThis as Record<string, unknown>).OffscreenCanvas;
    assert.equal(chooseCanvasMode(bitmapCanvas as unknown as HTMLCanvasElement), "2d");
  } finally {
    globalThis.OffscreenCanvas = originalOffscreen;
  }
});
