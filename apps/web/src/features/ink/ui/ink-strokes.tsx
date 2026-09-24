"use client";

/**
 * The one ink renderer: a set of strokes, drawn as vector paths.
 *
 * Both surfaces that carry ink draw through this — the ink note's static pages
 * (`InkPageStatic`, the whole of Read mode and the neighbouring halves of Ink
 * mode) and the PDF reader's page overlay — so a stroke looks the same
 * wherever it was written, and a change to how ink is drawn is one change.
 *
 * The geometry comes from `strokePath` (`application/ink-svg`), the same path
 * builder the SVG export uses: the model holds centrelines, and a round cap and
 * join at the nib's width is how a centreline becomes a stroke. The caller
 * decides the coordinate space — the note works in page units with a `viewBox`,
 * the reader works in CSS pixels with the viewBox left out — because that is
 * the one thing the two surfaces genuinely disagree about (a PDF page's ink is
 * anchored in PDF points and projected per zoom and rotation).
 *
 * Pen first, highlighter over it, in that order: a highlighter tints the
 * writing it was laid on, and the pen stays legible through the tint.
 */

import type { CSSProperties, ReactNode } from "react";
import { HIGHLIGHTER_ALPHA } from "../render/canvas-renderer";
import { strokePath } from "../application/ink-svg";

/** One stroke, ready to draw: geometry in the caller's space, colour resolved. */
export interface InkRenderStroke {
  /** Set when the stroke can be selected; also the marquee's key. */
  id?: string;
  /** Flat `x, y` pairs, in the space the caller's `viewBox` (or box) defines. */
  points: readonly number[];
  /** Nib width, in the same space as `points`. */
  width: number;
  /** A resolved CSS colour. An ink note resolves its token through the palette. */
  colour: string;
  /** Wide and translucent, drawn over the pen — the tool, not the width. */
  highlighter: boolean;
}

export interface InkStrokesProps {
  strokes: readonly InkRenderStroke[];
  className?: string;
  /** The user space of `points`; omitted, they are the element's own pixels. */
  viewBox?: string;
  style?: CSSProperties;
  /**
   * How a highlighter is drawn where it is **not** on the app's own paper.
   *
   * On a sheet the model's translucent nib is the whole story (this file's
   * default). A PDF page is somebody else's image — frequently greyscale, and
   * inverted in dark mode — and a broad translucent stroke over it does not
   * read as a highlighter; it reads as a printed block covering the words.
   * The reader therefore styles its own highlighters (multiply over the page,
   * screen in dark mode), and naming that class here is what keeps those rules
   * the reader's rather than a second renderer's.
   *
   * Given, the class carries the highlighter's whole look and the inline alpha
   * is left off; absent, the note's alpha is applied.
   */
  highlighterClassName?: string;
  /**
   * The strokes that are selected, on a surface that offers selection.
   *
   * They are shown the way the ink note shows a lasso selection — a translucent
   * halo down both sides of each stroke (`INK_SELECTION_HALO_PX` on the sheet,
   * the same rule here) — and **not** as a box drawn round them. A box is a
   * highlight's language: a highlight *is* a rectangle of text, so a rectangle
   * round it says something. Ink is a line, and a rectangle round every mark a
   * hand has just made is a frame nobody asked for.
   *
   * A list because a lasso takes a selection: the marks inside the loop are
   * picked up together, and they are shown picked up together.
   */
  selectedIds?: readonly string[];
  /** How far the halo reaches either side of the nib, in the caller's units. */
  haloGrow?: number;
}

export function InkStrokes({
  strokes,
  className,
  viewBox,
  style,
  highlighterClassName,
  selectedIds,
  haloGrow = 0,
}: InkStrokesProps) {
  if (strokes.length === 0) return null;
  const selected = new Set(selectedIds ?? []);

  const draw = (stroke: InkRenderStroke, key: string) => {
    const d = strokePath(stroke);
    if (!d) return null;
    const styled = stroke.highlighter && Boolean(highlighterClassName);
    const held = stroke.id != null && selected.has(stroke.id) && haloGrow > 0;
    const path = (
      <path
        key={key}
        d={d}
        className={styled ? highlighterClassName : undefined}
        stroke={stroke.colour}
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        // A highlighter is the same centreline at its own width, tinted: the
        // model holds no alpha, and one is not needed. A surface that styles
        // its own highlighters says so with `highlighterClassName`, and then
        // its class carries the whole look — alpha here as well would dim it
        // twice.
        strokeOpacity={stroke.highlighter && !styled ? HIGHLIGHTER_ALPHA : undefined}
      />
    );
    if (!held) return path;
    // The halo goes under its stroke, wider by `haloGrow` either side: the same
    // shape as the sheet's lasso selection, and the same shape as the stroke, so
    // it reads as "this line" rather than as a frame around a place.
    return (
      <g key={key}>
        <path
          className="ink-stroke-halo"
          d={d}
          strokeWidth={stroke.width + haloGrow * 2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {path}
      </g>
    );
  };

  // Pen first, highlighter over it — the order the sheet and the SVG export
  // both draw in, and the reason a highlighter never buries the writing.
  const pens: ReactNode[] = [];
  const highlighters: ReactNode[] = [];
  strokes.forEach((stroke, i) => {
    if (stroke.highlighter) highlighters.push(draw(stroke, `h-${i}`));
    else pens.push(draw(stroke, `p-${i}`));
  });

  return (
    <svg
      className={className}
      viewBox={viewBox}
      width="100%"
      height="100%"
      style={style}
      aria-hidden="true"
    >
      {pens}
      {highlighters}
    </svg>
  );
}
