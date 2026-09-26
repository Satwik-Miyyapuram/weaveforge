import { useCallback, useState } from "react";

import { INK_COLOURS } from "@weaveforge/core";

type InkColour = (typeof INK_COLOURS)[number];

const QUICK_COLOURS_KEY = "weaveforge.ink.quick-colours";

/** The five colours the bar offers before anyone changes one. */
export const DEFAULT_QUICK_COLOURS: readonly InkColour[] = ["text", "accent", "red", "blue", "green"];

/**
 * A saved list, read back as five known colours.
 *
 * Anything else — a list of the wrong length, a colour this build has never
 * heard of, a hand-edited string — falls back slot by slot to the default, so
 * one bad entry costs that slot and not the other four.
 */
export function parseQuickColours(saved: string | null): InkColour[] {
  let parsed: unknown = null;
  try {
    parsed = saved ? JSON.parse(saved) : null;
  } catch {
    parsed = null;
  }
  const list = Array.isArray(parsed) ? parsed : [];
  return DEFAULT_QUICK_COLOURS.map((fallback, i) =>
    (INK_COLOURS as readonly unknown[]).includes(list[i]) ? (list[i] as InkColour) : fallback,
  );
}

function readQuickColours(): InkColour[] {
  try {
    return parseQuickColours(window.localStorage.getItem(QUICK_COLOURS_KEY));
  } catch {
    return [...DEFAULT_QUICK_COLOURS];
  }
}

function writeQuickColours(colours: readonly InkColour[]) {
  try {
    window.localStorage.setItem(QUICK_COLOURS_KEY, JSON.stringify(colours));
  } catch {
    // Blocked storage: the change lasts for this session only.
  }
}

/** The bar's quick colours, and a setter for one slot that remembers it on this device. */
export function useQuickColours(): [InkColour[], (slot: number, colour: InkColour) => void] {
  const [colours, setColours] = useState<InkColour[]>(readQuickColours);
  const setSlot = useCallback((slot: number, colour: InkColour) => {
    setColours((was) => {
      const next = was.map((entry, i) => (i === slot ? colour : entry));
      writeQuickColours(next);
      return next;
    });
  }, []);
  return [colours, setSlot];
}
