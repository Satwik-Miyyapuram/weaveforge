/**
 * Each drawing tool's own colour and its own five quick colours.
 *
 * The colours are kept in the workspace's `.weaveforge/settings.json` under
 * `ink.toolColours`, so they travel with the workspace and survive restarts.
 * localStorage keeps a copy for a window with no folder and for the migration
 * from old keys; the file's value wins when it has one.
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
 * Each quick slot also keeps its own nib width (`widths`, parallel to `quick`),
 * so picking a slot gives back the width it was last drawn with. A slot with no
 * width (`null`) leaves the surface's own width in force. The reader's old
 * global pen and highlighter widths move into every slot once, when a tool's
 * entry has no `widths` yet, and are saved then, so a later change to that old
 * preference does not move them.
 *
 * Another window's change arrives as a `storage` event, which drops the cache,
 * so this window's next write builds on it instead of overwriting it.
 */

import { useSyncExternalStore } from "react";
import {
  INK_COLOURS,
  INK_HIGHLIGHTER_WIDTH,
  INK_HIGHLIGHTER_WIDTHS,
  INK_PEN_WIDTHS,
  type InkColour,
} from "@weaveforge/core";

import { READER_ANNOTATION_COLORS } from "@/features/reader/application/parts";
import { workspaceSettings } from "@/features/settings/application/workspace-settings";
import { readStored, readStoredJson, writeStoredJson } from "@/lib/safe-storage";

/** Where the colours live in the workspace settings file. */
export const TOOL_COLOURS_SETTINGS_KEY = ["ink", "toolColours"] as const;

const TOOL_COLOUR_KEY = "weaveforge.ink.tool-colours";
const LEGACY_PEN_PREFS_KEY = "weaveforge.reader.pen";
const LEGACY_QUICK_COLOURS_KEY = "weaveforge.ink.quick-colours";

export const TOOL_COLOUR_IDS = ["pen", "highlighter", "highlight", "underline", "text"] as const;
export type ToolColourId = (typeof TOOL_COLOUR_IDS)[number];

export interface ToolColour {
  colour: InkColour;
  /** Always five slots. */
  quick: InkColour[];
  /** Each quick slot's nib width, or null for the surface's own. Always five. */
  widths: (number | null)[];
}

export type ToolColours = Record<ToolColourId, ToolColour>;

const PEN_QUICK: readonly InkColour[] = ["text", "accent", "red", "blue", "green"];
const HIGHLIGHTER_QUICK: readonly InkColour[] = ["yellow", "green", "pink", "blue", "orange"];
const UNDERLINE_QUICK: readonly InkColour[] = ["red", "blue", "green", "purple", "text"];
const NO_WIDTHS: readonly (number | null)[] = [null, null, null, null, null];

export const DEFAULT_TOOL_COLOURS: ToolColours = {
  pen: { colour: "text", quick: [...PEN_QUICK], widths: [...NO_WIDTHS] },
  highlighter: { colour: "yellow", quick: [...HIGHLIGHTER_QUICK], widths: [...NO_WIDTHS] },
  highlight: { colour: "yellow", quick: [...HIGHLIGHTER_QUICK], widths: [...NO_WIDTHS] },
  underline: { colour: "red", quick: [...UNDERLINE_QUICK], widths: [...NO_WIDTHS] },
  text: { colour: "text", quick: [...PEN_QUICK], widths: [...NO_WIDTHS] },
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

/**
 * The reader's own default pen width (`DEFAULT_PEN_PREFS`). The reader saved its widths with every
 * preference write, so a stored default says nothing about the user's choice and is not migrated:
 * it would otherwise replace the notes' thinner default in every slot.
 */
const READER_DEFAULT_PEN_WIDTH = INK_PEN_WIDTHS[2];

/** An old reader width worth migrating: a real nib the user changed away from the reader default. */
function changedWidth(id: ToolColourId, value: unknown, readerDefault: number | undefined): number | null {
  return isNibWidth(id, value) && value !== readerDefault ? value : null;
}

/** The nib widths a tool can draw with. */
function nibWidths(id: ToolColourId): readonly number[] {
  return id === "highlighter" ? INK_HIGHLIGHTER_WIDTHS : INK_PEN_WIDTHS;
}

function isNibWidth(id: ToolColourId, value: unknown): value is number {
  return nibWidths(id).includes(value as number);
}

/** A saved five-slot width list, slot by slot, with null for any bad or missing slot. */
function widthsFrom(raw: unknown, id: ToolColourId): (number | null)[] {
  const list = Array.isArray(raw) ? raw : [];
  return NO_WIDTHS.map((_, i) => (isNibWidth(id, list[i]) ? list[i] : null));
}

/** The width saved with `colour`'s quick slot, or null when it has none or is not a quick colour. */
export function slotWidth(tool: ToolColour, colour: InkColour): number | null {
  const i = tool.quick.indexOf(colour);
  return i >= 0 ? (tool.widths[i] ?? null) : null;
}

/** The width to draw with: the current colour's slot width, else `fallback` (the surface's own). */
export function widthInForce(tool: ToolColour, fallback: number): number {
  return slotWidth(tool, tool.colour) ?? fallback;
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
  /** The reader's old global widths, when it saved them. */
  width?: number | null;
  highlighterWidth?: number | null;
}

/** The stored entry for one tool, or null when the key does not hold one. */
function storedEntry(
  raw: unknown,
  id: ToolColourId,
): { colour?: unknown; quick?: unknown; widths?: unknown } | null {
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
    widths: [...NO_WIDTHS],
  };
  const fallback: ToolColours = {
    ...DEFAULT_TOOL_COLOURS,
    pen,
    text: { colour: pen.colour, quick: [...pen.quick], widths: [...NO_WIDTHS] },
  };
  const legacyWidth: Partial<Record<ToolColourId, number | null | undefined>> = {
    pen: legacy.width,
    highlighter: legacy.highlighterWidth,
  };
  const resolved = {} as ToolColours;
  for (const id of TOOL_COLOUR_IDS) {
    const entry = storedEntry(stored, id);
    const base: ToolColour = entry
      ? {
          colour: isInkColour(entry.colour) ? entry.colour : DEFAULT_TOOL_COLOURS[id].colour,
          quick: quickFrom(entry.quick, DEFAULT_TOOL_COLOURS[id].quick),
          widths: widthsFrom(entry.widths, id),
        }
      : fallback[id];
    // The old global width moves into every slot once: only while the entry has no widths of its own.
    const old = legacyWidth[id];
    resolved[id] =
      entry?.widths === undefined && isNibWidth(id, old) ? { ...base, widths: NO_WIDTHS.map(() => old) } : base;
  }
  return resolved;
}

