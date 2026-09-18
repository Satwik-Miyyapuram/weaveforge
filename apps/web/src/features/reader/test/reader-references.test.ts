import { test } from "node:test";
import assert from "node:assert/strict";
import type { PageTextItem } from "@weaveforge/core";
import { buildReferenceIndex, type ReferencePage } from "../application/reader-references";

/** One text run at a page position, 10pt body unless told otherwise. */
function run(str: string, { x = 72, y = 700, size = 10, eol = true }: { x?: number; y?: number; size?: number; eol?: boolean } = {}): PageTextItem {
  return { str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, height: size, hasEOL: eol };
}

const prose = (y: number) => run("Body prose of the paper goes here and here.", { y });

/**
 * A three-page document: a body page citing `[1]` and pointing at a figure, a
 * page whose caption is the figure's target, and the bibliography.
 */
const pages: ReferencePage[] = [
  { pageNumber: 1, items: [
    run("Attention [1] works.", { y: 700 }),
    run("See Fig. 2 for the layout.", { y: 688 }),
    ...Array.from({ length: 8 }, (_, i) => prose(676 - i * 12)),
  ] },
  { pageNumber: 2, items: [run("Figure 2: The layout.", { y: 640 }), ...Array.from({ length: 8 }, (_, i) => prose(600 - i * 12))] },
  { pageNumber: 3, items: [
    run("References", { y: 700, size: 13 }),
    run("[1] Vaswani A. Attention is all you need. NeurIPS, 2017.", { y: 686 }),
    run("[2] Devlin J. BERT. NAACL, 2019.", { y: 672 }),
    run("[3] Smith J. A third entry. JMLR, 2018.", { y: 658 }),
  ] },
];

const index = buildReferenceIndex(pages, []);

test("the bibliography is parsed and indexed by entry number", () => {
  assert.equal(index.references.length, 3);
  assert.equal(index.byIndex.get(1)?.year, 2017);
  assert.equal(index.references[0]?.label, "[1]");
  assert.equal(index.references[0]?.page, 3);
});

test("a citation becomes a mention whose offsets index the derived page text", () => {
  const citations = (index.mentionsByPage.get(1) ?? []).filter((hit) => hit.kind === "citation");
  assert.equal(citations.length, 1);
  assert.deepEqual(citations[0]?.refIndexes, [1]);
  assert.equal(citations[0]?.label, "[1]");
  assert.deepEqual([citations[0]!.start, citations[0]!.end], [10, 13]);
});

test("a figure mention carries the caption's page and y as its target", () => {
  const figures = (index.mentionsByPage.get(1) ?? []).filter((hit) => hit.kind === "figure");
  assert.equal(figures.length, 1);
  assert.equal(figures[0]?.label, "Fig. 2");
  assert.deepEqual(figures[0]?.target, { page: 2, x: 72, y: 640, height: 10 });
});

test("nothing inside the bibliography links back to itself, and quiet pages are absent", () => {
  assert.deepEqual([...index.mentionsByPage.keys()], [1]);
});

test("the fingerprint is stable for the same text and keys are unique", () => {
  assert.equal(index.fingerprint, buildReferenceIndex(pages, []).fingerprint);
  assert.match(index.fingerprint, /^[0-9a-f]{16}$/);
  const keys = (index.mentionsByPage.get(1) ?? []).map((hit) => hit.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("a document with no reference list yields no mentions and no crash", () => {
  const result = buildReferenceIndex([{ pageNumber: 1, items: [run("No citations here.")] }], []);
  assert.deepEqual(result.references, []);
  assert.equal(result.mentionsByPage.size, 0);
  assert.equal(buildReferenceIndex([], []).fingerprint, "");
});

test("a hyperref link over the digits of `[2 ]` is the citation, widened to its brackets", () => {
  // pdf.js splits a linked bracket into `[`, the digits, a zero-width space
  // and `]`, so the pattern alone reads `[2 ]` and the link names the entry.
  const linked: ReferencePage[] = [
    {
      pageNumber: 1,
      items: [
        run("BERT [", { y: 700, eol: false }),
        run("2", { x: 102, y: 700, eol: false }),
        run(" ", { x: 107, y: 700, eol: false }),
        run("] and a URL", { x: 107, y: 700 }),
        ...Array.from({ length: 8 }, (_, i) => prose(676 - i * 12)),
      ],
      links: [
        { rect: [101, 699, 108, 710], dest: { page: 3, x: 72, y: 674 } },
        { rect: [140, 699, 180, 710], url: "https://example.org" },
      ],
    },
    pages[1]!,
    pages[2]!,
  ];
  const citations = (buildReferenceIndex(linked, []).mentionsByPage.get(1) ?? []).filter((hit) => hit.kind === "citation");
  assert.equal(citations.length, 1);
  assert.deepEqual(citations[0]?.refIndexes, [2]);
  assert.deepEqual([citations[0]!.start, citations[0]!.end], [5, 9]);
});
