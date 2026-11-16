"use client";

import { decodeStroke, type InkPoint, type InkStroke } from "../application/freeform-ink";

/** The stroke's centre line as an SVG path, in page coordinates. A single point is drawn as a dot. */
export function pathFor(points: readonly InkPoint[]): string {
  const [only] = points;
  if (points.length === 1 && only) return `M${only.x} ${only.y}l0 0`;
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
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
}

/** The page's ink: every stroke, the selected ones marked, and the stroke being drawn. */
export function InkLayer({
  strokes,
  selected,
  draft,
}: {
  strokes: readonly InkStroke[];
  selected: ReadonlySet<string>;
  draft: InkDraft | null;
}) {
  return (
    <svg className="canvas-ink" aria-hidden="true">
      {strokes.map((stroke) => {
        const points = decodeStroke(stroke);
        if (points.length === 0) return null;
        return (
          <path
            key={stroke.id}
            d={pathFor(points)}
            stroke={stroke.c}
            strokeWidth={stroke.w}
            className={strokeClass(stroke, selected.has(stroke.id))}
          />
        );
      })}
      {draft && draft.points.length > 0 ? (
        <path d={pathFor(draft.points)} stroke={draft.colour} strokeWidth={draft.width} className="canvas-ink__stroke canvas-ink__stroke--draft" />
      ) : null}
    </svg>
  );
}
