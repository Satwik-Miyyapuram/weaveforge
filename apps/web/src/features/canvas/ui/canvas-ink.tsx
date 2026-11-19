"use client";

import { decodeStroke, type InkPoint, type InkStroke } from "../application/freeform-ink";
import type { InkRendererKind } from "../../ink/render/freehand-stroke";
import { inkFreedrawPath } from "../../ink/render/excalidraw-freedraw";

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
  // Mouse input reports pressure 0.5 (stored as about 128); a real pen uses its pressure.
  const simulatePressure = Math.abs((points[0]?.pressure ?? 0.5) - 0.5) <= 1 / 255;
  return inkFreedrawPath(
    points.map((p) => [p.x, p.y]),
    points.map((p) => p.pressure),
    width,
    simulatePressure,
    // Wet and settled take the same path, so the stroke does not change on release.
    true,
  );
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

/** The page's ink: every stroke, the selected ones marked, and the stroke being drawn. */
export function InkLayer({
  strokes,
  selected,
  draft,
  renderer,
}: {
  strokes: readonly InkStroke[];
  selected: ReadonlySet<string>;
  draft: InkDraft | null;
  renderer: InkRendererKind;
}) {
  return (
    <svg className="canvas-ink" aria-hidden="true">
      {strokes.map((stroke) => {
        const points = decodeStroke(stroke);
        if (points.length === 0) return null;
        return (
          <path
            key={stroke.id}
            d={canvasStrokePath(points, stroke.w, stroke.t, renderer)}
            stroke={stroke.c}
            strokeWidth={stroke.w}
            style={renderer === "freehand" ? outlineStyle(stroke.c) : undefined}
            className={strokeClass(stroke, selected.has(stroke.id))}
          />
        );
      })}
      {draft && draft.points.length > 0 ? (
        <path
          d={canvasStrokePath(draft.points, draft.width, draft.tool, renderer)}
          stroke={draft.colour}
          strokeWidth={draft.width}
          style={renderer === "freehand" ? outlineStyle(draft.colour) : undefined}
          className="canvas-ink__stroke canvas-ink__stroke--draft"
        />
      ) : null}
    </svg>
  );
}
