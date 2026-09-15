/**
 * The ink host's pure helpers: the fit, the selection's text, a stroke's
 * header. Extracted from `ink-host.tsx` not because they are secret but
 * because they are the parts a test can call without a DOM — the host's
 * three doors are the canvas, the worker and these.
 */

import {
  INK_A4_WIDTH,
  type InkColour,
  type InkPage,
} from "@weaveforge/core";

import type { InkStrokeHeader } from "../application/capture-protocol";
import { nibForTool, type InkBarTool } from "./ink-bar";

/**
 * The fit: how many CSS pixels one 0.1 mm unit is worth.
 *
 * A page is A4 at 0.1 mm and the pane is whatever width it is, so the default
 * view is fit-width and vertical scrolling is the vertical navigation — a
 * page, not an infinite canvas (§1). Zoom is a multiplier on that fit, which
 * keeps "reset" a number rather than a rect, and the worker's transform is
 * one `postMessage` away (§6.2.1: pan and zoom are uniform updates, so
 * neither needs machinery).
 */
export function fitScale(
  containerWidth: number,
  pageWidth = INK_A4_WIDTH,
): number {
  if (!(containerWidth > 0)) return 1;
  return containerWidth / pageWidth;
}

/** The lines the lasso's strokes belong to, as text, one per line. */
export function selectedText(
  page: InkPage,
  indices: readonly number[],
): string {
  const chosen = new Set(indices);
  const out: string[] = [];
  for (const line of page.lines) {
    if (!line.text) continue;
    for (
      let i = line.strokeStart;
      i < line.strokeStart + line.strokeCount;
      i += 1
    ) {
      if (chosen.has(i)) {
        out.push(line.text);
        break;
      }
    }
  }
  return out.join("\n");
}

/** The stroke header a tool produces, so the host and the bar agree. */
export function headerForTool(
  tool: InkBarTool | "shape",
  width: number,
  colour: InkColour,
  pageIndex: number,
  strokeId: number,
): InkStrokeHeader {
  return {
    strokeId,
    pageIndex,
    width: nibForTool(tool, width),
    tool:
      tool === "highlighter"
        ? "highlighter"
        : tool === "shape"
          ? "shape"
          : "pen",
    colour,
  };
}
