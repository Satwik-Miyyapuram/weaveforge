/**
 * One hashtag reader (03-15): `extractHashtags` is the tags of
 * `extractHashtagRefs`, so the two cannot drift. These fixtures pin what both
 * return before and after.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHashtagRefs, extractHashtags } from "../../../src/features/papers/domain/paper.js";

const FIXTURES: Array<[string, string[]]> = [
  ["Key #Disentanglement idea, see #beta-VAE and #beta-VAE again.", ["disentanglement", "beta-vae"]],
  ["#Ünïcode and #日本語 and #a_b-c", ["ünïcode", "日本語", "a_b-c"]],
  ["case #Tag then #TAG then #tag", ["tag"]],
  ["##double hash", ["double"]],
  ["a lone # and word#inside", ["inside"]],
  ["#2024 #x1", ["2024", "x1"]],
  ["trailing punctuation #end. #comma,", ["end", "comma"]],
  ["", []],
  ["no tags here", []],
];

test("extractHashtags fixtures", () => {
  for (const [text, tags] of FIXTURES) assert.deepEqual(extractHashtags(text), tags, text);
  assert.deepEqual(extractHashtags(undefined), []);
});

test("extractHashtags is the tags of extractHashtagRefs, in the same order", () => {
  for (const [text] of FIXTURES) {
    assert.deepEqual(extractHashtags(text), extractHashtagRefs(text).map((r) => r.tag), text);
  }
});

test("each ref's offset points at its own first occurrence", () => {
  const text = "#ab then #a then #ab";
  assert.deepEqual(extractHashtagRefs(text), [
    { tag: "ab", index: 0, length: 3 },
    { tag: "a", index: 9, length: 2 },
  ]);
});
