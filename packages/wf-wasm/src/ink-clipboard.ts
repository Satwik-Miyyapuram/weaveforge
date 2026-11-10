/**
 * The copied figure and stroke clipboard, re-exported from index.ts. The types come
 * from bindings.ts; the functions are the Rust `ink_clipboard` exports. A parse that
 * finds nothing usable returns `null`.
 */
import {
  parseFigureClip as rawParseFigureClip,
  parseStrokeClip as rawParseStrokeClip,
} from "../pkg/wf_wasm.js";
import type {
  FigureClip,
  InkStroke,
} from "./bindings.js";

export {
  pastedFigurePlace,
  pastedStrokesPlace,
  strokeClipText,
} from "../pkg/wf_wasm.js";

export {
  figureClipText,
} from "../pkg/wf_wasm.js";

export type { FigureClip } from "./bindings.js";

/** The figure a clipboard text names, or `null` (Rust `parse_figure_clip`). */
export function parseFigureClip(text: string | null | undefined): FigureClip | null {
  return rawParseFigureClip(text ?? undefined) as FigureClip | null;
}

/** The strokes a clipboard text carries, or `null` (Rust `parse_stroke_clip`). */
export function parseStrokeClip(text: string | null | undefined): InkStroke[] | null {
  return rawParseStrokeClip(text ?? undefined) as InkStroke[] | null;
}

