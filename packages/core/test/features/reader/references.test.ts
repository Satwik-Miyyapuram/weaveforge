import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReferenceList, findCitationMentions, detectCitationStyle, findFigureMentions, isBibliographicMatch, bibliographicTitleSimilarity as titleSimilarity, type OutlineTextItem } from "../../../src/features/reader/index.js";

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

test("multi-initial author lists keep the title whole", () => {
  const refs = parseReferenceList([lines([
    "References",
    "Kingma, D. P. and Welling, M. Auto-Encoding Variational Bayes. In ICLR, 2014.",
    "Burda, Y., Grosse, R. B., and Salakhutdinov, R. Importance weighted autoencoders. In ICLR, 2016.",
    "Rezende, D. J., Mohamed, S., and Wierstra, D. Stochastic backpropagation. In ICML, 2014.",
  ])]);
  assert.equal(refs.length, 3);
  assert.deepEqual(refs[0]?.authors, ["Kingma", "Welling"]);
  assert.equal(refs[0]?.title, "Auto-Encoding Variational Bayes");
  assert.equal(refs[0]?.venue, "ICLR");
  assert.equal(refs[1]?.title, "Importance weighted autoencoders");
  assert.equal(refs[2]?.title, "Stochastic backpropagation");
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
  assert.deepEqual(found.map((m) => m.referenceIndexes), [[1, 2, 3], [1, 3], [1, 2], [1]]);
  assert.equal(found[3]!.text, "Smith et al. (2019)");
  assert.equal(found[0]!.source, "numeric");
  assert.equal(found[3]!.source, "author-year");
  assert.deepEqual(findCitationMentions({ number: 3, text, items: [] }, refs, 10), []);
});

test("superscripts retain offsets and only resolve numbered lists", () => {
  const refs = parseReferenceList(numbered);
  const items = lines(["Text", "2"]);
  items[1]!.fontSize = 7;
  const shape = (m: ReturnType<typeof findCitationMentions>[number]) =>
    ({ page: m.page, start: m.start, end: m.end, referenceIndexes: m.referenceIndexes, source: m.source });
  assert.deepEqual(findCitationMentions({ number: 1, text: "Text2", items }, refs, 10).map(shape),
    [{ page: 1, start: 4, end: 5, referenceIndexes: [2], source: "superscript" }]);
  assert.deepEqual(findCitationMentions({ number: 1, text: "Text2", items }, refs.map((ref) => ({ ...ref, label: undefined })), 10), []);
});

test("a page that cites in brackets reads no small digit as a superscript citation", () => {
  const refs = parseReferenceList(numbered);
  const items = lines(["See [1] and h", "1"]);
  items[1]!.fontSize = 7;
  const found = findCitationMentions({ number: 1, text: "See [1] and h1", items }, refs, 10);
  assert.deepEqual(found.map((m) => [m.start, m.end, m.referenceIndexes, m.source]), [[4, 7, [1], "numeric"]]);
});

test("figure and equation mentions resolve to first targets", () => {
  const pages = [{ number: 1, text: "See Fig. 2 and Eq. (3)", items: lines(["See Fig. 2 and Eq. (3)"], 1) },
    { number: 2, text: "Figure 2 A caption", items: [...lines(["Figure 2 A caption"], 2), { ...lines(["(3)"], 2, 500)[0]!, y: 300 }] }];
  const mentions = findFigureMentions(pages);
  assert.deepEqual(mentions[0]?.target, { page: 2, y: 700, x: 40, height: 10 });
  assert.deepEqual(mentions[1]?.target, { page: 2, y: 300, x: 500, height: 10 });
});

test("title scorer enforces title and year thresholds", () => {
  assert.equal(titleSimilarity("Müller: A method", "a method muller"), 1);
  assert.equal(titleSimilarity("", ""), 0);
  assert.equal(isBibliographicMatch({ title: "A useful method", year: 2020 }, { title: "A useful method", year: 2021 }), true);
  assert.equal(isBibliographicMatch({ title: "A useful method", year: 2020 }, { title: "A useful method", year: 2022 }), false);
  assert.equal(isBibliographicMatch({ title: "A useful method" }, { title: "A completely different method" }), false);
});

test("finds an unlabelled bibliography as a numbered run in the last third", () => {
  const body = (page: number) => lines(["Body prose about things.", "More body prose."], page);
  const pages = [body(1), body(2), body(3), body(4), lines([
    "1 Smith J. 2019. A method. In Proceedings.",
    "continued line",
    "2. Lee A. 2020. Another method. In Proceedings.",
    "(3) Jones J. 2021. A third method. JMLR.",
  ], 5)];
  const refs = parseReferenceList(pages);
  assert.deepEqual(refs.map((ref) => ref.index), [1, 2, 3]);
  assert.equal(refs[0]?.year, 2019);
  assert.deepEqual(refs.map((ref) => ref.label), ["1", "2.", "(3)"]);
  // A numbered list in prose, earlier in the document, is not a bibliography.
  const early = [lines(["1 Smith J. 2019.", "2. Lee A. 2020.", "3. Jones J. 2021."], 1), body(2), body(3), body(4), body(5), body(6)];
  assert.deepEqual(parseReferenceList(early), []);
  // `12.5 mm` never reads as entry twelve.
  const decimals = [body(1), lines(["1 Smith J. 2019. A method.", "12.5 mm long", "2 Lee A. 2020. B.", "3 Jones J. 2021. C."], 2)];
  assert.equal(parseReferenceList(decimals).length, 3);
});

test("detects the citation style by tally and limits the search to it", () => {
  assert.equal(detectCitationStyle(["see [1] and [2, 3]", "then [4]"]), "numeric");
  assert.equal(detectCitationStyle(["see (Smith 2019) and (Lee et al. 2020)"]), "author-year");
  assert.equal(detectCitationStyle(["see [1] [2] [3] (Smith 2019) (Lee 2020) (Jones 2021) (Doe 2022)"]), "both");
  assert.equal(detectCitationStyle(["no citations here (2019)"]), null);
  const refs = parseReferenceList(numbered);
  const page = { number: 1, text: "Smith (2019) showed [1].", items: [] };
  assert.equal(findCitationMentions(page, refs, 10, "numeric").length, 1);
  assert.equal(findCitationMentions(page, refs, 10, "author-year").length, 1);
  assert.equal(findCitationMentions(page, refs, 10, "both").length, 2);
  assert.equal(findCitationMentions(page, refs, 10, null).length, 0);
});

test("a caption line is a target, not a mention of itself", () => {
  const pages = [
    { number: 1, text: "As Figure 1 shows.", items: lines(["As Figure 1 shows."], 1) },
    { number: 2, text: "Figure 1: The thing.\nFigure 1 is above.", items: lines(["Figure 1: The thing.", "Figure 1 is above."], 2) },
  ];
  const mentions = findFigureMentions(pages, []);
  assert.deepEqual(mentions.map((m) => [m.page, m.start]), [[1, 3], [2, 21]]);
});
