"use client";

import { memo } from "react";
import { decodeStroke, type InkPoint, type InkStroke } from "../application/freeform-ink";
import type { InkRendererKind } from "../../ink/render/freehand-stroke";
import { inkFreedrawPath, isSimulatedPressure } from "../../ink/render/excalidraw-freedraw";
import { resolveInkColour, type ThemeInk } from "../../ink/render/resolve-ink-colour";

/** The stroke's centre line as an SVG path, in page coordinates. A single point is drawn as a dot. */
export function pathFor(points: readonly InkPoint[]): string {
  const [only] = points;
  if (points.length === 1 && only) return `M${only.x} ${only.y}l0 0`;
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

/** A freehand outline is a filled shape, not a stroked line. Inline, so it beats the class's `fill: none`. */
function outlineStyle(colour: string): { fill: string; stroke: string } {
  return { fill: colour, stroke: "none" };
}

/**
 * The stroke's drawn path. `classic` is the centre-line polyline; `freehand` is
 * Excalidraw's freedraw path with our OneNote-matched options (INK_FREEDRAW in
 * ink/render/excalidraw-freedraw), so a sparse or jittered stroke reads as a
 * curve. The stored points are not changed.
 */
export function canvasStrokePath(
  points: readonly InkPoint[],
  width: number,
  tool: string,
  renderer: InkRendererKind,
): string {
  if (renderer === "classic" || points.length < 2) return pathFor(points);
  // Mouse input reports pressure 0.5 (stored as about 128) at every point; a real
  // pen uses its pressure, even when one sample happens to be at the midpoint.
  const pressures = points.map((p) => p.pressure);
  return inkFreedrawPath(
    points.map((p) => [p.x, p.y]),
    pressures,
    width,
    isSimulatedPressure(pressures),
    // Wet and settled take the same path, so the stroke does not change on release.
    true,
  );
}

const settledPaths = new WeakMap<InkStroke, { renderer: InkRendererKind; d: string }>();

/**
 * A settled stroke's path, built once per stroke and renderer. Strokes are
 * replaced, never edited, so a redraw (a draft move, a selection, a theme
 * change) reuses the path instead of decoding and outlining every stroke again.
 */
export function settledCanvasPath(stroke: InkStroke, renderer: InkRendererKind): string {
  const cached = settledPaths.get(stroke);
  if (cached && cached.renderer === renderer) return cached.d;
  const d = canvasStrokePath(decodeStroke(stroke), stroke.w, stroke.t, renderer);
  settledPaths.set(stroke, { renderer, d });
  return d;
}

/** A stroke's classes: a highlighter is drawn translucent (pressure is stored, not drawn). */
export function strokeClass(stroke: InkStroke, selected: boolean): string {
  let name = "canvas-ink__stroke";
  if (stroke.t === "highlighter") name += " canvas-ink__stroke--highlighter";
  return selected ? `${name} canvas-ink__stroke--selected` : name;
}

export interface InkDraft {
  points: readonly InkPoint[];
  colour: string;
  width: number;
  tool: string;
}

/**
 * The page's ink: every stroke, the selected ones marked, and the stroke being
 * drawn. Stored colours are canonical (Paper); they draw through the live theme.
 */
export const InkLayer = memo(function InkLayer({
  strokes,
  selected,
  draft,
  renderer,
  ink,
}: {
  strokes: readonly InkStroke[];
  selected: ReadonlySet<string>;
  draft: InkDraft | null;
  renderer: InkRendererKind;
  ink: ThemeInk;
}) {
  return (
    <svg className="canvas-ink" aria-hidden="true">
      {strokes.map((stroke) => {
        const d = settledCanvasPath(stroke, renderer);
        if (d === "") return null;
        const colour = resolveInkColour(stroke.c, ink);
        return (
          <path
            key={stroke.id}
            d={d}
            stroke={colour}
            strokeWidth={stroke.w}
            style={renderer === "freehand" ? outlineStyle(colour) : undefined}
            className={strokeClass(stroke, selected.has(stroke.id))}
          />
        );
      })}
      {draft && draft.points.length > 0 ? (
        <path
          d={canvasStrokePath(draft.points, draft.width, draft.tool, renderer)}
          stroke={resolveInkColour(draft.colour, ink)}
          strokeWidth={draft.width}
          style={renderer === "freehand" ? outlineStyle(resolveInkColour(draft.colour, ink)) : undefined}
          className="canvas-ink__stroke canvas-ink__stroke--draft"
        />
      ) : null}
    </svg>
  );
});
