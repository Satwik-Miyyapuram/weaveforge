/**
 * The ink bar's glyphs and names: the icon each tool draws, and the labels the
 * bar prints for tools and papers. Data the bar reads, kept out of the bar so
 * the bar is its layout and its handlers.
 */

import type { InkPaper } from "@weaveforge/core";

import type { InkBarTool } from "./ink-bar";

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

export function toolIcon(tool: InkBarTool) {
  switch (tool) {
    case "pen":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      );
    case "highlighter":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 11-6 6v3h3l6-6" />
          <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
        </svg>
      );
    case "eraser":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
          <path d="M22 21H7" />
          <path d="m5 11 9 9" />
        </svg>
      );
    case "lasso":
      return (
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 22a5 5 0 0 1-2-4" />
          <path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1" />
          <path d="M5 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
        </svg>
      );
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
