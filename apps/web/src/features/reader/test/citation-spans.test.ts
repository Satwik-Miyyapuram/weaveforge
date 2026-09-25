import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageTextItem } from "@weaveforge/core";
import { mentionItemRanges, planCitationSegments, type CiteSpan } from "../application/citation-spans";

/**
 * The segmentation behind the citation underline.
 *
 * The point of these is that decorating a span must never change the text it
 * holds: the underline is the text's own decoration, so if a split loses or
 * duplicates a character the page shows something the document does not say.
 */

/** Page text is `"see [12]and\n[13]"` — item 0 is 0-7, item 1 is 8-10, newline 11, item 2 is 12-15. */
const items: PageTextItem[] = [
  { str: "see [12]", transform: [10, 0, 0, 10, 72, 700], width: 40, height: 10 },
  { str: "and", transform: [10, 0, 0, 10, 72, 680], width: 18, height: 10, hasEOL: true },
  { str: "[13]", transform: [10, 0, 0, 10, 90, 680], width: 20, height: 10 },
];

const pageText = (runs: readonly PageTextItem[]) =>
  runs.map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");

const mention = (key: string, start: number, end: number): CiteSpan => ({ key, start, end });

test("a mention maps onto the runs it covers", () => {
  // `[12]` is at 4-8, a slice of item 0.
  assert.deepEqual(mentionItemRanges(items, 4, 8), [{ itemIndex: 0, from: 4, to: 8 }]);
  // Across the line break: the tail of item 0 (`[1`) and the head of item 1 (`2`).
  assert.deepEqual(mentionItemRanges(items, 6, 10), [
    { itemIndex: 0, from: 6, to: 8 },
    { itemIndex: 1, from: 0, to: 2 },
  ]);
});

test("an empty or inverted range maps to nothing", () => {
  assert.deepEqual(mentionItemRanges(items, 5, 5), []);
  assert.deepEqual(mentionItemRanges(items, 8, 4), []);
  assert.deepEqual(mentionItemRanges(items, Number.NaN, 4), []);
});

test("splitting one run at a mention leaves the other pieces as plain text", () => {
  const plan = planCitationSegments(items, [mention("c1", 4, 8)]);
  assert.deepEqual(
    plan[0]!.map((segment) => [segment.text, segment.mention?.key ?? null]),
    [
      ["see ", null],
      ["[12]", "c1"],
    ],
  );
});

test("a mention crossing a line break marks both runs", () => {
  // Item 0 is `"see [12]"` (0-7) and item 1 is `"and"` (8-10), so 6-10 covers
  // `[1` at the end of item 0 and `an` at the head of item 1.
  const plan = planCitationSegments(items, [mention("c1", 6, 10)]);
  assert.deepEqual(plan[0]!.map((segment) => [segment.text, segment.mention?.key ?? null]), [
    ["see [1", null],
    ["2]", "c1"],
  ]);
  assert.deepEqual(plan[1]!.map((segment) => [segment.text, segment.mention?.key ?? null]), [
    ["an", "c1"],
    ["d", null],
  ]);
  assert.equal(plan[2]!.map((segment) => segment.text).join(""), "[13]");
});

test("decorating never loses or invents a character", () => {
  // The invariant the DOM rewrite depends on: the concatenated segments of an
  // item are the item. `decorateCitationSpans` throws on a violation, but this
  // catches it without a DOM.
  const mentions = [mention("a", 4, 8), mention("b", 0, 3), mention("c", 6, 10)];
  const plan = planCitationSegments(items, mentions);
  plan.forEach((segments, index) => {
    assert.equal(
      segments.map((segment) => segment.text).join(""),
      items[index]!.str,
      `item ${index}`,
    );
  });
  // The newline an `hasEOL` item contributes is not part of any item's text, so
  // the plan holds the items exactly and the page text is the items plus those.
  assert.equal(plan.flat().map((segment) => segment.text).join(""), items.map((i) => i.str).join(""));
});

test("overlapping mentions do not both claim a character", () => {
  // Two mentions over the same stretch: the boundary set is shared, so the
  // pieces still partition the runs rather than duplicating the overlap.
  const plan = planCitationSegments(items, [mention("a", 4, 8), mention("b", 5, 12)]);
  plan.forEach((segments, index) => {
    assert.equal(segments.map((segment) => segment.text).join(""), items[index]!.str, `item ${index}`);
  });
});

test("a mention reaching past the page text is ignored", () => {
  const plan = planCitationSegments(items, [mention("bogus", 0, 9_999)]);
  assert.deepEqual(plan[0]!.map((segment) => segment.text), ["see [12]"]);
  assert.equal(plan[0]![0]!.mention, undefined);
});
