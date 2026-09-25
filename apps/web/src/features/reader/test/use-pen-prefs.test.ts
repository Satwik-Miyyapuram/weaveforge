/**
 * The pen's preferences, and the bridge between the two tool vocabularies.
 *
 * The reader's tools and the shared bar's are the same four things under
 * different names, so what is pinned here is that the mapping is a bijection
 * (a tool picked on the bar comes back as the same tool), that a stored
 * preference from before the bar was shared still resolves — those users have a
 * colour and a nib in `localStorage` already — and that nothing a newer build
 * cannot mean is allowed through.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { INK_PEN_WIDTHS } from "@weaveforge/core";

import {
  DEFAULT_PEN_PREFS,
  PEN_TOOLS,
  barToolFor,
  parsePenPrefs,
  readerToolFor,
} from "../ui/pdf-reader/use-pen-prefs";

test("the bar's tools and the reader's are the same four, in both directions", () => {
  for (const tool of PEN_TOOLS) {
    assert.equal(readerToolFor(barToolFor(tool)), tool, `${tool} survives the round trip`);
  }
  // The names differ for the pen alone — the reader calls it ink, because that
  // is the annotation it writes — and the lasso is the lasso on both.
  assert.equal(barToolFor("ink"), "pen");
  assert.equal(readerToolFor("lasso"), "lasso");
  assert.equal(barToolFor("lasso"), "lasso");
  // `shape` is reachable by chord on a note, never by a bar button, so a paper
  // reading one falls back to the pen rather than to nothing.
  assert.equal(readerToolFor("shape"), "ink");
  // And the paper's own pointer is not a pen tool at all.
  assert.equal(PEN_TOOLS.includes("select" as never), false);
});

test("nothing stored, or something meaningless, is the default pen", () => {
  assert.deepEqual(parsePenPrefs(null), DEFAULT_PEN_PREFS);
  assert.deepEqual(parsePenPrefs("nonsense"), DEFAULT_PEN_PREFS);
  assert.deepEqual(
    parsePenPrefs({ tool: "crayon", colour: "chartreuse", width: 99 }),
    DEFAULT_PEN_PREFS,
  );
});

test("the tool that used to be the lasso comes back as the lasso", () => {
  // `select` was the lasso before the pointer and the lasso became two tools,
  // and a hand that had chosen it meant "pick marks up" — not "highlight text".
  assert.equal(parsePenPrefs({ tool: "select" }).tool, "lasso");
});

test("a current preference is kept as it was written", () => {
  const stored = { tool: "highlighter", colour: "yellow", width: INK_PEN_WIDTHS[0] };
  assert.deepEqual(parsePenPrefs(stored), stored);
});

test("a preference written before the shared bar migrates instead of resetting", () => {
  // The old shape was the reader's own: a literal hex and a nib in PDF points.
  const old = { tool: "erase", color: "#2ea8e5", nib: 1.42, recent: ["#ffd400"] };
  const parsed = parsePenPrefs(old);
  assert.equal(parsed.tool, "erase", "the tool still means the same thing");
  assert.equal(parsed.colour, "blue", "the stored hex comes back as its ink colour name");
  // The old nib was in points and has no name in the note's set, so the default
  // stands rather than a width that would be read as 1.42 tenths of a millimetre.
  assert.equal(parsed.width, DEFAULT_PEN_PREFS.width);
});
