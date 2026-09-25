"use client";

/**
 * What the pen remembers between papers: the tool in hand, its colour, and its
 * nib.
 *
 * Per user, not per paper — a person who writes in red with a 0.5 mm nib
 * writes that way on every paper, and asking again on each one is the
 * "half-baked" the pen rail exists to replace. Kept in `localStorage` like the
 * reader's other switches (`use-reader-references.ts`), so the desktop app and
 * the web app each keep their own without a server round-trip.
 *
 * The shape is deliberately the ink note's rather than the reader's: the tool
 * is one the shared bar draws (`INK_BAR_TOOLS`), the colour is an ink colour
 * *name* rather than a hex, and the nib is the note's 0.1 mm. That is what lets
 * one toolbar — `features/ink/ui/ink-bar` — drive both surfaces, and it is why
 * a paper's ink is drawn by the note's renderer at the note's nib sizes.
 */

import { useCallback, useEffect, useState } from "react";
import {
  INK_COLOURS,
  INK_PEN_WIDTH,
  INK_PEN_WIDTHS,
  type InkColour,
} from "@weaveforge/core";
import { INK_TOOL_CURSORS, type InkBarTool } from "@/features/ink";
import {
  READER_ANNOTATION_COLORS,
  type ReaderCreateTool,
} from "../../application/reader-annotation-helpers";

const PEN_PREFS_KEY = "weaveforge.reader.pen";

/**
 * The reader's drawing tools, as `ReaderCreateTool` names them.
 *
 * These are the bar's four, one for one: the bar calls them pen, highlighter,
 * eraser and lasso, and the reader calls the first ink because that is the
 * annotation it writes. The paper's own pointer — the one that selects text —
 * is *not* here: it is not a pen tool, and having the lasso stand in for it is
 * what made a loop round a paragraph select the paragraph.
 */
export const PEN_TOOLS = ["lasso", "ink", "highlighter", "erase"] as const;
export type PenTool = (typeof PEN_TOOLS)[number];

/** The bar's tool for one of the reader's, so the shared bar can show it pressed. */
export function barToolFor(tool: PenTool): InkBarTool {
  switch (tool) {
    case "lasso":
      return "lasso";
    case "ink":
      return "pen";
    case "erase":
      return "eraser";
    case "highlighter":
      return "highlighter";
  }
}

/**
 * The reader's tool for one of the bar's. The inverse of {@link barToolFor}.
 *
 * `shape` is a tool the note reaches by chord, never by a bar button, so a
 * paper reading one falls back to the pen rather than to nothing.
 */
export function readerToolFor(tool: InkBarTool | "shape"): PenTool {
  switch (tool) {
    case "lasso":
      return "lasso";
    case "eraser":
      return "erase";
    case "highlighter":
      return "highlighter";
    case "pen":
    case "shape":
      return "ink";
  }
}

/**
 * The pointer a reader tool shows over the page.
 *
 * From the same table the sheet reads (`INK_TOOL_CURSORS`), so an eraser is the
 * same ring on a paper as on a note and a nib is the same crosshair. The pointer
 * tool answers nothing: over a PDF its job is the page's own — the arrow for a
 * mark, the I-beam for the text about to be highlighted — and a cursor that
 * replaced both would be worse at both.
 */
export function inkCursorFor(tool: ReaderCreateTool): string | undefined {
  if (tool === "select") return undefined;
  if (tool === "erase") return INK_TOOL_CURSORS.eraser;
  // The pen, the highlighter, the lasso and the two region tools: all five are
  // aimed at a place on the page and dragged from it.
  return INK_TOOL_CURSORS.pen;
}

export interface PenPrefs {
  tool: PenTool;
  /** An ink colour name; the bar's swatches and the annotation colour both read it. */
  colour: InkColour;
  /** Nib width in the note's unit, 0.1 mm — one of `INK_PEN_WIDTHS`. */
  width: number;
}

/**
 * The marker colours as names, which is how the reader's own palette — the
 * eight hexes a PDF annotation takes — is written down. Older builds stored the
 * hex itself, so this is also the migration path.
 */
const MARKER_COLOURS: readonly InkColour[] = [
  "yellow",
  "red",
  "green",
  "blue",
  "purple",
  "pink",
  "orange",
  "grey",
];

export const DEFAULT_PEN_PREFS: PenPrefs = {
  tool: "ink",
  colour: "red",
  width: INK_PEN_WIDTHS[2] ?? INK_PEN_WIDTH,
};

/** A stored hex back to its name, for the preference shape older builds wrote. */
function colourFromHex(hex: string): InkColour | null {
  const i = READER_ANNOTATION_COLORS.findIndex(
    (candidate) => candidate.toLowerCase() === hex.toLowerCase(),
  );
  return i >= 0 ? (MARKER_COLOURS[i] ?? null) : null;
}

/**
 * The tool a stored preference names.
 *
 * `select` was the lasso before the two became separate tools, and a hand that
 * had chosen it meant "pick marks up" — so it becomes the lasso rather than
 * resetting to the pen.
 */
function toolFromStored(stored: unknown): PenTool {
  if (stored === "select") return "lasso";
  return PEN_TOOLS.find((t) => t === stored) ?? DEFAULT_PEN_PREFS.tool;
}

/** Parse what was stored, dropping anything a newer build no longer means. */
export function parsePenPrefs(raw: unknown): PenPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PEN_PREFS;
  const value = raw as Partial<Record<keyof PenPrefs, unknown>> & {
    /** What a build before the shared bar wrote: a literal hex. */
    color?: unknown;
    /** …and its nib, in PDF points. */
    nib?: unknown;
  };
  const tool = toolFromStored(value.tool);

  const stored =
    typeof value.colour === "string" &&
    (INK_COLOURS as readonly string[]).includes(value.colour)
      ? (value.colour as InkColour)
      : typeof value.color === "string"
        ? colourFromHex(value.color)
        : null;
  const colour = stored ?? DEFAULT_PEN_PREFS.colour;

  const width = INK_PEN_WIDTHS.find((w) => w === value.width) ?? DEFAULT_PEN_PREFS.width;
  return { tool, colour, width };
}

function readPenPrefs(): PenPrefs {
  try {
    return parsePenPrefs(JSON.parse(window.localStorage.getItem(PEN_PREFS_KEY) ?? "null"));
  } catch {
    return DEFAULT_PEN_PREFS;
  }
}

export function usePenPrefs() {
  // Defaults on the server render; the stored choice replaces them on mount
  // so the static export and the first client paint agree.
  const [prefs, setPrefs] = useState<PenPrefs>(DEFAULT_PEN_PREFS);
  useEffect(() => {
    setPrefs(readPenPrefs());
  }, []);

  const update = useCallback((next: PenPrefs | ((prev: PenPrefs) => PenPrefs)) => {
    setPrefs((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      try {
        window.localStorage.setItem(PEN_PREFS_KEY, JSON.stringify(value));
      } catch {
        /* private mode: the choice lasts the session */
      }
      return value;
    });
  }, []);

  return {
    prefs,
    setTool: useCallback((tool: PenTool) => update((p) => ({ ...p, tool })), [update]),
    setColour: useCallback(
      (colour: InkColour) => update((p) => ({ ...p, colour })),
      [update],
    ),
    setWidth: useCallback((width: number) => update((p) => ({ ...p, width })), [update]),
  };
}
