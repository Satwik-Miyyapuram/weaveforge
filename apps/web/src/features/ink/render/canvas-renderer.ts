/**
 * The Canvas 2D fallback: the same `InkRenderer` contract, drawn with paths.
 *
 * This is what a page looks like where WebGL2 is unavailable or has been lost
 * for good (§6.2.9): a Chromebook with GPU rasterisation blocked, a remote
 * desktop, a browser flag. It is not the fast path and does not try to be —
 * every frame repaints every stroke — but the *result* must be the WebGL
 * renderer's, pixel for pixel where a path can manage it, because the note is
 * the same note whichever backend drew it.
 *
 * Two of the WebGL renderer's rules survive the translation:
 *
 * - **A stroke is capsules, not a `lineTo` polyline.** Width varies per point
 *   with pressure and speed (D3), and a polyline has one width. Each segment is
 *   a filled quad with round caps — the same geometry `packStrokeInstances`
 *   sends the GPU — so the taper matches.
 * - **The highlighter is deduped per stroke.** Where the GPU uses the stencil,
 *   this builds each highlighter stroke as one path and fills it once at 35 %,
 *   so a stroke's own overlapping capsules do not darken. Two crossing
 *   highlighter strokes still darken where they cross; the WebGL pass dedupes
 *   per frame rather than per stroke, and the difference is not one a note shows.
 *
 * `capture` draws into a fresh offscreen canvas rather than reading back this
 * one, for the reason the interface gives.
 */

import type { InkColour } from "@weaveforge/core";

import type { InkStrokeGeometry } from "../application/page-buffer";
import {
  radiusAt,
  type InkLiveStroke,
  type InkRenderStats,
  type InkRenderer,
  type InkViewTransform,
} from "./ink-renderer";
import { INK_RENDER_COLOURS } from "./webgl-renderer";

/** The 2D context, whichever canvas it came from. */
export type Context2dLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A canvas this renderer can paint: on the worker or, in a test, a double. */
export interface Canvas2dLike {
  width: number;
  height: number;
  getContext(kind: "2d"): Context2dLike | null;
  convertToBlob?(options?: { type?: string }): Promise<Blob>;
}

export interface CanvasInkRendererOptions {
  canvas: Canvas2dLike;
  /** Where an export target comes from. Injected so a test needs no DOM. */
  createCanvas?: (width: number, height: number) => Canvas2dLike;
}

export const HIGHLIGHTER_ALPHA = 0.35;

/** Paper rulings in 0.1 mm: lines every 8 mm, dots and grid every 5 mm (§6.1). */
export const PAPER_RULED_PITCH = 80;
export const PAPER_GRID_PITCH = 50;

