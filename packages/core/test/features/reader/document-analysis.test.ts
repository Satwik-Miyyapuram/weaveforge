import { test } from "node:test";
import assert from "node:assert/strict";
import {
  analyzePdfDocument,
  type AnalyzePdfPage,
  type PdfLink,
} from "../../../src/features/reader/index.js";
import {
  authorYearReferences,
  numberedReferences,
  rectOver,
  run,
  textPage,
} from "./analysis-fixtures.js";

const body = (n: number, pageNumber: number) =>
  textPage(pageNumber, Array.from({ length: n }, (_, i) => `Body prose ${i} about the method.`));

test("IEEE numeric citations resolve to the numbered list", () => {
  const pages: AnalyzePdfPage[] = [
    textPage(1, [
      "As shown in [1] and [2, 3], the method works.",
      "Others disagree [4-5].",
    ]),
    body(8, 2),
    textPage(3, numberedReferences(6)),
  ];
  const analysis = analyzePdfDocument(pages);
  assert.equal(analysis.references.length, 6);
  assert.deepEqual(analysis.references[0]?.authors, ["Anderson"]);
  assert.equal(analysis.references[0]?.venue, "Proceedings of Test 1");
  const cites = analysis.citations.filter((c) => c.page === 1);
  assert.deepEqual(cites.map((c) => [c.text, c.referenceIndexes, c.source]), [
    ["[1]", [1], "numeric"],
    ["[2, 3]", [2, 3], "numeric"],
    ["[4-5]", [4, 5], "numeric"],
  ]);
  assert.ok(cites.every((c) => c.confidence >= 0.85));
  assert.ok(cites.every((c) => c.rects.length >= 1 && c.rects[0]!.length === 4));
});

test("Vancouver superscripts are found without any bracket citations", () => {
  const page1: AnalyzePdfPage = {
    pageNumber: 1,
    items: [
      run("The pathway activates", 40, 700, { hasEOL: false }),
      run("1", 145, 703, { fontSize: 6.5, hasEOL: false }),
      run(" and the receptor binds", 150, 700, { hasEOL: false }),
      run("2", 265, 703, { fontSize: 6.5 }),
    ],
  };
  const pages = [page1, body(8, 2), textPage(3, numberedReferences(4))];
  const analysis = analyzePdfDocument(pages);
  const cites = analysis.citations.filter((c) => c.page === 1);
  assert.deepEqual(cites.map((c) => [c.text, c.referenceIndexes, c.source]), [
    ["1", [1], "superscript"],
    ["2", [2], "superscript"],
  ]);
});

test("APA/Harvard author-year citations, groups and narrative forms", () => {
  const pages: AnalyzePdfPage[] = [
    textPage(1, [
      "The effect replicates (Smith 2020; Jones 2021).",
      "Smith et al. (2020) agree, and Jones (2021) extends it.",
    ]),
    body(8, 2),
    textPage(3, authorYearReferences([
      { surname: "Smith", year: 2020 },
      { surname: "Jones", year: 2021 },
      { surname: "Lee", year: 2019 },
    ])),
  ];
  const analysis = analyzePdfDocument(pages);
  assert.equal(analysis.references.length, 3);
  const cites = analysis.citations.filter((c) => c.page === 1);
  assert.deepEqual(cites.map((c) => [c.text, c.referenceIndexes]), [
    ["(Smith 2020; Jones 2021)", [1, 2]],
    ["Smith et al. (2020)", [1]],
    ["Jones (2021)", [2]],
  ]);
  assert.ok(cites.every((c) => c.source === "author-year"));
});

test("2020a / 2020b pairs both match a suffix-less citation", () => {
  const pages: AnalyzePdfPage[] = [
    textPage(1, [
      "As Smith (2020) shows, the effect is real.",
      "Jones (2021) replicates the finding.",
    ]),
    body(8, 2),
    textPage(3, authorYearReferences([
      { surname: "Smith", year: 2020, title: "First study" },
      { surname: "Smith", year: 2020, title: "Second study" },
      { surname: "Jones", year: 2021, title: "Another study" },
    ])),
  ];
  const analysis = analyzePdfDocument(pages);
  assert.equal(analysis.references.length, 3);
  const smith = analysis.citations.find((c) => c.page === 1 && c.text.startsWith("Smith"));
  assert.deepEqual(smith?.referenceIndexes, [1, 2]);
});

test("citations split across PDF text items and over line breaks", () => {
  const split: AnalyzePdfPage = {
    pageNumber: 1,
    items: [
      run("Result in [", 40, 700, { hasEOL: false }),
      run("5", 95, 700, { hasEOL: false }),
      run("] holds, and [6,", 100, 700),
      run("7] holds too.", 40, 685),
    ],
  };
  const pages = [split, body(8, 2), textPage(3, numberedReferences(8))];
  const analysis = analyzePdfDocument(pages);
  const cites = analysis.citations.filter((c) => c.page === 1);
  assert.deepEqual(cites.map((c) => c.referenceIndexes), [[5], [6, 7]]);
});

