/**
 * Create-tool rules (Rust `reader_create_tool`). Keeps the pure rules of
 * apps/web/src/features/reader/application/reader-annotation-helpers.ts and
 * ui/pdf-reader/colour-tools.ts.
 */

export type { PagePress } from "./bindings.js";
import type {
  PagePress,
} from "./bindings.js";

export {
  colourToolFor,
  isDismissTap,
  isInkTool,
  markColourTool,
  toolOwnsThePage,
} from "../pkg/wf_wasm.js";

/** The colour a create or recolour draws with. (Narrowing: pure TS literal union, no Rust enum.) */
export type CreateColourTool = "pen" | "highlighter" | "highlight" | "underline" | "text";

