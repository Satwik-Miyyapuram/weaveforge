import type { InkStroke } from "@weaveforge/core";
import { paletteCss, type InkPalette } from "../render/ink-palette";
import type { InkRenderStroke } from "./ink-strokes";

/**
 * The strokes as the one renderer takes them: the colour *name* resolved
 * through the live palette, and the tool carried as the flag the renderer
 * draws with — a highlighter is wide and translucent, a pen is not.
 * Positions in `hidden` are left out.
 */
export function toRenderStrokes(
  strokes: readonly InkStroke[] | undefined,
  palette: InkPalette,
  hidden?: ReadonlySet<number>,
): InkRenderStroke[] {
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
}
