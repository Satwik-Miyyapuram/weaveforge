import assert from "node:assert/strict";
import test from "node:test";

import { READER_ANNOTATION_COLORS } from "@/features/reader/application/reader-annotation-helpers";

import {
  DEFAULT_TOOL_COLOURS,
  TOOL_COLOUR_IDS,
  legacyPenColour,
  resolveToolColours,
  withQuickSlot,
  withToolColour,
} from "../ui/use-tool-colours";

const NO_LEGACY = { colour: null, quick: [...DEFAULT_TOOL_COLOURS.pen.quick] };

test("every tool has a default colour and five quick colours", () => {
  assert.deepEqual([...TOOL_COLOUR_IDS], ["pen", "highlighter", "highlight", "underline", "text"]);
  for (const id of TOOL_COLOUR_IDS) {
    assert.equal(DEFAULT_TOOL_COLOURS[id].quick.length, 5, id);
  }
  assert.deepEqual(DEFAULT_TOOL_COLOURS.pen, { colour: "text", quick: ["text", "accent", "red", "blue", "green"] });
  assert.deepEqual(DEFAULT_TOOL_COLOURS.highlighter, {
    colour: "yellow",
    quick: ["yellow", "green", "pink", "blue", "orange"],
  });
  assert.deepEqual(DEFAULT_TOOL_COLOURS.highlight, DEFAULT_TOOL_COLOURS.highlighter);
  assert.deepEqual(DEFAULT_TOOL_COLOURS.underline, {
    colour: "red",
    quick: ["red", "blue", "green", "purple", "text"],
  });
  assert.deepEqual(DEFAULT_TOOL_COLOURS.text, DEFAULT_TOOL_COLOURS.pen);
});

test("nothing stored and nothing legacy gives the defaults", () => {
  assert.deepEqual(resolveToolColours(null, NO_LEGACY), DEFAULT_TOOL_COLOURS);
});

test("with no new key, the pen's colour and quick list migrate from the old keys", () => {
  const migrated = resolveToolColours(null, {
    colour: "blue",
    quick: ["pink", "yellow", "text", "danger", "purple"],
  });
  assert.deepEqual(migrated.pen, { colour: "blue", quick: ["pink", "yellow", "text", "danger", "purple"] });
  // Only the pen migrates; the other tools keep their defaults.
  assert.deepEqual(migrated.highlighter, DEFAULT_TOOL_COLOURS.highlighter);
  assert.deepEqual(migrated.underline, DEFAULT_TOOL_COLOURS.underline);
});

test("a legacy hex pen colour maps to its colour name", () => {
  // Index 1 of the reader palette is red; the migration reads the hex and names it.
  assert.equal(legacyPenColour({ color: READER_ANNOTATION_COLORS[1] }), "red");
  assert.equal(legacyPenColour({ colour: "green" }), "green");
  assert.equal(legacyPenColour({ color: "#000001" }), null);
  assert.equal(legacyPenColour(null), null);
});

test("a malformed new key counts as absent and migrates", () => {
  const legacy = { colour: "blue" as const, quick: [...DEFAULT_TOOL_COLOURS.pen.quick] };
  assert.deepEqual(resolveToolColours("junk", legacy).pen.colour, "blue");
  assert.deepEqual(resolveToolColours([], legacy).pen.colour, "blue");
  assert.deepEqual(resolveToolColours({}, legacy).pen.colour, "blue");
});

test("a key missing one tool keeps every other tool's saved colours", () => {
  const legacy = { colour: "blue" as const, quick: [...DEFAULT_TOOL_COLOURS.pen.quick] };
  const stored = JSON.parse(JSON.stringify(DEFAULT_TOOL_COLOURS));
  stored.highlighter.colour = "pink";
  stored.underline.quick = ["green", "green", "green", "green", "green"];
  delete stored.pen;
  const resolved = resolveToolColours(stored, legacy);
  assert.equal(resolved.highlighter.colour, "pink");
  assert.deepEqual(resolved.underline.quick, ["green", "green", "green", "green", "green"]);
  // The missing pen falls back to what it would have migrated from.
  assert.equal(resolved.pen.colour, "blue");
  // A present tool is never replaced by the legacy pen.
  const onlyPen = resolveToolColours({ pen: { colour: "text", quick: [] } }, legacy);
  assert.equal(onlyPen.pen.colour, "text");
  assert.deepEqual(onlyPen.pen.quick, DEFAULT_TOOL_COLOURS.pen.quick);
  assert.deepEqual(onlyPen.highlighter, DEFAULT_TOOL_COLOURS.highlighter);
});

test("the unified defaults: the pen draws in text colour, the highlighter in yellow", () => {
  // Deliberate change: the reader's old pen default was red, and the ink
  // note's highlighter default was "warn". Both now share one default per tool.
  const fresh = resolveToolColours(null, NO_LEGACY);
  assert.equal(fresh.pen.colour, "text");
  assert.equal(fresh.highlighter.colour, "yellow");
});

test("a well-formed new key wins over the legacy keys", () => {
  const stored = JSON.parse(JSON.stringify(DEFAULT_TOOL_COLOURS));
  stored.pen.colour = "purple";
  const resolved = resolveToolColours(stored, { colour: "blue", quick: [...DEFAULT_TOOL_COLOURS.pen.quick] });
  assert.equal(resolved.pen.colour, "purple");
});

test("a bad field inside a well-formed key falls back alone", () => {
  const stored = JSON.parse(JSON.stringify(DEFAULT_TOOL_COLOURS));
  stored.highlighter.colour = "chartreuse";
  stored.highlighter.quick = ["pink", "chartreuse", 7, "blue", "orange"];
  const resolved = resolveToolColours(stored, NO_LEGACY);
  assert.equal(resolved.highlighter.colour, "yellow");
  assert.deepEqual(resolved.highlighter.quick, ["pink", "green", "pink", "blue", "orange"]);
  assert.deepEqual(resolved.pen, DEFAULT_TOOL_COLOURS.pen);
});

test("setting one tool's colour leaves every other tool alone", () => {
  const next = withToolColour(DEFAULT_TOOL_COLOURS, "highlighter", "pink");
  assert.equal(next.highlighter.colour, "pink");
  assert.deepEqual(next.pen, DEFAULT_TOOL_COLOURS.pen);
  assert.deepEqual(next.highlight, DEFAULT_TOOL_COLOURS.highlight);
  assert.equal(DEFAULT_TOOL_COLOURS.highlighter.colour, "yellow", "the input is not mutated");
});

test("setting one quick slot changes only that slot of only that tool", () => {
  const next = withQuickSlot(DEFAULT_TOOL_COLOURS, "underline", 2, "orange");
  assert.deepEqual(next.underline.quick, ["red", "blue", "orange", "purple", "text"]);
  assert.deepEqual(next.pen, DEFAULT_TOOL_COLOURS.pen);
  assert.deepEqual(next.highlight, DEFAULT_TOOL_COLOURS.highlight);
});
