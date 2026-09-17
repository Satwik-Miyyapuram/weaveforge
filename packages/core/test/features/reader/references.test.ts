import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReferenceList, findCitationMentions, findFigureMentions, isBibliographicMatch, bibliographicTitleSimilarity as titleSimilarity, type OutlineTextItem } from "../../../src/features/reader/index.js";

function lines(texts: string[], page = 3, x = 40): OutlineTextItem[] {
  return texts.map((str, i) => ({ str, page, x, y: 700 - i * 15, fontSize: 10 }));
}
const numbered = [lines([
  "References",
  '[1] Smith, John. 2019. A useful method. In Proceedings.',
  '[2] Lee, Ada. 2020. Another method. In Proceedings. 10.1234/TEST.',
  '[3] Jones, Jim. 2021. “A quoted title”. arXiv:2101.12345',
])];

test("splits numbered references and extracts identifiers, title, year and surname", () => {
  const refs = parseReferenceList(numbered);
  assert.equal(refs.length, 3);
  assert.equal(refs[0]?.authors[0], "Smith");
  assert.equal(refs[0]?.title, "A useful method");
  assert.equal(refs[1]?.doi, "10.1234/test");
  assert.equal(refs[2]?.arxivId, "2101.12345");
  assert.equal(refs[2]?.title, "A quoted title");
});

test("uses the last bibliography heading, joins hyphens and stops at Appendix", () => {
  const input = [lines(["References", "Contents", "References", '[1] Smith. 2019. “Hyphen-', 'ated title”.', '[2] Lee. 2020. “Second”.', '[3] Jones. 2021. “Third”.', "Appendix", "[4] Not a reference."])];
  const refs = parseReferenceList(input);
  assert.equal(refs.length, 3);
  assert.equal(refs[0]?.title, "Hyphenated title");
  assert.deepEqual(parseReferenceList([lines(["Not a bibliography", "[1] Something"])]), []);
});

test("handles unnumbered hanging indents in two columns", () => {
  const first = lines(["References", "Smith, J. 2019. First title.", "Continuation", "Lee, A. 2020. Second title."], 3);
  first[2]!.x += 12;
  const second = lines(["Jones, J. 2021. Third title.", "Continuation"], 3, 320);
  second[1]!.x += 12;
  assert.equal(parseReferenceList([[...first, ...second]]).length, 3);
});

test("finds numeric ranges, author-year lists and narrative mentions without false positives", () => {
  const refs = parseReferenceList(numbered);
  const text = "[1–3] [1, 3] [10 mm] [0, 1] (2019) (Smith 2019; Lee 2020) Smith et al. (2019)";
  const found = findCitationMentions({ number: 1, text, items: [] }, refs, 10);
  assert.deepEqual(found.map((m) => m.refIndexes), [[1, 2, 3], [1, 3], [1, 2], [1]]);
  assert.equal(text.slice(found[3]!.start, found[3]!.end), "Smith et al. (2019)");
  assert.deepEqual(findCitationMentions({ number: 3, text, items: [] }, refs, 10), []);
});

test("superscripts retain offsets and only resolve numbered lists", () => {
  const refs = parseReferenceList(numbered);
  const items = lines(["Text", "2"]);
  items[1]!.fontSize = 7;
  assert.deepEqual(findCitationMentions({ number: 1, text: "Text2", items }, refs, 10), [{ page: 1, start: 4, end: 5, refIndexes: [2] }]);
  assert.deepEqual(findCitationMentions({ number: 1, text: "Text2", items }, refs.map((ref) => ({ ...ref, label: undefined })), 10), []);
});

test("figure and equation mentions resolve to first targets", () => {
  const pages = [{ number: 1, text: "See Fig. 2 and Eq. (3)", items: lines(["See Fig. 2 and Eq. (3)"], 1) },
    { number: 2, text: "Figure 2 A caption", items: [...lines(["Figure 2 A caption"], 2), { ...lines(["(3)"], 2, 500)[0]!, y: 300 }] }];
  const mentions = findFigureMentions(pages);
  assert.deepEqual(mentions[0]?.target, { page: 2, y: 700 });
  assert.deepEqual(mentions[1]?.target, { page: 2, y: 300 });
});

test("title scorer enforces title and year thresholds", () => {
  assert.equal(titleSimilarity("Müller: A method", "a method muller"), 1);
  assert.equal(titleSimilarity("", ""), 0);
  assert.equal(isBibliographicMatch({ title: "A useful method", year: 2020 }, { title: "A useful method", year: 2021 }), true);
  assert.equal(isBibliographicMatch({ title: "A useful method", year: 2020 }, { title: "A useful method", year: 2022 }), false);
  assert.equal(isBibliographicMatch({ title: "A useful method" }, { title: "A completely different method" }), false);
});
