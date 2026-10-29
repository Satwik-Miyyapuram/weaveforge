"use client";

/**
 * What the pen remembers between papers: the tool in hand and its nib. Colours
 * are kept per tool in `features/ink/ui/use-tool-colours.ts`.
 *
 * Per user, not per paper — a person who writes in red with a 0.5 mm nib
 * writes that way on every paper, and asking again on each one is the
 * "half-baked" the pen rail exists to replace. Kept in `localStorage` like the
 * reader's other switches (`use-reader-references.ts`), so the desktop app and
 * the web app each keep their own without a server round-trip.
 *
 * The shape is deliberately the ink note's rather than the reader's: the tool
 * is one the shared bar draws (`INK_BAR_TOOLS`), and the nib is the note's 0.1 mm. That is what lets
 * one toolbar — `features/ink/ui/ink-bar` — drive both surfaces, and it is why
 * a paper's ink is drawn by the note's renderer at the note's nib sizes.
 */

import { useCallback, useEffect, useState } from "react";
import {
  INK_HIGHLIGHTER_WIDTH,
  INK_HIGHLIGHTER_WIDTHS,
  INK_PEN_WIDTH,
  INK_PEN_WIDTHS,
} from "@weaveforge/core";
import { INK_TOOL_CURSORS, inkToolCursor, type InkBarTool, type InkCursorInk } from "@/features/ink";
import { readToolColours } from "@/features/ink/ui/use-tool-colours";
import { readStoredJson, writeStoredJson } from "@/lib/safe-storage";
import type { ReaderCreateTool } from "../../application/reader-annotation-helpers";

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
 * same block on a paper as on a note and a pen the same dot of its ink. The pointer
 * tool answers nothing: over a PDF its job is the page's own — the arrow for a
 * mark, the I-beam for the text about to be highlighted — and a cursor that
 * replaced both would be worse at both.
 */
export function inkCursorFor(tool: ReaderCreateTool, ink?: InkCursorInk): string | undefined {
  if (tool === "select") return undefined;
  if (tool === "erase") return INK_TOOL_CURSORS.eraser;
  if (tool === "ink") return inkToolCursor("pen", ink);
  if (tool === "highlighter") return inkToolCursor("highlighter", ink);
  if (tool === "lasso") return INK_TOOL_CURSORS.lasso;
  // The two region tools: a corner aimed at and dragged from.
  return INK_TOOL_CURSORS.shape;
}

export interface PenPrefs {
  tool: PenTool;
  /** Nib width in the note's unit, 0.1 mm — one of `INK_PEN_WIDTHS`. */
  width: number;
  /** The highlighter's width, 0.1 mm — one of `INK_HIGHLIGHTER_WIDTHS`. */
  highlighterWidth: number;
}

export const DEFAULT_PEN_PREFS: PenPrefs = {
  tool: "ink",
  width: INK_PEN_WIDTHS[2] ?? INK_PEN_WIDTH,
  highlighterWidth: INK_HIGHLIGHTER_WIDTH,
};

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
  const value = raw as Partial<Record<keyof PenPrefs, unknown>>;
  const tool = toolFromStored(value.tool);

  const width = INK_PEN_WIDTHS.find((w) => w === value.width) ?? DEFAULT_PEN_PREFS.width;
  const highlighterWidth =
    INK_HIGHLIGHTER_WIDTHS.find((w) => w === value.highlighterWidth) ?? DEFAULT_PEN_PREFS.highlighterWidth;
  return { tool, width, highlighterWidth };
}

function readPenPrefs(): PenPrefs {
  return parsePenPrefs(readStoredJson<unknown>(PEN_PREFS_KEY, null));
}

/**
 * Save the pen's preferences. The colours are read first, so a build's old
 * colour is migrated into the tool-colours key before this write drops it
 * from the pen preference.
 */
export function persistPenPrefs(value: PenPrefs) {
  readToolColours();
  writeStoredJson(PEN_PREFS_KEY, value);
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
      // Private mode: the choice lasts the session.
      persistPenPrefs(value);
      return value;
    });
  }, []);

  return {
    prefs,
    setTool: useCallback((tool: PenTool) => update((p) => ({ ...p, tool })), [update]),
    setWidth: useCallback((width: number) => update((p) => ({ ...p, width })), [update]),
    setHighlighterWidth: useCallback(
      (highlighterWidth: number) => update((p) => ({ ...p, highlighterWidth })),
      [update],
    ),
  };
}
