import { readyCore } from "@/lib/rust-core";
import { INK_RENDER_COLOURS, type InkPalette } from "@/features/ink/render/parts-1";

/**
 * The pen colour a freeform page starts with: the theme's text colour as a
 * hex, so a new stroke shows on a dark page as well as a light one. A stroke
 * keeps the hex it was drawn with; only the starting choice follows the theme.
 * `null` (no document, as on the server) gives the light theme's text.
 */
export function defaultPenColour(palette: InkPalette | null): string {
  return readyCore().paletteHex(palette ?? INK_RENDER_COLOURS, "text");
}
