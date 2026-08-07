import assert from "node:assert/strict";
import test from "node:test";
import type { CombinedPdfAnchor, ReaderAnnotation } from "@weaveforge/core";
import {
  bucketAnnotationsByPage,
  projectPageAnnotationGeometry,
} from "../application/project-annotation-geometry";

const PAGE_HEIGHT = 792;

function ann(overrides: Partial<ReaderAnnotation> & { anchor: CombinedPdfAnchor }): ReaderAnnotation {
  return {
    id: "a1",
    origin: "zotero",
    zoteroKey: "ABCD1234",
    type: "highlight",
    color: "#ffd400",
    text: "quoted",
    comment: "",
    tags: [],
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function project(annotations: ReaderAnnotation[], over: Partial<{ pageNumber: number; scale: number; contentHash: string }> = {}) {
  return projectPageAnnotationGeometry({
    annotations,
    pageNumber: over.pageNumber ?? 1,
    scale: over.scale ?? 1,
    pageHeight: PAGE_HEIGHT,
    contentHash: over.contentHash ?? "",
  });
}

test("flips the PDF bottom-left origin to a DOM top-left origin", () => {
  // A rect 700..712 units up from the bottom of a 792-unit page sits 80px from
  // the top. Getting this backwards puts every highlight on the wrong line.
  const { boxes } = project([
    ann({ anchor: { zoteroPosition: { pageIndex: 0, rects: [[72, 700, 172, 712]] } } }),
  ]);
  assert.equal(boxes.length, 1);
  assert.deepEqual(
    { left: boxes[0]!.left, top: boxes[0]!.top, width: boxes[0]!.width, height: boxes[0]!.height },
    { left: 72, top: 80, width: 100, height: 12 },
  );
});

test("scales every projected dimension", () => {
  const { boxes } = project(
    [ann({ anchor: { zoteroPosition: { pageIndex: 0, rects: [[72, 700, 172, 712]] } } })],
    { scale: 2 },
  );
  assert.deepEqual(
    { left: boxes[0]!.left, top: boxes[0]!.top, width: boxes[0]!.width, height: boxes[0]!.height },
    { left: 144, top: 160, width: 200, height: 24 },
  );
});

test("normalises rects stored with inverted corners", () => {
  const { boxes } = project([
    ann({ anchor: { zoteroPosition: { pageIndex: 0, rects: [[172, 712, 72, 700]] } } }),
  ]);
  assert.deepEqual(
    { left: boxes[0]!.left, top: boxes[0]!.top, width: boxes[0]!.width, height: boxes[0]!.height },
    { left: 72, top: 80, width: 100, height: 12 },
  );
});

test("only paints rects belonging to the page being rendered", () => {
  const annotations = [
    ann({ id: "p0", anchor: { zoteroPosition: { pageIndex: 0, rects: [[0, 0, 10, 10]] } } }),
    ann({ id: "p4", anchor: { zoteroPosition: { pageIndex: 4, rects: [[0, 0, 10, 10]] } } }),
  ];
  assert.deepEqual(
    project(annotations, { pageNumber: 1 }).boxes.map((b) => b.id),
    ["p0"],
  );
  assert.deepEqual(
    project(annotations, { pageNumber: 5 }).boxes.map((b) => b.id),
    ["p4"],
  );
});

test("paints nextPageRects on the following page only", () => {
  // A highlight anchored to page index 3 whose tail spills onto page index 4.
  const spilling = ann({
    id: "spill",
    anchor: {
      zoteroPosition: {
        pageIndex: 3,
        rects: [[72, 100, 500, 112]],
        nextPageRects: [[72, 700, 300, 712]],
      },
    },
  });

  // Page 4 (index 3) gets the head only.
  const head = project([spilling], { pageNumber: 4 }).boxes;
  assert.equal(head.length, 1);
  assert.equal(head[0]!.top, PAGE_HEIGHT - 112);

  // Page 5 (index 4) gets the tail only.
  const tail = project([spilling], { pageNumber: 5 }).boxes;
  assert.equal(tail.length, 1);
  assert.equal(tail[0]!.top, PAGE_HEIGHT - 712);
  assert.equal(tail[0]!.width, 228);

  // And nothing leaks onto an unrelated page.
  assert.equal(project([spilling], { pageNumber: 6 }).boxes.length, 0);
});

test("projects ink paths as scaled, flipped polyline points", () => {
  const { strokes, boxes } = project([
    ann({
      id: "ink",
      type: "ink",
      anchor: { zoteroPosition: { pageIndex: 0, paths: [[10, 782, 20, 772]] } },
    }),
  ]);
  assert.equal(boxes.length, 0, "ink has no rects to box");
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0]!.points, "10,10 20,20");
});

test("drops malformed rects and path points instead of emitting NaN geometry", () => {
  const { boxes, strokes } = project([
    ann({
      id: "bad",
      anchor: {
        zoteroPosition: {
          pageIndex: 0,
          rects: [[1, 2], [NaN, 1, 2, 3], [72, 700, 172, 712]],
          paths: [[1, 2]],
        },
      },
    }),
  ]);
  assert.equal(boxes.length, 1, "only the well-formed rect survives");
  assert.equal(strokes.length, 0, "a two-number path is not a stroke");
  for (const box of boxes) {
    for (const n of [box.left, box.top, box.width, box.height]) {
      assert.ok(Number.isFinite(n), "no NaN reaches a style attribute");
    }
  }
});

