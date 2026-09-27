"use client";

/**
 * A page's finished ink, as every page on screen draws it.
 *
 * One component for the page being written on and for every page around it,
 * in Ink mode and in Read mode alike: the strokes are SVG inside the sheet, so
 * they scroll with their paper as one layer. The live canvas used to draw the
 * page being written on itself, and a canvas the worker repaints a frame or
 * more after each scroll made that page's ink slide against its paper while
 * the page beside it, drawn here, held still. The canvas now draws only the
 * wet ink — the stroke under the pen and a held selection.
 */

import { useMemo } from "react";
import type { InkStroke } from "@weaveforge/core";
import { INK_RENDER_COLOURS, paletteCss, type InkPalette } from "../render/ink-palette";
import { InkStrokes, type InkRenderStroke } from "./ink-strokes";

export interface InkPageInkProps {
  strokes?: readonly InkStroke[];
  /** Page size in page units (0.1 mm): the strokes' own space. */
  pageSize: { width: number; height: number };
  palette?: InkPalette;
  /**
   * Positions in `strokes` left out: a held selection, which the canvas draws
   * where the drag has it.
   */
  hidden?: ReadonlySet<number>;
}

const FILL: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  pointerEvents: "none",
  zIndex: 1,
};

export function InkPageInk({
  strokes,
  pageSize,
  palette = INK_RENDER_COLOURS,
  hidden,
}: InkPageInkProps) {
  /**
   * The strokes as the one renderer takes them: the colour *name* resolved
   * through the live palette, and the tool carried as the flag the renderer
   * draws with — a highlighter is wide and translucent, a pen is not.
   */
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

  if (drawn.length === 0) return null;
  return (
    <InkStrokes
      className="ink-strokes-static"
      viewBox={`0 0 ${pageSize.width} ${pageSize.height}`}
      style={FILL}
      strokes={drawn}
    />
  );
}
