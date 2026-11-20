/**
 * Printing a whole ink note: every page on its own A4 sheet, each page's
 * text and ink only on its own sheet, and only the note being printed.
 *
 * The bug this guards (0.9.5): the print looked the page's text up with a
 * global `document.querySelector`, so with a second note mounted (a kept-alive
 * tab or a split) it printed that other note's text under this note's ink; and
 * it printed the current page only.
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";

import { INK_A4_HEIGHT, INK_A4_WIDTH } from "@weaveforge/core";

import { loadTestCore } from "@/lib/test/load-test-core";
import {
  findPageUnderlay,
  inkPrintPagesDocument,
  pageUnderlayHtml,
  type InkPrintPageLayers,
  type InkPrintShared,
} from "../ui/ink-print-pages";

before(loadTestCore);

/** A host root that answers the two underlay selectors for its own pages only. */
function fakeRoot(pages: Record<number, { live?: string; static?: string }>): ParentNode {
  return {
    querySelector(selector: string) {
      const match = /^\.ink-page(-live)?\[data-page="(\d+)"\] \.ink-sheet-text-underlay$/.exec(selector);
      if (!match) return null;
      const page = pages[Number(match[2])];
      const html = match[1] ? page?.live : page?.static;
      return html === undefined ? null : ({ innerHTML: html } as Element);
    },
  } as unknown as ParentNode;
}

const shared: InkPrintShared = {
  title: "note-a",
  pageSize: { width: INK_A4_WIDTH, height: INK_A4_HEIGHT },
  scale: 0.5,
  underlay: { padX: 28, padY: 24, fontSize: 12, lineHeight: 1.6 },
  rule: { "--ink-rule": "19.2px" },
  styleSheets: [{ text: ".x{color:red}" }],
};

const sheets = (html: string) => html.split('<div class="ink-print-page">').slice(1);

test("the underlay comes from the printing note's own root, never another mounted note", () => {
  const noteA = fakeRoot({ 0: { live: "<p>A page one</p>" } });
  const noteB = fakeRoot({ 0: { live: "<p>B BISCUIT</p>" } });
  // B is mounted too (a kept-alive tab); A is the one printing.
  void noteB;
  assert.equal(findPageUnderlay(noteA, 0)?.innerHTML, "<p>A page one</p>");
  assert.equal(findPageUnderlay(noteA, 1), null, "no page 1 in A: nothing, not B's");
  assert.equal(findPageUnderlay(null, 0), null, "no root: nothing, never the whole document");
});

test("the live page's underlay is preferred over its static slot", () => {
  const root = fakeRoot({ 0: { live: "<p>live</p>", static: "<p>static</p>" }, 1: { static: "<p>s1</p>" } });
  assert.equal(findPageUnderlay(root, 0)?.innerHTML, "<p>live</p>");
  assert.equal(findPageUnderlay(root, 1)?.innerHTML, "<p>s1</p>");
});

test("a page not in the DOM renders its own text afresh; an empty page has none", () => {
  const root = fakeRoot({});
  const render = (text: string) => `<p>rendered:${text}</p>`;
  assert.equal(pageUnderlayHtml(root, 2, "page three", render), "<p>rendered:page three</p>");
  assert.equal(pageUnderlayHtml(root, 2, "   ", render), "");
  assert.equal(pageUnderlayHtml(fakeRoot({ 2: { static: "<p>dom</p>" } }), 2, "x", render), "<p>dom</p>");
});

test("two notes mounted: the print holds only the active note's text and ink, every page", () => {
  const noteA = fakeRoot({
    0: { live: "<p>A one</p>" },
    1: { static: "<p>A two</p>" },
    2: { static: "<p>A three</p>" },
  });
  const noteB = fakeRoot({ 0: { live: "<p>B BISCUIT</p>" }, 1: { static: "<p>B two</p>" } });
  void noteB;
  const render = (text: string) => `<p>${text}</p>`;
  const pages: InkPrintPageLayers[] = [0, 1, 2].map((index) => ({
    underlayHtml: pageUnderlayHtml(noteA, index, "", render),
    figures: [],
    inkUrl: `data:image/png;base64,INK${index}`,
    paper: "ruled",
  }));
  const html = inkPrintPagesDocument(shared, pages);
  assert.ok(!html.includes("BISCUIT") && !html.includes("B two"), "nothing of note B");
  const each = sheets(html);
  assert.equal(each.length, 3, "three pages, three sheets");
  each.forEach((sheet, index) => {
    assert.ok(sheet.includes(`INK${index}`), `sheet ${index + 1} has its own ink`);
    for (const other of [0, 1, 2].filter((n) => n !== index)) {
      assert.ok(!sheet.includes(`INK${other}`), `sheet ${index + 1} has no ink of page ${other + 1}`);
    }
  });
  assert.ok(each[0]!.includes("A one") && each[1]!.includes("A two") && each[2]!.includes("A three"));
});

test("a stroke on page 2 prints on sheet 2 only", () => {
  const pages: InkPrintPageLayers[] = [
    { underlayHtml: "", figures: [], paper: "plain" },
    { underlayHtml: "", figures: [], inkUrl: "data:image/png;base64,STROKE", paper: "plain" },
  ];
  const each = sheets(inkPrintPagesDocument(shared, pages));
  assert.equal(each.length, 2);
  assert.ok(!each[0]!.includes("STROKE"));
  assert.ok(each[1]!.includes("STROKE"));
});

test("each sheet is a full A4 page, 1:1, with a page break between sheets", () => {
  const page: InkPrintPageLayers = { underlayHtml: "<p>x</p>", figures: [], paper: "plain" };
  const html = inkPrintPagesDocument(shared, [page, page, page]);
  assert.ok(html.includes("@page { size: 210mm 297mm; margin: 0; }"), "A4 paper, no margin");
  assert.ok(/\.ink-print-page \{[^}]*width: 210mm; height: 297mm;/.test(html), "the sheet is 210mm by 297mm");
  assert.ok(/\.ink-print-page\s*\{[^}]*break-after:\s*page/.test(html), "a page break after each sheet");
  assert.ok(/height:\s*auto/.test(html), "the body grows past one page when printed");
  assert.equal((html.match(/<body>/g) ?? []).length, 1, "one document");
  assert.equal((html.match(/<\/html>/g) ?? []).length, 1, "one document");
});

test("one page prints exactly as the single-page document did", () => {
  const page: InkPrintPageLayers = { underlayHtml: "<p>x</p>", figures: [], paper: "plain" };
  assert.equal(sheets(inkPrintPagesDocument(shared, [page])).length, 1);
});