test("two-column pages are read in column order and cite from both columns", () => {
  const left = [40, 100, 160, 220].map((y, i) =>
    run(i === 2 ? "Left column cites [1] here." : `Left column prose line ${i}.`, 40, 700 - i * 15),
  );
  const right = [0, 1, 2, 3].map((i) =>
    run(i === 1 ? "Right column cites [2] here." : `Right column prose line ${i}.`, 320, 700 - i * 15),
  );
  const pages: AnalyzePdfPage[] = [
    { pageNumber: 1, items: [...left, ...right] },
    body(8, 2),
    textPage(3, numberedReferences(3)),
  ];
  const analysis = analyzePdfDocument(pages);
  assert.equal(analysis.pages[0]?.columns, 2);
  const cites = analysis.citations.filter((c) => c.page === 1);
  assert.deepEqual(cites.map((c) => c.referenceIndexes), [[1], [2]]);
});

test("references split across pages still resolve", () => {
  const pages: AnalyzePdfPage[] = [
    textPage(1, ["Prior work [5] motivates this."]),
    body(8, 2),
    textPage(3, numberedReferences(3)),
    textPage(4, ["Evans, A. 2000. Later work. Venue.", "Freeman, A. 2001. Later work. Venue.", "Gupta, A. 2002. Later work. Venue."].map((text, i) => `[${i + 4}] ${text}`)),
  ];
  const analysis = analyzePdfDocument(pages);
  assert.equal(analysis.references.length, 6);
  assert.deepEqual(analysis.references.map((ref) => ref.page), [3, 3, 3, 4, 4, 4]);
  const cite = analysis.citations.find((c) => c.page === 1);
  assert.deepEqual(cite?.referenceIndexes, [5]);
});

test("internal PDF /Dest links are authoritative over regex parsing", () => {
  // The text layer splits `[16]` into `[`, `16`, zero-width space, `]` — the
  // regex cannot read it back; only the document's own link can.
  const page: AnalyzePdfPage = {
    pageNumber: 1,
    items: [
      run("memory [", 100, 500, { hasEOL: false }),
      run("16", 140, 500, { hasEOL: false }),
      run("\u200b", 150, 500, { hasEOL: false, width: 0 }),
      run("] and more", 150, 500),
    ],
    links: [
      { rect: [139, 498, 151, 510], dest: { page: 3, x: 40, y: 706 } },
      { rect: [300, 498, 310, 510], url: "https://example.org" },
    ],
  };
  const refsPage = textPage(3, numberedReferences(20));
  const entry16 = refsPage.items[16]!;
  page.links![0]!.dest = { page: 3, x: 40, y: entry16.transform[5]! + 1 };
  const analysis = analyzePdfDocument([page, body(8, 2), refsPage]);
  const cites = analysis.citations.filter((c) => c.page === 1);
  assert.equal(cites.length, 1);
  assert.deepEqual(cites[0]?.referenceIndexes, [16]);
  assert.equal(cites[0]?.source, "internal-pdf-link");
  assert.equal(cites[0]?.confidence, 1);
  assert.ok(cites[0]!.rects.length >= 1);
});

test("an internal link whose destination is unknown falls back to its printed label", () => {
  const page: AnalyzePdfPage = {
    pageNumber: 1,
    items: [run("See [3] for details.", 40, 600)],
    links: [{ rect: rectOver("[3]", 60, 600), dest: { page: 9, x: 40, y: 700 } }],
  };
  const analysis = analyzePdfDocument([page, body(8, 2), textPage(3, numberedReferences(5))]);
  const cite = analysis.citations.find((c) => c.page === 1);
  assert.deepEqual(cite?.referenceIndexes, [3]);
  assert.equal(cite?.source, "internal-pdf-link");
  assert.ok(cite!.confidence < 1);
});

test("figure, table and equation mentions resolve to their captions", () => {
  const pages: AnalyzePdfPage[] = [
    textPage(1, ["As Fig. 2 shows, and Table 1 lists, Eq. (3) holds."]),
    {
      pageNumber: 2,
      items: [
        run("Figure 2: The result.", 40, 700),
        run("Table 1: The numbers.", 40, 500),
        run("some math", 40, 300, { hasEOL: false }),
        run("(3)", 500, 300),
      ],
    },
  ];
  const analysis = analyzePdfDocument(pages);
  const kinds = analysis.figures.map((f) => [f.kind, f.target.page]);
  assert.deepEqual(kinds, [["figure", 2], ["table", 2], ["equation", 2]]);
});

