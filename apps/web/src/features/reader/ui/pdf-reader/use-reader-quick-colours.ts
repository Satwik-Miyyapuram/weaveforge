import { useCallback, useState } from "react";

import { READER_ANNOTATION_COLORS } from "../../application/reader-annotation-helpers";

const READER_QUICK_COLOURS_KEY = "weaveforge.reader.quick-colours";

/** The five highlighter colours the read palette offers before anyone changes one. */
export const DEFAULT_READER_QUICK_COLOURS: readonly string[] = READER_ANNOTATION_COLORS.slice(0, 5);

/** A saved list, read back slot by slot; an unknown entry costs its slot only (as `use-quick-colours.ts`). */
export function parseReaderQuickColours(saved: string | null): string[] {
  let parsed: unknown = null;
  try {
    parsed = saved ? JSON.parse(saved) : null;
  } catch {
    parsed = null;
  }
  const list = Array.isArray(parsed) ? parsed : [];
  return DEFAULT_READER_QUICK_COLOURS.map((fallback, i) =>
    (READER_ANNOTATION_COLORS as readonly unknown[]).includes(list[i]) ? (list[i] as string) : fallback,
  );
}

function readReaderQuickColours(): string[] {
  try {
    return parseReaderQuickColours(window.localStorage.getItem(READER_QUICK_COLOURS_KEY));
  } catch {
    return [...DEFAULT_READER_QUICK_COLOURS];
  }
}

/** The read palette's quick colours, and a setter for one slot that remembers it on this device. */
export function useReaderQuickColours(): [string[], (slot: number, colour: string) => void] {
  const [colours, setColours] = useState<string[]>(readReaderQuickColours);
  const setSlot = useCallback((slot: number, colour: string) => {
    setColours((was) => {
      const next = was.map((entry, i) => (i === slot ? colour : entry));
      try {
        window.localStorage.setItem(READER_QUICK_COLOURS_KEY, JSON.stringify(next));
      } catch {
        // Blocked storage: the change lasts for this session only.
      }
      return next;
    });
  }, []);
  return [colours, setSlot];
}
