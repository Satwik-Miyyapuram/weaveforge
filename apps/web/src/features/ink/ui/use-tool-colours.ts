/**
 * Each drawing tool's own colour and its own five quick colours, remembered on
 * this device.
 *
 * One key holds every tool, so the pen, the highlighter, a highlight, an
 * underline and a text box each keep the colour they were last given. Every
 * pane reads the same cache, so a change made in one reader shows in the others.
 *
 * Migration: a build before this one kept the pen's colour in the reader's pen
 * preference and its quick colours in their own key. A tool the tool-colours
 * key does not hold (all of them, when the key is absent or malformed) takes
 * those values for the pen and the text box, and the defaults for the rest; a
 * tool it does hold keeps its own. The first load writes the result to the new
 * key, and a pen preference write reads the colours first (`persistPenPrefs`),
 * so the old keys are never the only copy.
 *
 * Another window's change arrives as a `storage` event, which drops the cache,
 * so this window's next write builds on it instead of overwriting it.
 */

import { useSyncExternalStore } from "react";
import { INK_COLOURS, type InkColour } from "@weaveforge/core";

import { READER_ANNOTATION_COLORS } from "@/features/reader/application/reader-annotation-helpers";
import { readStored, readStoredJson, writeStoredJson } from "@/lib/safe-storage";

const TOOL_COLOUR_KEY = "weaveforge.ink.tool-colours";
const LEGACY_PEN_PREFS_KEY = "weaveforge.reader.pen";
const LEGACY_QUICK_COLOURS_KEY = "weaveforge.ink.quick-colours";

export const TOOL_COLOUR_IDS = ["pen", "highlighter", "highlight", "underline", "text"] as const;
export type ToolColourId = (typeof TOOL_COLOUR_IDS)[number];

export interface ToolColour {
  colour: InkColour;
  /** Always five slots. */
  quick: InkColour[];
}

export type ToolColours = Record<ToolColourId, ToolColour>;

const PEN_QUICK: readonly InkColour[] = ["text", "accent", "red", "blue", "green"];
const HIGHLIGHTER_QUICK: readonly InkColour[] = ["yellow", "green", "pink", "blue", "orange"];
const UNDERLINE_QUICK: readonly InkColour[] = ["red", "blue", "green", "purple", "text"];

export const DEFAULT_TOOL_COLOURS: ToolColours = {
  pen: { colour: "text", quick: [...PEN_QUICK] },
  highlighter: { colour: "yellow", quick: [...HIGHLIGHTER_QUICK] },
  highlight: { colour: "yellow", quick: [...HIGHLIGHTER_QUICK] },
  underline: { colour: "red", quick: [...UNDERLINE_QUICK] },
  text: { colour: "text", quick: [...PEN_QUICK] },
};

/** The reader's marker colours by name, in the order of its palette hexes. */
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

function isInkColour(value: unknown): value is InkColour {
  return (INK_COLOURS as readonly unknown[]).includes(value);
}

/** A saved five-slot list, slot by slot, with the fallback for any bad slot. */
export function quickFrom(raw: unknown, fallback: readonly InkColour[]): InkColour[] {
  const list = Array.isArray(raw) ? raw : [];
  return fallback.map((entry, i) => (isInkColour(list[i]) ? list[i] : entry));
}

/** The pen's colour as the reader's old preference wrote it: a name, or a palette hex. */
export function legacyPenColour(raw: unknown): InkColour | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as { colour?: unknown; color?: unknown };
  if (isInkColour(value.colour)) return value.colour;
  if (typeof value.color === "string") {
    const hex = value.color.toLowerCase();
    const i = READER_ANNOTATION_COLORS.findIndex((candidate) => candidate.toLowerCase() === hex);
    return i >= 0 ? (MARKER_COLOURS[i] ?? null) : null;
  }
  return null;
}

export interface LegacyPen {
  colour: InkColour | null;
  quick: InkColour[];
}

/** The stored entry for one tool, or null when the key does not hold one. */
function storedEntry(raw: unknown, id: ToolColourId): { colour?: unknown; quick?: unknown } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = (raw as Record<string, unknown>)[id];
  return entry && typeof entry === "object" ? entry : null;
}

