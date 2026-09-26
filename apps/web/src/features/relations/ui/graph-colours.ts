"use client";

import { useEffect, useMemo, useState } from "react";
import { NODE_COLOR_KEYS, type GraphViewSettings, type NodeColorKey } from "@weaveforge/core";
import { EXPERIMENT_COLOR, NOTE_COLOR, PAPER_COLOR, REPORT_COLOR, STATUS_COLORS } from "../domain/graph-palette";
import { readStampStyle, type StampStyle } from "./graph-stamp";

/**
 * The colour each node actually gets on screen.
 *
 * The graph builder colours nodes with the classic palette constants, which
 * double as keys here: every constant a person can recolour maps to whatever
 * the palette setting, the theme and their overrides make of it. The canvas
 * and the legend both read this one map, so a swatch never disagrees with the
 * node it names. Shapes are not in here on purpose: they mean the same thing
 * in every theme.
 */
export const CLASSIC_NODE_COLORS: Record<NodeColorKey, string> = {
  paper: PAPER_COLOR,
  to_read: STATUS_COLORS.to_read ?? "#b9b2a6",
  reading: STATUS_COLORS.reading ?? "#7c9885",
  read: STATUS_COLORS.read ?? "#5a7d8c",
  skimmed: STATUS_COLORS.skimmed ?? "#c98a6b",
  note: NOTE_COLOR,
  report: REPORT_COLOR,
  experiment: EXPERIMENT_COLOR,
};

const THEME_VARS: Record<NodeColorKey, string> = {
  paper: "--chip-reading",
  to_read: "--chip-to-read",
  reading: "--chip-reading",
  read: "--chip-read",
  skimmed: "--chip-skimmed",
  note: "--chip-skimmed",
  report: "--chip-to-read",
  experiment: "--chip-read",
};

export const NODE_COLOR_LABELS: Record<NodeColorKey, string> = {
  paper: "Paper",
  to_read: "To read",
  reading: "Reading",
  read: "Read",
  skimmed: "Skimmed",
  note: "Note",
  report: "Report",
  experiment: "Experiment",
};

export interface GraphColours {
  /** Colour per key, after palette, theme and overrides. */
  byKey: Record<NodeColorKey, string>;
  /** Classic palette constant → colour on screen. */
  fills: Map<string, string>;
  /** Set in the brutal themes, where nodes are drawn as stamps. */
  stamp: StampStyle | null;
}

function resolve(settings: Pick<GraphViewSettings, "nodePalette" | "nodeColors">): GraphColours {
  const css = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const byKey = {} as Record<NodeColorKey, string>;
  const fills = new Map<string, string>();
  for (const key of NODE_COLOR_KEYS) {
    const themed = settings.nodePalette === "theme" ? css?.getPropertyValue(THEME_VARS[key]).trim() : "";
    const colour = settings.nodeColors[key] ?? (themed || CLASSIC_NODE_COLORS[key]);
    byKey[key] = colour;
    fills.set(CLASSIC_NODE_COLORS[key], colour);
  }
  return { byKey, fills, stamp: readStampStyle() };
}

/** The graph's node colours, recomputed when the theme or the settings change. */
export function useGraphColours(settings: Pick<GraphViewSettings, "nodePalette" | "nodeColors">): GraphColours {
  const [themeRev, setThemeRev] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRev((n) => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-mode"] });
    return () => observer.disconnect();
  }, []);
  const colorsKey = JSON.stringify(settings.nodeColors);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- colorsKey stands in for the object
  return useMemo(() => resolve(settings), [settings.nodePalette, colorsKey, themeRev]);
}
