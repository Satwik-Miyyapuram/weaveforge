/**
 * The copied figure and stroke clipboard, re-exported from index.ts. The types come
 * from bindings.ts; the functions are the Rust `ink_clipboard` exports. A parse that
 * finds nothing usable returns `null`.
 */
import {
  figureClipText as rawFigureClipText,
  parseFigureClip as rawParseFigureClip,
  pastedFigurePlace as rawPastedFigurePlace,
  strokeClipText as rawStrokeClipText,
  parseStrokeClip as rawParseStrokeClip,
  pastedStrokesPlace as rawPastedStrokesPlace,
} from "../pkg/wf_wasm.js";
import type {
  FigureBox,
  FigureClip,
  FigurePlacement,
  InkPageSize,
  InkStroke,
} from "./bindings.js";

export type { FigureClip } from "./bindings.js";

/** The clipboard text for a copied figure (Rust `figure_clip_text`). */
export function figureClipText(clip: FigureClip): string {
  return rawFigureClipText(clip);
}

/** The figure a clipboard text names, or `null` (Rust `parse_figure_clip`). */
export function parseFigureClip(text: string | null | undefined): FigureClip | null {
  return rawParseFigureClip(text ?? undefined) as FigureClip | null;
}

/** Where a pasted figure goes on the page (Rust `pasted_figure_place`). */
export function pastedFigurePlace(
  figure: FigurePlacement,
  onPage: readonly FigureBox[],
  page: InkPageSize,
): FigurePlacement {
  return rawPastedFigurePlace(figure, onPage, page) as FigurePlacement;
}

/** The clipboard text for a set of strokes (Rust `stroke_clip_text`). */
export function strokeClipText(strokes: readonly InkStroke[]): string {
  return rawStrokeClipText(strokes);
}

/** The strokes a clipboard text carries, or `null` (Rust `parse_stroke_clip`). */
export function parseStrokeClip(text: string | null | undefined): InkStroke[] | null {
  return rawParseStrokeClip(text ?? undefined) as InkStroke[] | null;
}

/** Where pasted strokes land on the page (Rust `pasted_strokes_place`). */
export function pastedStrokesPlace(
  strokes: readonly InkStroke[],
  onPage: readonly InkStroke[],
  page: InkPageSize,
): InkStroke[] {
  return rawPastedStrokesPlace(strokes, onPage, page) as InkStroke[];
}
