/**
 * Command palette ordering and keys (Rust `command_palette`), re-exported from index.ts.
 */
import {
  paletteModeFor as rawPaletteModeFor,
} from "../pkg/wf_wasm.js";
import type {
  PaletteKey,
  PaletteMode,
} from "./bindings.js";

export {
  commandMatchIndices,
  groupPaletteRows,
  matchingPageIndices,
  sortHitOrder,
} from "../pkg/wf_wasm.js";

export {
  isPreviewKey,
} from "../pkg/wf_wasm.js";

/** The palette mode a key press opens, or `null` (Rust `palette_mode_for`). */
export function paletteModeFor(event: PaletteKey): PaletteMode | null {
  return (rawPaletteModeFor(event) as PaletteMode | undefined) ?? null;
}