/** A key is well formed when it holds an entry for every tool. */
function isWellFormed(raw: unknown): boolean {
  return TOOL_COLOUR_IDS.every((id) => storedEntry(raw, id) !== null);
}

/**
 * The tool colours in force: each tool from its stored entry, or, when the key
 * holds none for it, from the old keys. Pure: it reads nothing and writes nothing.
 */
export function resolveToolColours(stored: unknown, legacy: LegacyPen): ToolColours {
  const pen: ToolColour = {
    colour: legacy.colour ?? DEFAULT_TOOL_COLOURS.pen.colour,
    quick: quickFrom(legacy.quick, PEN_QUICK),
  };
  const fallback: ToolColours = { ...DEFAULT_TOOL_COLOURS, pen, text: { colour: pen.colour, quick: [...pen.quick] } };
  const resolved = {} as ToolColours;
  for (const id of TOOL_COLOUR_IDS) {
    const entry = storedEntry(stored, id);
    if (!entry) {
      resolved[id] = fallback[id];
      continue;
    }
    resolved[id] = {
      colour: isInkColour(entry.colour) ? entry.colour : DEFAULT_TOOL_COLOURS[id].colour,
      quick: quickFrom(entry.quick, DEFAULT_TOOL_COLOURS[id].quick),
    };
  }
  return resolved;
}

export function withToolColour(colours: ToolColours, id: ToolColourId, colour: InkColour): ToolColours {
  return { ...colours, [id]: { ...colours[id], colour } };
}

export function withQuickSlot(
  colours: ToolColours,
  id: ToolColourId,
  slot: number,
  colour: InkColour,
): ToolColours {
  const quick = colours[id].quick.map((entry, i) => (i === slot ? colour : entry));
  return { ...colours, [id]: { ...colours[id], quick } };
}

function readLegacy(): LegacyPen {
  let quickRaw: unknown = null;
  try {
    const saved = readStored(LEGACY_QUICK_COLOURS_KEY);
    quickRaw = saved ? JSON.parse(saved) : null;
  } catch {
    quickRaw = null;
  }
  return {
    colour: legacyPenColour(readStoredJson<unknown>(LEGACY_PEN_PREFS_KEY, null)),
    quick: quickFrom(quickRaw, PEN_QUICK),
  };
}

// One cache for the window, so every pane reads the same object.
let cache: ToolColours | null = null;
const listeners = new Set<() => void>();

function load(): ToolColours {
  if (cache) return cache;
  const stored = readStoredJson<unknown>(TOOL_COLOUR_KEY, null);
  cache = resolveToolColours(stored, readLegacy());
  // Migrate now (or fill in a missing tool). The pen preference is rewritten without its colour, so the old
  // key cannot be trusted to hold it on the next launch.
  if (!isWellFormed(stored)) writeStoredJson(TOOL_COLOUR_KEY, cache);
  return cache;
}

function commit(next: ToolColours) {
  cache = next;
  writeStoredJson(TOOL_COLOUR_KEY, next);
  notify();
}

export function setToolColour(id: ToolColourId, colour: InkColour) {
  commit(withToolColour(load(), id, colour));
}

export function setToolQuickSlot(id: ToolColourId, slot: number, colour: InkColour) {
  commit(withQuickSlot(load(), id, slot, colour));
}

function notify() {
  for (const listener of listeners) listener();
}

/** Another window wrote the key (or cleared storage): read it afresh. */
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== TOOL_COLOUR_KEY) return;
  cache = null;
  notify();
}

export function subscribeToolColours(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** All five tools' colours, read now. For code outside React. */
export function readToolColours(): ToolColours {
  return load();
}

/** All five tools' colours. Server render and first paint both get the defaults. */
export function useToolColours(): ToolColours {
  return useSyncExternalStore(subscribeToolColours, load, () => DEFAULT_TOOL_COLOURS);
}

/** Tests only: forget the cache so the next read starts from storage. */
export function resetToolColoursCacheForTests() {
  cache = null;
}
