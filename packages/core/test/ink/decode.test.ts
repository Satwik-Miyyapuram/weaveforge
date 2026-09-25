/**
 * Choosing among an engine's readings of each word (decode.ts).
 *
 * The readings are written the way the desktop helper returns them: the
 * engine's pick first, the OS dictionary's verdict beside each, two-word splits
 * after the engine's own readings, and `join` on a word when it and the next
 * read as one dictionary word.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INK_ENGINE_MAX_CONFIDENCE,
  decodeInkWords,
  inkVocabularyWords,
  type InkWordReadings,
} from "../../src/ink/decode.js";
import { INK_UNSURE_CONFIDENCE, isUnsureLine } from "../../src/ink/recognise.js";

const w = (candidates: string[], known?: boolean[] | null, join?: string): InkWordReadings => ({
  candidates,
  ...(known !== undefined ? { known } : {}),
  ...(join ? { join } : {}),
});

test("a clean line keeps the engine's words and scores under 1", () => {
  const line = decodeInkWords(
    [w(["the", "he"], [true, true]), w(["fox", "(ox"], [true, true])],
    [],
    "the fox",
  );
  assert.equal(line.text, "the fox");
  assert.equal(line.conf, INK_ENGINE_MAX_CONFIDENCE);
  assert.ok(line.conf < 1, "1 is reserved for a person's correction");
});

test("a dictionary word among the readings beats a non-word pick", () => {
  const line = decodeInkWords([w(["lorown", "brown"], [false, true])], [], "lorown");
  assert.equal(line.text, "brown");
  assert.equal(line.alternatives?.[0], "lorown", "the engine's text is one click away");
});

test("a workspace term beats a non-word, but not an ordinary word", () => {
  assert.equal(decodeInkWords([w(["softmox", "softmax"], [false, false])], ["softmax"]).text, "softmax");
  // "is" comes in with a title; it must not override the dictionary word "in".
  const title = ["Attention Is All You Need"];
  assert.equal(decodeInkWords([w(["in", "is"], [true, true])], title).text, "in");
});

test("a word no reading of which is a word makes the line unsure", () => {
  const line = decodeInkWords(
    [w(["decoder"], [true]), w(["output"], [true]), w(["is"], [true]), w(["garlded", "garlled"], [false, false])],
    [],
  );
  assert.equal(line.text, "decoder output is garlded");
  assert.ok(line.conf < INK_UNSURE_CONFIDENCE);
  assert.ok(isUnsureLine(line));
});

test("a merged word takes the helper's split", () => {
  const line = decodeInkWords(
    [w(["variance"], [true]), w(["seedsmatters", "seedsmatter", "seeds matters"], [false, false, true])],
    [],
  );
  assert.equal(line.text, "variance seeds matters");
  assert.equal(line.conf, INK_ENGINE_MAX_CONFIDENCE);
});

test("a hyphenated reading of a merged word becomes two words", () => {
  const line = decodeInkWords([w(["noisehurts", "noise-hurts"], [false, true]), w(["the"], [true])], []);
  assert.equal(line.text, "noise hurts the");
});

test("a split is held back when the non-word is close to a workspace term", () => {
  const line = decodeInkWords([w(["alolation", "al olation"], [false, true])], ["ablation"]);
  assert.equal(line.text, "alolation", "left for the title post-match to mend");
});

test("two words join when either is in doubt, and are only offered otherwise", () => {
  // "dr" is no word; its case variant "Dr" is, but the doubt stands.
  const draft = decodeInkWords([w(["dr", "Dr"], [false, true], "draft"), w(["aft"], [true])], []);
  assert.equal(draft.text, "draft");
  const forgets = decodeInkWords(
    [w(["the"], [true]), w(["for"], [true], "forgets"), w(["gets"], [true])],
    [],
  );
  assert.equal(forgets.text, "the for gets");
  assert.ok(forgets.alternatives?.includes("the forgets"));
});

test("with no dictionary, the engine's words stand", () => {
  const line = decodeInkWords([w(["lorown", "brown"], null)], []);
  assert.equal(line.text, "lorown");
  assert.equal(line.conf, INK_ENGINE_MAX_CONFIDENCE);
});

test("alternatives are whole lines with one doubtful word swapped", () => {
  const line = decodeInkWords(
    [w(["the"], [true]), w(["garlded", "garlled", "garbled"], [false, false, false])],
    [],
  );
  assert.deepEqual(line.alternatives, ["the garlled", "the garbled"]);
});

test("vocabulary words include the parts of hyphenated terms", () => {
  const words = inkVocabularyWords(["Graph-prior module", "smith2021"]);
  for (const word of ["graphprior", "graph", "prior", "module", "smith2021"]) assert.ok(words.has(word), word);
});
