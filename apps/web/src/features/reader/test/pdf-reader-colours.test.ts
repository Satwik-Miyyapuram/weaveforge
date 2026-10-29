import assert from "node:assert/strict";
import test from "node:test";

import { INK_RENDER_COLOURS, paletteHex } from "@/features/ink/render/ink-palette";
import { readToolColours, resetToolColoursCacheForTests } from "@/features/ink";

import { colourToolFor, markColourTool, rememberRecolour, rememberToolColour } from "../ui/pdf-reader/colour-tools";

/** An in-memory localStorage, so a remembered colour is read back the way the app reads it. */
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

function remembered() {
  resetToolColoursCacheForTests();
  return readToolColours();
}

test("a recolour of a highlight is remembered as the highlight's colour, not the highlighter's", () => {
  installStorage();
  resetToolColoursCacheForTests();
  rememberToolColour(markColourTool("highlight"), paletteHex(INK_RENDER_COLOURS, "pink"), INK_RENDER_COLOURS);
  const colours = remembered();
  assert.equal(colours.highlight.colour, "pink");
  assert.equal(colours.highlighter.colour, "yellow");
});

test("a recolour of an underline is remembered as the underline's colour", () => {
  installStorage();
  resetToolColoursCacheForTests();
  rememberToolColour(markColourTool("underline"), paletteHex(INK_RENDER_COLOURS, "blue"), INK_RENDER_COLOURS);
  assert.equal(remembered().underline.colour, "blue");
});

test("a create on the highlight or underline writes its colour back to the store", () => {
  installStorage();
  resetToolColoursCacheForTests();
  rememberToolColour("underline", paletteHex(INK_RENDER_COLOURS, "green"), INK_RENDER_COLOURS);
  rememberToolColour("highlight", paletteHex(INK_RENDER_COLOURS, "orange"), INK_RENDER_COLOURS);
  const colours = remembered();
  assert.equal(colours.underline.colour, "green");
  assert.equal(colours.highlight.colour, "orange");
});

test("a colour off the palette is not remembered, so the stored colour stays", () => {
  installStorage();
  resetToolColoursCacheForTests();
  rememberToolColour("pen", "#123456", INK_RENDER_COLOURS);
  assert.equal(remembered().pen.colour, "text");
});

test("the pen's colour is the one drawn with while the pen bar is up", () => {
  assert.equal(colourToolFor({ penOpen: true, penTool: "ink", pickedTool: "select" }), "pen");
  assert.equal(colourToolFor({ penOpen: true, penTool: "lasso", pickedTool: "select" }), "pen");
  assert.equal(colourToolFor({ penOpen: true, penTool: "highlighter", pickedTool: "select" }), "highlighter");
});

test("without the pen bar, the picked tool chooses its colour", () => {
  assert.equal(colourToolFor({ penOpen: false, penTool: "ink", pickedTool: "text" }), "text");
  assert.equal(colourToolFor({ penOpen: false, penTool: "ink", pickedTool: "select" }), "highlight");
  assert.equal(colourToolFor({ penOpen: false, penTool: "ink", pickedTool: "highlighter" }), "highlighter");
  assert.equal(colourToolFor({ penOpen: false, penTool: "ink", pickedTool: "lasso" }), "pen");
});

test("each mark is recoloured from its own tool's quick colours", () => {
  assert.equal(markColourTool("highlight"), "highlight");
  assert.equal(markColourTool("underline"), "underline");
  assert.equal(markColourTool("ink"), "pen");
  assert.equal(markColourTool("text"), "text");
  assert.equal(markColourTool("note"), "pen");
});

test("recolouring a stroke or a note leaves the pen's colour alone", () => {
  installStorage();
  resetToolColoursCacheForTests();
  rememberRecolour("ink", paletteHex(INK_RENDER_COLOURS, "blue"), INK_RENDER_COLOURS);
  rememberRecolour("note", paletteHex(INK_RENDER_COLOURS, "green"), INK_RENDER_COLOURS);
  assert.equal(remembered().pen.colour, "text");
});

test("recolouring a highlight, an underline or a text box is remembered for that tool", () => {
  installStorage();
  resetToolColoursCacheForTests();
  rememberRecolour("highlight", paletteHex(INK_RENDER_COLOURS, "pink"), INK_RENDER_COLOURS);
  rememberRecolour("underline", paletteHex(INK_RENDER_COLOURS, "blue"), INK_RENDER_COLOURS);
  rememberRecolour("text", paletteHex(INK_RENDER_COLOURS, "red"), INK_RENDER_COLOURS);
  const colours = remembered();
  assert.equal(colours.highlight.colour, "pink");
  assert.equal(colours.underline.colour, "blue");
  assert.equal(colours.text.colour, "red");
  assert.equal(colours.pen.colour, "text");
});
