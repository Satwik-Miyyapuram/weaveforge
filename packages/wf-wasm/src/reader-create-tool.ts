/**
 * Create-tool rules (Rust `reader_create_tool`). Keeps the pure rules of
 * apps/web/src/features/reader/application/reader-annotation-helpers.ts and
 * ui/pdf-reader/colour-tools.ts.
 */
import {
  colourToolFor as rawColourToolFor,
  isDismissTap as rawIsDismissTap,
  isInkTool as rawIsInkTool,
  markColourTool as rawMarkColourTool,
  toolOwnsThePage as rawToolOwnsThePage,
} from "../pkg/wf_wasm.js";

export type { PagePress } from "./bindings.js";
import type { PagePress } from "./bindings.js";

/** The colour a create or recolour draws with. (Narrowing: pure TS literal union, no Rust enum.) */
export type CreateColourTool = "pen" | "highlighter" | "highlight" | "underline" | "text";

/** `ink` and `highlighter` draw on the page. */
export function isInkTool(tool: string): boolean {
  return rawIsInkTool(tool);
}

/** Every tool but `select` takes the page away from the browser's text selection. */
export function toolOwnsThePage(tool: string): boolean {
  return rawToolOwnsThePage(tool);
}

/** A short press that barely moved, off an open create bar, dismisses the bar. */
export function isDismissTap(down: PagePress | null, up: PagePress, barOpen: boolean): boolean {
  return rawIsDismissTap(down, up, barOpen);
}

/** The tool whose colour the create actions use right now. */
export function colourToolFor(penOpen: boolean, penTool: string, pickedTool: string): CreateColourTool {
  return rawColourToolFor(penOpen, penTool, pickedTool) as CreateColourTool;
}

/** The tool whose quick colours offer a recolour of this mark. */
export function markColourTool(markType: string): CreateColourTool {
  return rawMarkColourTool(markType) as CreateColourTool;
}
