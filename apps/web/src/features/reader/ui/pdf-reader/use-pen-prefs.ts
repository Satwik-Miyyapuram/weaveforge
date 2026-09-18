"use client";

/**
 * What the pen rail remembers between papers: the tool in hand, its colour,
 * the nib, and the last few colours used.
 *
 * Per user, not per paper — a person who writes in red with a 0.5 mm nib
 * writes that way on every paper, and asking again on each one is the
 * "half-baked" the rail exists to replace. Kept in `localStorage` like the
 * reader's other switches (`use-reader-references.ts`), so the desktop app
 * and the web app each keep their own without a server round-trip.
 */

import { useCallback, useEffect, useState } from "react";
import { INK_NIB_DEFAULT_PT, INK_NIB_WIDTHS_PT } from "@weaveforge/core";
import {
  READER_ANNOTATION_COLORS,
  type ReaderCreateTool,
} from "../../application/reader-annotation-helpers";

const PEN_PREFS_KEY = "weaveforge.reader.pen";

/** How many recent colours the rail shows as swatches. */
export const PEN_RECENT_COLOURS = 4;

/** The tools the rail offers. Regions and text boxes stay in the PDF toolbar. */
export const PEN_RAIL_TOOLS = ["select", "ink", "highlighter", "erase"] as const;
export type PenRailTool = (typeof PEN_RAIL_TOOLS)[number];

export interface PenPrefs {
  tool: PenRailTool;
  color: string;
  /** Nib width in PDF points, one of `INK_NIB_WIDTHS_PT`. */
  nib: number;
  /** Most recent first, `PEN_RECENT_COLOURS` long at most. */
  recent: string[];
}

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;

export const DEFAULT_PEN_PREFS: PenPrefs = {
  tool: "ink",
  color: READER_ANNOTATION_COLORS[1],
  nib: INK_NIB_DEFAULT_PT,
  recent: [
    READER_ANNOTATION_COLORS[1],
    READER_ANNOTATION_COLORS[3],
    READER_ANNOTATION_COLORS[2],
    READER_ANNOTATION_COLORS[0],
  ],
};

/** Parse what was stored, dropping anything a newer build no longer means. */
export function parsePenPrefs(raw: unknown): PenPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PEN_PREFS;
  const value = raw as Partial<Record<keyof PenPrefs, unknown>>;
  const tool = PEN_RAIL_TOOLS.find((t) => t === value.tool) ?? DEFAULT_PEN_PREFS.tool;
  const color =
    typeof value.color === "string" && HEX_COLOUR.test(value.color)
      ? value.color.toLowerCase()
      : DEFAULT_PEN_PREFS.color;
  const nib =
    typeof value.nib === "number" && INK_NIB_WIDTHS_PT.includes(value.nib)
      ? value.nib
      : DEFAULT_PEN_PREFS.nib;
  const recent = Array.isArray(value.recent)
    ? value.recent
        .filter((c): c is string => typeof c === "string" && HEX_COLOUR.test(c))
        .map((c) => c.toLowerCase())
        .slice(0, PEN_RECENT_COLOURS)
    : [];
  return { tool, color, nib, recent: recent.length ? recent : DEFAULT_PEN_PREFS.recent };
}

/** A colour was picked: it goes to the front of the recent list, once. */
export function withRecentColour(prefs: PenPrefs, color: string): PenPrefs {
  const c = color.toLowerCase();
  const recent = [c, ...prefs.recent.filter((r) => r !== c)].slice(0, PEN_RECENT_COLOURS);
  return { ...prefs, color: c, recent };
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
    setTool: useCallback((tool: PenRailTool) => update((p) => ({ ...p, tool })), [update]),
    setColor: useCallback((color: string) => update((p) => withRecentColour(p, color)), [update]),
    setNib: useCallback((nib: number) => update((p) => ({ ...p, nib })), [update]),
  };
}

/** Whether a reader tool is one the rail can show as pressed. */
export function isPenRailTool(tool: ReaderCreateTool): tool is PenRailTool {
  return (PEN_RAIL_TOOLS as readonly string[]).includes(tool);
}
