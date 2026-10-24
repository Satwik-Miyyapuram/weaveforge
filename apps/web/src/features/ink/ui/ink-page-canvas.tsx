"use client";

/** Static ink drawn to a single 2D canvas instead of SVG paths. */

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { InkStroke } from "@weaveforge/core";
import { INK_RENDER_COLOURS, type InkPalette } from "../render/ink-palette";
import { toRenderStrokes } from "./ink-render-strokes";
import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";
import { strokePath } from "../application/ink-svg";
import type { InkRenderStroke } from "./ink-strokes";
import { perfEnd, perfStart } from "@/lib/perf-marks";

export interface InkPageCanvasProps {
  strokes?: readonly InkStroke[];
  /** Page size in page units (0.1 mm): the strokes' own space. */
  pageSize: { width: number; height: number };
  /** Fit scale: CSS pixels per page unit. */
  scale: number;
  palette?: InkPalette;
  /** Positions in `strokes` left out. */
  hidden?: ReadonlySet<number>;
}

const pathCache = new WeakMap<readonly number[], Path2D>();

const FILL: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  zIndex: 1,
};

export type InkCanvasMode = "bitmaprenderer" | "2d";

export function chooseCanvasMode(canvas: HTMLCanvasElement): InkCanvasMode {
  // Bitmap mode needs OffscreenCanvas and an ImageBitmapRenderingContext.
  if (typeof OffscreenCanvas !== "undefined") {
    const ctx = canvas.getContext("bitmaprenderer");
    if (ctx) return "bitmaprenderer";
  }
  return "2d";
}

export function drawInkStrokes(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  strokes: readonly InkRenderStroke[],
  unitsToPx: number,
): void {
  ctx.setTransform(unitsToPx, 0, 0, unitsToPx, 0, 0);
  const width = ctx.canvas ? (unitsToPx > 0 ? ctx.canvas.width / unitsToPx : ctx.canvas.width) : 0;
  const height = ctx.canvas ? (unitsToPx > 0 ? ctx.canvas.height / unitsToPx : ctx.canvas.height) : 0;
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const renderStroke = (stroke: InkRenderStroke) => {
    let path = pathCache.get(stroke.points);
    if (!path) {
      const d = strokePath(stroke);
      if (!d) return;
      path = new Path2D(d);
      pathCache.set(stroke.points, path);
    }
    ctx.strokeStyle = stroke.colour;
    ctx.lineWidth = stroke.width;
    ctx.globalAlpha = stroke.highlighter ? HIGHLIGHTER_ALPHA : 1;
    ctx.stroke(path);
  };

  for (const stroke of strokes) {
    if (!stroke.highlighter) renderStroke(stroke);
  }
  for (const stroke of strokes) {
    if (stroke.highlighter) renderStroke(stroke);
  }
  ctx.globalAlpha = 1;
}

export function paintInkCanvas(
  canvas: HTMLCanvasElement,
  drawn: readonly InkRenderStroke[],
  width: number,
  height: number,
  unitsToPx: number,
  mode: InkCanvasMode,
): void {
  if (width <= 0 || height <= 0 || drawn.length === 0) return;

  if (mode === "bitmaprenderer" && typeof OffscreenCanvas !== "undefined") {
    const bitmapCtx = canvas.getContext("bitmaprenderer") as ImageBitmapRenderingContext | null;
    if (!bitmapCtx) return;
    // Offscreen single-buffer draw avoids Chrome keeping two backing stores for 2D.
    const off = new OffscreenCanvas(width, height);
    const offCtx = off.getContext("2d");
    if (!offCtx) return;
    const t = perfStart();
    drawInkStrokes(offCtx, drawn, unitsToPx);
    perfEnd("ink:page-paint", t, drawn.length);
    // Size the DOM canvas before transferring the image bitmap.
    canvas.width = width;
    canvas.height = height;
    bitmapCtx.transferFromImageBitmap(off.transferToImageBitmap());
    // Zero offscreen canvas size to release its backing store immediately.
    off.width = 0;
    off.height = 0;
    return;
  }

  // 2D fallback path when OffscreenCanvas is unavailable.
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = width;
  canvas.height = height;
  const t = perfStart();
  drawInkStrokes(ctx, drawn, unitsToPx);
  perfEnd("ink:page-paint", t, drawn.length);
}

export function releaseInkCanvas(
  canvas: HTMLCanvasElement,
  mode: InkCanvasMode,
): void {
  if (mode === "bitmaprenderer") {
    // Detach image bitmap before releasing the canvas backing store.
    const bitmapCtx = canvas.getContext("bitmaprenderer") as ImageBitmapRenderingContext | null;
    bitmapCtx?.transferFromImageBitmap(null);
  }
  // Zero dimensions to drop the backing store immediately.
  canvas.width = 0;
  canvas.height = 0;
}

export const InkPageCanvas = memo(function InkPageCanvas({
  strokes,
  pageSize,
  scale,
  palette = INK_RENDER_COLOURS,
  hidden,
}: InkPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modeRef = useRef<InkCanvasMode | null>(null);

  const drawn = useMemo(() => toRenderStrokes(strokes, palette, hidden), [strokes, palette, hidden]);

  const hasDrawn = drawn.length > 0;

  // Release backing store on unmount or when strokes clear to empty.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasDrawn) return;
    if (!modeRef.current) {
      modeRef.current = chooseCanvasMode(canvas);
    }
    const mode = modeRef.current;
    return () => {
      releaseInkCanvas(canvas, mode);
      modeRef.current = null;
    };
  }, [hasDrawn]);

  // Redraw when strokes, scale, or page size change.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawn.length === 0) return;
    if (!modeRef.current) {
      modeRef.current = chooseCanvasMode(canvas);
    }
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const width = Math.round(pageSize.width * scale * dpr);
    const height = Math.round(pageSize.height * scale * dpr);
    paintInkCanvas(canvas, drawn, width, height, scale * dpr, modeRef.current);
  }, [drawn, pageSize.width, pageSize.height, scale]);

  if (drawn.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      className="ink-strokes-static"
      style={FILL}
    />
  );
});