test("non-English reference headings are found", () => {
  for (const heading of ["Referencias", "Literaturverzeichnis", "Références", "Referências"]) {
    const pages: AnalyzePdfPage[] = [
      textPage(1, ["Como se muestra en [1]."]),
      body(8, 2),
      textPage(3, numberedReferences(3, heading)),
    ];
    const analysis = analyzePdfDocument(pages);
    assert.equal(analysis.references.length, 3, heading);
    assert.deepEqual(analysis.citations.filter((c) => c.page === 1).map((c) => c.referenceIndexes), [[1]], heading);
  }
});

test("a paper without any References heading is parsed by its numbered run", () => {
  const pages: AnalyzePdfPage[] = [
    textPage(1, ["Prior work [2] suggests this."]),
    body(8, 2),
    body(8, 3),
    body(8, 4),
    textPage(5, ["Smith, A. 1999. Work 1. Venue.", "Baker, A. 2000. Work 2. Venue.", "Clarke, A. 2001. Work 3. Venue.", "Davis, A. 2002. Work 4. Venue."].map((text, i) => `${i + 1} ${text}`)),
  ];
  const analysis = analyzePdfDocument(pages);
  assert.equal(analysis.references.length, 4);
  assert.deepEqual(analysis.citations.filter((c) => c.page === 1).map((c) => c.referenceIndexes), [[2]]);
});

test("equations, dates and measurements are never citations", () => {
  const pages: AnalyzePdfPage[] = [
    textPage(1, [
      "The unit interval [0, 1] and [10 mm] of margin.",
      "In (2019) it was summer; Eq. (2) defines h with h1 exponents.",
      "A 5% gain on [3].", // the only real citation
    ]),
    body(8, 2),
    textPage(3, numberedReferences(4)),
  ];
  const analysis = analyzePdfDocument(pages);
  const cites = analysis.citations.filter((c) => c.page === 1);
  assert.deepEqual(cites.map((c) => [c.text, c.referenceIndexes]), [["[3]", [3]]]);
});

test("sections come from the supplied outline, or from headings when absent", () => {
  const headingRows = [
    { text: "1 Introduction", bold: true, fontSize: 12 },
    "Intro prose.",
    { text: "2 Method", bold: true, fontSize: 12 },
    "Method prose.",
    { text: "3 Results", bold: true, fontSize: 12 },
    "Results prose.",
  ];
  const pages: AnalyzePdfPage[] = [
    textPage(1, headingRows),
    body(8, 2),
    textPage(3, numberedReferences(3)),
  ];
  const inferred = analyzePdfDocument(pages);
  // The References heading closes the outline, as in `outlineFromText`.
  assert.deepEqual(inferred.sections.slice(0, 3).map((s) => s.title), ["1 Introduction", "2 Method", "3 Results"]);
  const outline = [{ title: "Bookmark", pageNumber: 1 }];
  const withOutline = analyzePdfDocument(pages, outline);
  assert.deepEqual(withOutline.sections, outline);
});

test("running heads are not mistaken for sections or entries", () => {
  const head = "Smith et al. · Preprint";
  const pages: AnalyzePdfPage[] = Array.from({ length: 4 }, (_, i) =>
    textPage(i + 1, [
      { text: `${head} ${i + 1}`, x: 40 },
      ...(i === 0 ? [{ text: "1 Introduction", bold: true, fontSize: 12 }, "Prose [1].", { text: "2 Method", bold: true, fontSize: 12 }, "Prose.", { text: "3 Results", bold: true, fontSize: 12 }, "Prose."] : ["More prose."]),
    ]),
  );
  pages.push(textPage(5, numberedReferences(3)));
  const analysis = analyzePdfDocument(pages);
  assert.ok(!analysis.sections.some((s) => s.title.includes("Preprint")));
  assert.deepEqual(analysis.citations.filter((c) => c.page === 1).map((c) => c.referenceIndexes), [[1]]);
});

test("the fingerprint is stable and text survives on every page", () => {
  const pages: AnalyzePdfPage[] = [textPage(1, ["Hello [1]."]), body(8, 2), textPage(3, numberedReferences(2))];
  const a = analyzePdfDocument(pages);
  const b = analyzePdfDocument(pages.map((p) => ({ ...p, items: [...p.items] })));
  assert.equal(a.fingerprint, b.fingerprint);
  assert.match(a.fingerprint, /^[0-9a-f]{16}$/);
  assert.deepEqual(a.pages.map((p) => p.text.includes("[1]") || p.text.includes("Body prose") || p.text.includes("References")), [true, true, true]);
});
