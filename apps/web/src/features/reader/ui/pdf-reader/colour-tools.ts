/**
 * Which tool's colour the paper draws with, and which one a mark is recoloured
 * from. Pure, so the mapping is pinned without a page.
 */

import { paletteName, type InkPalette } from "@/features/ink/render/ink-palette";
import { setToolColour, type ToolColourId } from "@/features/ink/ui/use-tool-colours";

import type { ReaderCreateTool } from "../../application/reader-annotation-helpers";
import type { PenTool } from "./use-pen-prefs";

/**
 * The tool whose colour the create actions use right now.
 *
 * While the pen bar is up, the pen's colour is drawn with even when the lasso or
 * the eraser is the tool in hand: neither draws a colour of its own, so the bar's
 * swatch shows the pen's colour there, and that is what a stroke would take.
 */
export function colourToolFor(input: {
  penOpen: boolean;
  penTool: PenTool;
  pickedTool: ReaderCreateTool;
}): ToolColourId {
  if (input.penOpen) return input.penTool === "highlighter" ? "highlighter" : "pen";
  if (input.pickedTool === "highlighter") return "highlighter";
  if (input.pickedTool === "text") return "text";
  // The paper's own selection makes highlights, so its colour is the highlight's.
  if (input.pickedTool === "select") return "highlight";
  return "pen";
}

/**
 * The tool whose quick colours offer a recolour of this mark.
 *
 * A note (`note`) is Zotero's sticky note, which has no tool of its own, and it
 * is written with the pen, so it shares the pen's list.
 */
export function markColourTool(type: string): ToolColourId {
  if (type === "highlight") return "highlight";
  if (type === "underline") return "underline";
  if (type === "text") return "text";
  return "pen";
}

/**
 * Remember the colour a tool was just given, by a create or a recolour. A hex
 * that is not on the palette is not remembered; the mark still takes it.
 */
export function rememberToolColour(tool: ToolColourId, hex: string, palette: InkPalette): void {
  const name = paletteName(palette, hex);
  if (name) setToolColour(tool, name);
}

/**
 * Remember a recolour of an existing mark. A highlight, an underline or a text
 * box recoloured becomes that tool's colour, as a create would. A stroke or a
 * sticky note does not: recolouring an old stroke should not change the colour
 * the pen draws with next.
 */
export function rememberRecolour(type: string, hex: string, palette: InkPalette): void {
  const tool = markColourTool(type);
  if (tool !== "pen") rememberToolColour(tool, hex, palette);
}