export function cssInkColour(colour: InkColour, alpha = 1): string {
  const [r, g, b] = INK_RENDER_COLOURS[colour] ?? INK_RENDER_COLOURS.text;
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`;
}

export class CanvasInkRenderer implements InkRenderer {
  readonly backend = "canvas2d" as const;

  private readonly canvas: Canvas2dLike;
  private readonly createCanvas: (width: number, height: number) => Canvas2dLike;
  private context: Context2dLike | null;
  private strokes = new Map<number, InkStrokeGeometry>();
  private order: number[] = [];
  private live: InkLiveStroke | null = null;
  private transform: InkViewTransform = { scale: 1, offsetX: 0, offsetY: 0, devicePixelRatio: 1 };
  private pageWidth = 0;
  private pageHeight = 0;
  private paper = "blank";
  private width = 0;
  private height = 0;
  private drawn = 0;
  private nextIndex = 0;

  constructor(options: CanvasInkRendererOptions) {
    this.canvas = options.canvas;
    this.createCanvas =
      options.createCanvas ??
      ((width, height) => new OffscreenCanvas(width, height) as unknown as Canvas2dLike);
    this.context = options.canvas.getContext("2d");
    if (!this.context) throw new Error("Canvas 2D is unavailable");
  }

  get renderStats(): InkRenderStats {
    let segments = 0;
    for (const stroke of this.strokes.values()) segments += Math.max(0, stroke.x.length - 1);
    return { backend: "canvas2d", strokes: this.strokes.size, segments, drawn: this.drawn, marginPx: 0 };
  }

  setPage(size: { width: number; height: number }, paper: string): void {
    this.pageWidth = size.width;
    this.pageHeight = size.height;
    this.paper = paper;
  }

  setStrokes(strokes: readonly (InkStrokeGeometry | null)[]): void {
    this.strokes.clear();
    this.order = [];
    strokes.forEach((stroke, index) => {
      if (stroke) this.appendStroke(stroke, index);
    });
    this.nextIndex = strokes.length;
  }

  appendStroke(stroke: InkStrokeGeometry, index = this.nextIndex): void {
    this.nextIndex = index + 1;
    this.strokes.set(index, stroke);
    this.order.push(index);
  }

  removeStroke(index: number): void {
    if (!this.strokes.delete(index)) return;
    const at = this.order.indexOf(index);
    if (at >= 0) this.order.splice(at, 1);
  }

  setLive(stroke: InkLiveStroke | null): void {
    this.live = stroke;
  }

  setTransform(transform: InkViewTransform): void {
    this.transform = transform;
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
    this.height = Math.max(1, Math.round(cssHeight * devicePixelRatio));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  draw(): void {
    const context = this.context;
    if (!context) return;
    this.paint(context, this.transform, this.width, this.height, false);
  }

  async capture(scale: number): Promise<Blob | null> {
    const width = Math.max(1, Math.round(this.pageWidth * scale));
    const height = Math.max(1, Math.round(this.pageHeight * scale));
    const target = this.createCanvas(width, height);
    const context = target.getContext("2d");
    if (!context || !target.convertToBlob) return null;
    this.paint(context, { scale, offsetX: 0, offsetY: 0, devicePixelRatio: 1 }, width, height, true);
    return target.convertToBlob({ type: "image/png" });
  }

  dispose(): void {
    this.strokes.clear();
    this.order = [];
    this.live = null;
    this.context = null;
  }

  /* --------------------------------------------------------------- drawing */

  private paint(
    context: Context2dLike,
    transform: InkViewTransform,
    width: number,
    height: number,
    opaque: boolean,
  ): void {
    context.setTransform(1, 0, 0, 1, 0, 0);
    if (opaque) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    } else {
      context.clearRect(0, 0, width, height);
    }
    const k = transform.scale * transform.devicePixelRatio;
    context.setTransform(
      k,
      0,
      0,
      k,
      transform.offsetX * transform.devicePixelRatio,
      transform.offsetY * transform.devicePixelRatio,
    );
    if (opaque) paintPaper(context, this.paper, this.pageWidth, this.pageHeight);

    this.drawn = 0;
    // Pen strokes first, then highlighters over them at 35 %: the WebGL order.
    for (const pass of ["pen", "highlighter"] as const) {
      for (const index of this.order) {
        const stroke = this.strokes.get(index);
        if (!stroke) continue;
        const highlighter = stroke.tool === "highlighter";
        if ((pass === "highlighter") !== highlighter) continue;
        this.drawn += paintStroke(context, stroke.x, stroke.y, stroke.pressure, stroke, highlighter);
      }
    }
    if (this.live) {
      const live = this.live;
      this.drawn += paintStroke(
        context,
        live.x,
        live.y,
        live.pressure,
        live.header,
        live.header.tool === "highlighter",
      );
    }
  }
}

/** Fill one stroke as a union of capsules. Returns the segments drawn. */
export function paintStroke(
  context: Context2dLike,
  x: Float32Array,
  y: Float32Array,
  pressure: Uint8Array,
  stroke: { width: number; tool: string; colour: InkColour },
  highlighter: boolean,
): number {
  const count = x.length;
  if (count === 0) return 0;
  const input = { x, y, pressure, width: stroke.width, variableWidth: stroke.tool === "pen" };
  context.fillStyle = cssInkColour(stroke.colour, highlighter ? HIGHLIGHTER_ALPHA : 1);
  context.beginPath();
  if (count === 1) {
    context.arc(x[0]!, y[0]!, radiusAt(input, 0), 0, Math.PI * 2);
    context.fill();
    return 1;
  }
  for (let i = 0; i + 1 < count; i += 1) {
    capsule(context, x[i]!, y[i]!, radiusAt(input, i), x[i + 1]!, y[i + 1]!, radiusAt(input, i + 1));
  }
  // One fill per stroke with the non-zero rule: overlapping capsules of the same
  // stroke paint once, which is what keeps a translucent highlighter even.
  context.fill("nonzero");
  return count - 1;
}

/** The paper's ruling, drawn under the ink on an opaque export. */
export function paintPaper(
  context: Context2dLike,
  paper: string,
  pageWidth: number,
  pageHeight: number,
): void {
  if (paper === "blank") return;
  context.strokeStyle = "rgba(0, 0, 0, 0.12)";
  context.fillStyle = "rgba(0, 0, 0, 0.18)";
  context.lineWidth = 2;
  const rule = (x0: number, y0: number, x1: number, y1: number) => {
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
  };
  if (paper === "ruled") {
    for (let yy = PAPER_RULED_PITCH; yy < pageHeight; yy += PAPER_RULED_PITCH) rule(0, yy, pageWidth, yy);
  } else if (paper === "grid") {
    for (let yy = PAPER_GRID_PITCH; yy < pageHeight; yy += PAPER_GRID_PITCH) rule(0, yy, pageWidth, yy);
    for (let xx = PAPER_GRID_PITCH; xx < pageWidth; xx += PAPER_GRID_PITCH) rule(xx, 0, xx, pageHeight);
  } else if (paper === "dotted") {
    for (let yy = PAPER_GRID_PITCH; yy < pageHeight; yy += PAPER_GRID_PITCH) {
      for (let xx = PAPER_GRID_PITCH; xx < pageWidth; xx += PAPER_GRID_PITCH) {
        context.beginPath();
        context.arc(xx, yy, 2.5, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}

/** One segment as a closed capsule outline, appended to the current path. */
function capsule(
  context: Context2dLike,
  ax: number,
  ay: number,
  ra: number,
  bx: number,
  by: number,
  rb: number,
): void {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-3) {
    context.moveTo(ax + ra, ay);
    context.arc(ax, ay, ra, 0, Math.PI * 2);
    return;
  }
  const angle = Math.atan2(dy, dx);
  // A round cap at each end and the two tangent edges between them. With
  // differing radii the edges are not quite parallel, which is the taper.
  context.moveTo(ax + Math.cos(angle + Math.PI / 2) * ra, ay + Math.sin(angle + Math.PI / 2) * ra);
  context.arc(ax, ay, ra, angle + Math.PI / 2, angle - Math.PI / 2);
  context.arc(bx, by, rb, angle - Math.PI / 2, angle + Math.PI / 2);
  context.closePath();
}
