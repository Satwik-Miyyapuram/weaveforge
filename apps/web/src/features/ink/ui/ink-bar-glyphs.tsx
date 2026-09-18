/**
 * The ink bar's glyphs and names: the icon each tool draws, and the labels the
 * bar prints for tools and papers. Data the bar reads, kept out of the bar so
 * the bar is its layout and its handlers.
 */

import type { InkPaper } from "@weaveforge/core";

import type { InkBarTool } from "./ink-bar";

export { toolIcon } from "@/components/ink-tool-icons";

/** The label a tool shows. `shape` is reachable by chord and by hold, not by tool. */
export function toolLabel(tool: InkBarTool | "shape"): string {
  switch (tool) {
    case "pen":
      return "Pen";
    case "highlighter":
      return "Highlighter";
    case "eraser":
      return "Eraser";
    case "lasso":
      return "Lasso";
    case "shape":
      return "Shape";
  }
}

/** The paper's name on the layout menu. */
export function paperLabel(paper: InkPaper): string {
  switch (paper) {
    case "blank":
      return "Blank";
    case "dotted":
      return "Dotted";
    case "ruled":
      return "Ruled";
    case "grid":
      return "Grid";
    case "wide":
      return "Wide ruled";
  }
}
