/**
 * Excerpt segmentation for the search UI.
 *
 * - Segments alternate plain and highlighted text and cover the whole snippet.
 * - Highlights at either edge do not leave empty segments.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { SearchExcerpt } from "@weaveforge/core";

import { excerptSegments } from "../excerpt-segments";

test("segments alternate plain and highlighted, covering the whole snippet", () => {
  const excerpt: SearchExcerpt = {
    text: "The latent model",
    highlights: [{ start: 4, end: 10 }],
  };
  const segments = excerptSegments(excerpt);
  assert.equal(segments.map((s) => s.text).join(""), excerpt.text);
  assert.deepEqual(
    segments.filter((s) => s.highlighted).map((s) => s.text),
    ["latent"],
  );
  assert.deepEqual(segments, [
    { text: "The ", highlighted: false },
    { text: "latent", highlighted: true },
    { text: " model", highlighted: false },
  ]);
});

test("a highlight at either edge leaves no empty segment", () => {
  const excerpt: SearchExcerpt = {
    text: "ab cd",
    highlights: [
      { start: 0, end: 2 },
      { start: 3, end: 5 },
    ],
  };
  assert.deepEqual(excerptSegments(excerpt), [
    { text: "ab", highlighted: true },
    { text: " ", highlighted: false },
    { text: "cd", highlighted: true },
  ]);
});

test("no highlights is one plain segment", () => {
  const excerpt: SearchExcerpt = { text: "x y", highlights: [] };
  assert.deepEqual(excerptSegments(excerpt), [{ text: "x y", highlighted: false }]);
});

test("an empty excerpt has no segments", () => {
  const excerpt: SearchExcerpt = { text: "", highlights: [] };
  assert.deepEqual(excerptSegments(excerpt), []);
});
