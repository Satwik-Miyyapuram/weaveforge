"use client";

/** Static ink drawn to a single 2D canvas instead of SVG paths. */

import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { InkStroke } from "@weaveforge/core";
import { INK_RENDER_COLOURS, paletteCss, type InkPalette } from "../render/ink-palette";
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

export function drawInkStrokes(
  ctx: CanvasRenderingContext2D,
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

export const InkPageCanvas = memo(function InkPageCanvas({
  strokes,
  pageSize,
  scale,
  palette = INK_RENDER_COLOURS,
  hidden,
}: InkPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const drawn = useMemo<InkRenderStroke[]>(() => {
    const out: InkRenderStroke[] = [];
    (strokes ?? []).forEach((stroke, at) => {
      if (hidden?.has(at)) return;
      out.push({
        points: stroke.points,
        width: stroke.width,
        colour: paletteCss(palette, stroke.colour),
        highlighter: stroke.tool === "highlighter",
      });
    });
    return out;
  }, [strokes, palette, hidden]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || drawn.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(pageSize.width * scale * dpr);
    canvas.height = Math.round(pageSize.height * scale * dpr);
    const t = perfStart();
    drawInkStrokes(ctx, drawn, scale * dpr);
    perfEnd("ink:page-paint", t, drawn.length);
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