test("refuses to paint geometry captured against a different file", () => {
  const stale = ann({
    anchor: {
      contentHash: "hash-of-the-old-pdf",
      zoteroPosition: { pageIndex: 0, rects: [[72, 700, 172, 712]] },
      locus: { quote: { type: "TextQuoteSelector", exact: "quoted" } },
    },
  });
  assert.equal(project([stale], { contentHash: "hash-of-the-new-pdf" }).boxes.length, 0);
  assert.equal(project([stale], { contentHash: "hash-of-the-old-pdf" }).boxes.length, 1);
});

test("refuses to paint ink captured against a different file", () => {
  // Ink has no quote to fall back to, so an ungated path would be drawn at
  // coordinates that mean nothing in the current document.
  const stale = ann({
    id: "ink",
    type: "ink",
    anchor: {
      contentHash: "old",
      zoteroPosition: { pageIndex: 0, paths: [[10, 782, 20, 772]] },
    },
  });
  assert.equal(project([stale], { contentHash: "new" }).strokes.length, 0);
  assert.equal(project([stale], { contentHash: "old" }).strokes.length, 1);
});

test("trusts geometry when neither side names a file", () => {
  // Local annotations on a PDF we have no hash for — the common case today.
  const local = ann({
    origin: "local",
    zoteroKey: null,
    anchor: { zoteroPosition: { pageIndex: 0, rects: [[72, 700, 172, 712]] } },
  });
  assert.equal(project([local], { contentHash: "" }).boxes.length, 1);
});

test("marks underlines so they render as a rule rather than a fill", () => {
  const { boxes } = project([
    ann({ type: "underline", anchor: { zoteroPosition: { pageIndex: 0, rects: [[0, 0, 10, 10]] } } }),
    ann({ id: "h", anchor: { zoteroPosition: { pageIndex: 0, rects: [[0, 0, 10, 10]] } } }),
  ]);
  assert.deepEqual(boxes.map((b) => b.underline), [true, false]);
});

test("skips annotations with no stored position", () => {
  const quoteOnly = ann({
    anchor: { locus: { quote: { type: "TextQuoteSelector", exact: "somewhere" } } },
  });
  assert.deepEqual(project([quoteOnly]), { boxes: [], strokes: [] });
});

test("bucketAnnotationsByPage groups by the page an annotation paints on", () => {
  const first = ann({ id: "p1", anchor: { zoteroPosition: { pageIndex: 0, rects: [[0, 0, 1, 1]] } } });
  const later = ann({ id: "p5", anchor: { zoteroPosition: { pageIndex: 4, rects: [[0, 0, 1, 1]] } } });
  const buckets = bucketAnnotationsByPage([first, later]);
  assert.deepEqual(buckets.get(1)?.map((a) => a.id), ["p1"]);
  assert.deepEqual(buckets.get(5)?.map((a) => a.id), ["p5"]);
  assert.equal(buckets.get(2), undefined);
  assert.equal(buckets.size, 2);
});

test("bucketAnnotationsByPage puts a cross-page highlight in both buckets", () => {
  // Anchored to page index 3, spilling onto index 4 — pages 4 and 5.
  const spilling = ann({
    id: "spill",
    anchor: {
      zoteroPosition: {
        pageIndex: 3,
        rects: [[72, 100, 500, 112]],
        nextPageRects: [[72, 700, 300, 712]],
      },
    },
  });
  const buckets = bucketAnnotationsByPage([spilling]);
  assert.deepEqual(buckets.get(4)?.map((a) => a.id), ["spill"]);
  assert.deepEqual(buckets.get(5)?.map((a) => a.id), ["spill"]);
  assert.equal(buckets.size, 2);
});

test("bucketAnnotationsByPage drops annotations that cannot be placed", () => {
  const quoteOnly = ann({
    id: "q",
    anchor: { locus: { quote: { type: "TextQuoteSelector", exact: "somewhere" } } },
  });
  const negative = ann({ id: "n", anchor: { zoteroPosition: { pageIndex: -1 } } });
  const fractional = ann({ id: "f", anchor: { zoteroPosition: { pageIndex: 1.5 } } });
  assert.equal(bucketAnnotationsByPage([quoteOnly, negative, fractional]).size, 0);
});

test("bucketing and projection agree on which page paints what", () => {
  // The bucket is a filter in front of the projector; if they disagree an
  // annotation silently stops rendering. Assert they cannot drift apart.
  const annotations = [
    ann({ id: "a", anchor: { zoteroPosition: { pageIndex: 0, rects: [[0, 0, 10, 10]] } } }),
    ann({
      id: "b",
      anchor: {
        zoteroPosition: {
          pageIndex: 1,
          rects: [[0, 0, 10, 10]],
          nextPageRects: [[0, 0, 10, 10]],
        },
      },
    }),
    ann({ id: "c", type: "ink", anchor: { zoteroPosition: { pageIndex: 2, paths: [[1, 2, 3, 4]] } } }),
  ];
  const buckets = bucketAnnotationsByPage(annotations);
  for (let pageNumber = 1; pageNumber <= 4; pageNumber++) {
    const fromAll = project(annotations, { pageNumber });
    const fromBucket = projectPageAnnotationGeometry({
      annotations: buckets.get(pageNumber) ?? [],
      pageNumber,
      scale: 1,
      pageHeight: PAGE_HEIGHT,
      contentHash: "",
    });
    assert.deepEqual(fromBucket, fromAll, `page ${pageNumber} must render identically`);
  }
});