/** True when resolving moved an old global width into a tool that had no widths saved. */
function migratedWidths(stored: unknown, resolved: ToolColours): boolean {
  return TOOL_COLOUR_IDS.some(
    (id) => storedEntry(stored, id)?.widths === undefined && resolved[id].widths.some((w) => w !== null),
  );
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

export function withQuickWidth(colours: ToolColours, id: ToolColourId, slot: number, width: number): ToolColours {
  const widths = colours[id].widths.map((entry, i) => (i === slot ? width : entry));
  return { ...colours, [id]: { ...colours[id], widths } };
}

function readLegacy(): LegacyPen {
  let quickRaw: unknown = null;
  try {
    const saved = readStored(LEGACY_QUICK_COLOURS_KEY);
    quickRaw = saved ? JSON.parse(saved) : null;
  } catch {
    quickRaw = null;
  }
  const prefs = readStoredJson<unknown>(LEGACY_PEN_PREFS_KEY, null);
  const widths = prefs && typeof prefs === "object" ? (prefs as { width?: unknown; highlighterWidth?: unknown }) : {};
  return {
    colour: legacyPenColour(prefs),
    quick: quickFrom(quickRaw, PEN_QUICK),
    width: changedWidth("pen", widths.width, READER_DEFAULT_PEN_WIDTH),
    highlighterWidth: changedWidth("highlighter", widths.highlighterWidth, INK_HIGHLIGHTER_WIDTH),
  };
}

// One cache for the window, so every pane reads the same object.
let cache: ToolColours | null = null;
const listeners = new Set<() => void>();
// The settings value the cache was built from, so our own write does not drop the cache.
let seen: unknown = undefined;

function load(): ToolColours {
  if (cache) return cache;
  const fromFile = workspaceSettings.get(TOOL_COLOURS_SETTINGS_KEY);
  seen = fromFile;
  const stored = fromFile ?? readStoredJson<unknown>(TOOL_COLOUR_KEY, null);
  const resolved = resolveToolColours(stored, readLegacy());
  cache = resolved;
  // Migrate now (or fill in a missing tool). The pen preference is rewritten without its colour, so the old
  // key cannot be trusted to hold it on the next launch. Migrated widths go to the file too, so they move once.
  if (migratedWidths(stored, resolved)) persist(resolved);
  else if (fromFile === undefined && !isWellFormed(stored)) writeStoredJson(TOOL_COLOUR_KEY, resolved);
  return resolved;
}

/** Save `next` everywhere it is kept, without telling listeners (a read that migrates calls this). */
function persist(next: ToolColours) {
  cache = next;
  writeStoredJson(TOOL_COLOUR_KEY, next);
  seen = next;
  workspaceSettings.set(TOOL_COLOURS_SETTINGS_KEY, next);
}

function commit(next: ToolColours) {
  persist(next);
  notify();
}

export function setToolColour(id: ToolColourId, colour: InkColour) {
  commit(withToolColour(load(), id, colour));
}

export function setToolQuickSlot(id: ToolColourId, slot: number, colour: InkColour) {
  commit(withQuickSlot(load(), id, slot, colour));
}

/** Save `width` as slot `slot`'s nib. A width the tool has no nib for is ignored. */
export function setToolQuickWidth(id: ToolColourId, slot: number, width: number) {
  if (!isNibWidth(id, width) || slot < 0 || slot >= NO_WIDTHS.length) return;
  commit(withQuickWidth(load(), id, slot, width));
}

/** Save `width` on the slot of the tool's current colour; a colour outside the quick slots keeps none. */
export function setWidthForColour(id: ToolColourId, width: number) {
  const tool = load()[id];
  const slot = tool.quick.indexOf(tool.colour);
  if (slot >= 0) setToolQuickWidth(id, slot, width);
}

function notify() {
  for (const listener of listeners) listener();
}

/** The settings file changed (loaded, edited by hand, pulled): read it afresh. */
workspaceSettings.subscribe(() => {
  if (workspaceSettings.get(TOOL_COLOURS_SETTINGS_KEY) === seen) return;
  cache = null;
  notify();
});

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
  seen = undefined;
}
