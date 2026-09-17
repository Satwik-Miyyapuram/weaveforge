/**
 * The print document (the sheet rebuilt for paper).
 *
 * What is asserted is that nothing the sheet shows is left out — the paper's
 * class and ruling, the rendered markdown at the screen's metrics, each figure
 * in its frame, the ink over all of it — that the page is sized in millimetres
 * for `@page`, and that the strings a caller hands in cannot break out of the
 * markup.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { INK_A4_HEIGHT, INK_A4_WIDTH } from "@weaveforge/core";

import { inkPrintDocument, type InkPrintDocument } from "../application/ink-print";

const base: InkPrintDocument = {
  title: 'notes <"quoted">',
  pageSize: { width: INK_A4_WIDTH, height: INK_A4_HEIGHT },
  scale: 0.5,
  paper: "ruled",
  underlayHtml: "<h3>Heading</h3><p>Body</p>",
  underlay: { padX: 28, padY: 24, fontSize: 12, lineHeight: 1.6 },
  rule: { "--ink-rule": "19.2px", "--ink-rule-offset": "24px" },
  figures: [{ x: 100, y: 200, w: 400, h: 300, url: "data:image/png;base64,AAAA" }],
  inkUrl: "data:image/png;base64,BBBB",
  styleSheets: [{ href: "https://app/_next/static/a.css" }, { text: ".x{color:red}" }],
};

test("every layer of the sheet is in the document, in the sheet's order", () => {
  const html = inkPrintDocument(base);
  const at = (needle: string) => {
    const index = html.indexOf(needle);
    assert.notEqual(index, -1, `missing: ${needle}`);
    return index;
  };
  assert.ok(html.includes('class="ink-sheet paper-ruled"'), "the paper's class");
  assert.ok(html.includes("--ink-rule:19.2px;--ink-rule-offset:24px"), "the ruling");
  // The paper's own rules are a background image; the print's white is the
  // colour alone, or the shorthand would wipe the ruling off the page.
  assert.ok(!/\.ink-sheet \{[^}]*[^-]background: #fff/.test(html), "the ruling survives the paper's white");
  assert.ok(html.includes("padding:24px 28px;font-size:12px;line-height:1.6"), "the underlay's metrics");
  assert.ok(html.includes("<h3>Heading</h3><p>Body</p>"), "the markdown, as is");
  assert.ok(html.includes("left:50px;top:100px;width:200px;height:150px"), "the figure at scale");
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'), "the figure's picture");
  assert.ok(at("ink-sheet-text-underlay") < at("ink-figures"), "text under figures");
  assert.ok(at("ink-figures") < at("ink-print-ink"), "figures under ink");
  assert.ok(html.includes("@page { size: 210mm 297mm; margin: 0; }"), "A4 in millimetres");
  assert.ok(html.includes('<link rel="stylesheet" href="https://app/_next/static/a.css">'));
  assert.ok(html.includes("<style>.x{color:red}</style>"));
});

test("a page with no ink and no text prints its paper and figures alone", () => {
  const html = inkPrintDocument({ ...base, inkUrl: null, underlayHtml: "" });
  assert.ok(!html.includes("ink-print-ink"));
  assert.ok(!html.includes("ink-sheet-text-underlay"));
  assert.ok(html.includes('class="ink-figure"'));
});

test("the title and the paper cannot break out of the markup", () => {
  const html = inkPrintDocument({ ...base, paper: 'x" onload="y' });
  assert.ok(html.includes("<title>notes &lt;&quot;quoted&quot;&gt;</title>"));
  assert.ok(!html.includes('onload="y'));
});
