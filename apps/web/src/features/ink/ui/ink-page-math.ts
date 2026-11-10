/**
 * The ink host's pure helpers: the fit, the selection's text and the
 * figure boxes. Extracted from `ink-host.tsx` not because they are secret but
 * because they are the parts a test can call without a DOM — the host's
 * three doors are the canvas, the worker and these.
 */

import {
  INK_A4_WIDTH,
  type InkPage,
} from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

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
  return readyCore().fitScale(containerWidth, pageWidth);
}

/** The lines the lasso's strokes belong to, as text, one per line. */
export function selectedText(
  page: InkPage,
  indices: readonly number[],
): string {
  return readyCore().selectedText(page.lines, indices);
}

type Box = { x: number; y: number; w: number; h: number };
type At = { x: number; y: number };

/** The topmost figure whose box holds `at`, edges included; no corner slack. */
export function figureUnder(
  figures: readonly (Box | undefined)[],
  at: At,
  skip: number | null = null,
): number | null {
  return readyCore().figureUnder(figures, at, skip);
}

/**
 * The figure a double-click opens: both presses and the click itself land
 * inside one box. A near miss or a press that started elsewhere opens nothing.
 */
export function doubleClickFigure(
  figures: readonly (Box | undefined)[],
  points: readonly At[],
  skip: number | null = null,
): number | null {
  return readyCore().doubleClickFigure(figures, points, skip);
}
