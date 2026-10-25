/**
 * One page's text candidates are found once and shared by the pattern finder
 * and the assembly (04-12); passing them in must give what each finds alone.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assemblePageCitations,
  findCitationCandidates,
  findPatternCitationMentions,
  matchPageCitations,
} from "../../../src/features/reader/index.js";
import type { PageTextItem } from "../../../src/reader/index.js";

function item(str: string, x: number, width: number): PageTextItem {
  return { str, dir: "ltr", width, height: 10, transform: [10, 0, 0, 10, x, 700], fontName: "f", hasEOL: false } as PageTextItem;
}

const items = [item("see [1] and ", 0, 60), item("Smith et al. 2019 here", 60, 110)];
const text = items.map((i) => i.str).join("");
const page = { number: 3, text, items };
const analyzePage = { pageNumber: 3, items, links: [] };

test("the page has both a numeric and an author-year candidate", () => {
  const candidates = findCitationCandidates(items);
  assert.deepEqual(candidates.map((c) => [c.source, c.text]), [["numeric", "[1]"], ["author-year", "Smith et al. 2019"]]);
});

test("shared candidates give the same mentions as each step finding its own", () => {
  const candidates = findCitationCandidates(items);
  const own = findPatternCitationMentions(page, []);
  const shared = findPatternCitationMentions(page, [], [], candidates);
  assert.deepEqual(shared, own);
  assert.equal(own.length, 2);
  assert.deepEqual(
    assemblePageCitations(analyzePage, [], shared, [], candidates),
    assemblePageCitations(analyzePage, [], own, []),
  );
});

test("the steps use the candidates they are given", () => {
  assert.deepEqual(findPatternCitationMentions(page, [], [], []), []);
  const patterns = findPatternCitationMentions(page, []);
  assert.deepEqual(assemblePageCitations(analyzePage, [], patterns, [], []), []);
});

test("matchPageCitations finds both citations; a reference range hides one", () => {
  const all = matchPageCitations({ ...page, outlineItems: [] }, []);
  assert.deepEqual(all.map((m) => m.text), ["[1]", "Smith et al. 2019"]);
  const start = text.indexOf("Smith");
  const hidden = matchPageCitations({ ...page, outlineItems: [] }, [], [{ page: 3, start, end: text.length }]);
  assert.deepEqual(hidden.map((m) => m.text), ["[1]"]);
});
