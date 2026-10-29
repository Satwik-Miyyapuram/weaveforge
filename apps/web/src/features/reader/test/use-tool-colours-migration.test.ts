import assert from "node:assert/strict";
import test from "node:test";

import { INK_HIGHLIGHTER_WIDTH, INK_PEN_WIDTHS } from "@weaveforge/core";

import { READER_ANNOTATION_COLORS } from "../application/reader-annotation-helpers";
import { DEFAULT_PEN_PREFS, persistPenPrefs } from "../ui/pdf-reader/use-pen-prefs";

import {
  DEFAULT_TOOL_COLOURS,
  readToolColours,
  resetToolColoursCacheForTests,
  setToolQuickSlot,
  subscribeToolColours,
} from "@/features/ink";

const TOOL_COLOUR_KEY = "weaveforge.ink.tool-colours";
const LEGACY_PEN_KEY = "weaveforge.reader.pen";

/** An in-memory localStorage, so the store is read and written as the app does. */
function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
  return store;
}

/** What the reader's pen preference held before the tool colours existed: a hex. */
function legacyRedPen(store: Map<string, string>) {
  store.set(
    LEGACY_PEN_KEY,
    JSON.stringify({
      tool: "ink",
      width: INK_PEN_WIDTHS[2],
      highlighterWidth: INK_HIGHLIGHTER_WIDTH,
      color: READER_ANNOTATION_COLORS[1],
    }),
  );
}

test("a legacy red pen survives a width change made before any colour is read", () => {
  const store = installStorage();
  legacyRedPen(store);
  resetToolColoursCacheForTests();

  // The pen bar's width change writes the pen preference, which no longer holds a colour.
  persistPenPrefs({ ...DEFAULT_PEN_PREFS, width: INK_PEN_WIDTHS[0] });

  resetToolColoursCacheForTests();
  assert.equal(readToolColours().pen.colour, "red");
});

test("the first read writes the migrated pen colour to the new key", () => {
  const store = installStorage();
  legacyRedPen(store);
  resetToolColoursCacheForTests();

  assert.equal(readToolColours().pen.colour, "red");
  const written = JSON.parse(store.get(TOOL_COLOUR_KEY) ?? "null");
  assert.equal(written?.pen.colour, "red");

  // With the old key gone, the new one alone still holds the colour.
  store.delete(LEGACY_PEN_KEY);
  resetToolColoursCacheForTests();
  assert.equal(readToolColours().pen.colour, "red");
});

test("a well-formed new key is not overwritten by a stale legacy colour", () => {
  const store = installStorage();
  legacyRedPen(store);
  const stored = JSON.parse(JSON.stringify(DEFAULT_TOOL_COLOURS));
  stored.pen.colour = "purple";
  store.set(TOOL_COLOUR_KEY, JSON.stringify(stored));
  resetToolColoursCacheForTests();

  persistPenPrefs({ ...DEFAULT_PEN_PREFS, width: INK_PEN_WIDTHS[0] });
  resetToolColoursCacheForTests();
  assert.equal(readToolColours().pen.colour, "purple");
});

test("a change another window stores is picked up, so this window's next write keeps it", () => {
  const store = installStorage();
  resetToolColoursCacheForTests();
  const win = new EventTarget();
  (globalThis as { window?: unknown }).window = Object.assign(win, { localStorage: globalThis.localStorage });
  try {
    let heard = 0;
    const stop = subscribeToolColours(() => {
      heard += 1;
    });
    assert.equal(readToolColours().pen.colour, "text");

    // Window B picks a pen colour; only storage tells window A.
    const other = JSON.parse(JSON.stringify(DEFAULT_TOOL_COLOURS));
    other.pen.colour = "blue";
    store.set(TOOL_COLOUR_KEY, JSON.stringify(other));
    win.dispatchEvent(Object.assign(new Event("storage"), { key: TOOL_COLOUR_KEY }));
    assert.equal(heard, 1);
    assert.equal(readToolColours().pen.colour, "blue");

    // A's own write now builds on B's colour instead of overwriting it.
    setToolQuickSlot("underline", 0, "green");
    const written = JSON.parse(store.get(TOOL_COLOUR_KEY) ?? "null");
    assert.equal(written.pen.colour, "blue");
    assert.equal(written.underline.quick[0], "green");

    // Another key's change is not ours to react to.
    win.dispatchEvent(Object.assign(new Event("storage"), { key: "weaveforge.other" }));
    assert.equal(heard, 2, "only A's own write notified since");

    stop();
    win.dispatchEvent(Object.assign(new Event("storage"), { key: TOOL_COLOUR_KEY }));
    assert.equal(heard, 2, "no listener once unsubscribed");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
