import type { GNode } from "../application/build-graph-data";

/**
 * The poster look for graph nodes: the chip colours, an ink outline and an
 * offset shadow, the same stamp every card in the brutal themes carries.
 *
 * The shape is the canvas's own for each kind, so a node reads the same in
 * every theme; the fill comes from `graph-colours`.
 */
export interface StampStyle {
  ink: string;
  surface: string;
  font: string;
}

const BRUTAL_THEMES = new Set(["brutal", "brutal-dark", "crt"]);

/** The stamp style for the current theme, or null when the theme draws plain nodes. */
export function readStampStyle(): StampStyle | null {
  if (typeof document === "undefined") return null;
  const root = document.documentElement;
  if (!BRUTAL_THEMES.has(root.dataset.theme ?? "")) return null;
  const css = getComputedStyle(root);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return { ink: v("--bw-line", "#12110f"), surface: v("--surface", "#fffdf6"), font: v("--font", "sans-serif") };
}

/** Grows a node for the stamp: an outline eats into a small shape. */
export function stampRadius(r: number): number {
  return r * 1.35 + 1.5;
}

/**
 * Paints a node as a stamp. `trace` draws the node's outline path at a given
 * offset and radius, so the shape stays whatever the canvas draws for its kind.
 */
export function paintStamp(
  ctx: CanvasRenderingContext2D,
  node: GNode,
  r: number,
  zoom: number,
  style: StampStyle,
  fill: string,
  trace: (dx: number, dy: number, r: number) => void,
): void {
  const z = Math.max(0.01, zoom);
  const line = Math.min(4, Math.max(0.4, 1.5 / z));
  const drop = Math.min(6, Math.max(0.6, 2.2 / z));
  trace(drop, drop, r);
  ctx.fillStyle = style.ink;
  ctx.fill();
  trace(0, 0, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = style.ink;
  ctx.stroke();
  if (node.kind === "experiment") {
    // A run gets a second ring, so it reads apart from a paper of the same colour.
    trace(0, 0, r + line * 2.2);
    ctx.stroke();
  }
}

/** Paints a label as a small stamped tag above its node. */
export function paintStampLabel(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  fontSize: number,
  zoom: number,
  style: StampStyle,
): { x1: number; y1: number; x2: number; y2: number } {
  ctx.font = `700 ${fontSize}px ${style.font}`;
  const w = ctx.measureText(label).width;
  const padX = fontSize * 0.45;
  const padY = fontSize * 0.28;
  const box = { x1: x - w / 2 - padX, y1: y - fontSize - padY, x2: x + w / 2 + padX, y2: y + padY };
  ctx.fillStyle = style.surface;
  ctx.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
  const z = Math.max(0.01, zoom);
  ctx.lineWidth = Math.min(3, Math.max(0.3, 1.1 / z));
  ctx.strokeStyle = style.ink;
  ctx.strokeRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
  ctx.fillStyle = style.ink;
  ctx.textAlign = "center";
  ctx.fillText(label, x, y - fontSize * 0.08);
  return box;
}
