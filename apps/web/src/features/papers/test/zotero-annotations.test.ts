import assert from "node:assert/strict";
import test from "node:test";
import { ZoteroAnnotations } from "../infrastructure/zotero-annotations";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function mockFetch(annotationData: Record<string, unknown>): typeof fetch {
  return async (input) => {
    const url = String(input);
    if (url.includes("itemType=attachment")) return response([{ key: "ATTACHMENT", data: { parentItem: "PAPER" } }]);
    if (url.includes("itemType=annotation")) {
      return response([{ key: "A1", data: { parentItem: "ATTACHMENT", ...annotationData } }]);
    }
    if (url.includes("itemType=note")) return response([]);
    return response([]);
  };
}

async function pullAnnotation(annotationData: Record<string, unknown>) {
  const result = await new ZoteroAnnotations(
    async () => ({ apiKey: "test", library: "users/1" }),
    mockFetch(annotationData),
  ).pullAll();
  return result.get("PAPER")?.[0];
}

test("pullAll retains stable annotation keys and normalizes Zotero child notes", async () => {
  const urls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("itemType=attachment")) return response([{ key: "ATTACHMENT", data: { parentItem: "PAPER" } }]);
    if (url.includes("itemType=annotation")) return response([{ key: "ANNOTATION", data: { parentItem: "ATTACHMENT", annotationText: "Highlighted", tags: [{ tag: "method" }] } }]);
    if (url.includes("itemType=note")) return response([{ key: "NOTE", data: { parentItem: "PAPER", note: "<p>Research <strong>note</strong></p>" } }]);
    return response([]);
  };
  const result = await new ZoteroAnnotations(async () => ({ apiKey: "test", library: "users/1" }), fetchFn).pullAll();
  assert.deepEqual(result.get("PAPER"), [
    { key: "ANNOTATION", kind: "annotation", text: "Highlighted", comment: undefined, color: undefined, page: undefined, tags: ["method"] },
    { key: "NOTE", kind: "note", text: "Research note", tags: [] },
  ]);
  assert.ok(urls.every((url) => url.startsWith("https://api.zotero.org/users/1/items?")));
});

test("pullAll maps annotationPageLabel onto page", async () => {
  const fetchFn: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes("itemType=attachment")) return response([{ key: "ATTACHMENT", data: { parentItem: "PAPER" } }]);
    if (url.includes("itemType=annotation")) {
      return response([
        {
          key: "A1",
          data: {
            parentItem: "ATTACHMENT",
            annotationText: "Quote",
            annotationPageLabel: "12",
          },
        },
      ]);
    }
    if (url.includes("itemType=note")) return response([]);
    return response([]);
  };
  const result = await new ZoteroAnnotations(async () => ({ apiKey: "test", library: "users/1" }), fetchFn).pullAll();
  assert.equal(result.get("PAPER")?.[0]?.page, "12");
});

test("pullAll parses well-formed annotationPosition and type/sort fields", async () => {
  const ann = await pullAnnotation({
    annotationText: "Quote",
    annotationType: "highlight",
    annotationPosition: JSON.stringify({ pageIndex: 24, rects: [[10, 20, 30, 40]] }),
    annotationSortIndex: "00008|000412|00574",
    annotationPageLabel: "xxv",
  });
  assert.equal(ann?.annotationType, "highlight");
  assert.equal(ann?.annotationSortIndex, "00008|000412|00574");
  assert.deepEqual(ann?.annotationPosition, { pageIndex: 24, rects: [[10, 20, 30, 40]] });
  // pageIndex is zero-based; page label stays a separate display string.
  assert.equal(ann?.page, "xxv");
  assert.notEqual(ann?.annotationPosition?.pageIndex, Number(ann?.page));
});

test("pullAll keeps every Zotero annotation type, including text", async () => {
  // Unknown types degrade to undefined, so omitting one from the allow-list
  // silently strips the type off a real annotation. `strikeout` is NOT a
  // Zotero type and must stay rejected — inventing it would create
  // annotations that cannot be written back.
  for (const type of ["highlight", "underline", "note", "image", "ink", "text"]) {
    const ann = await pullAnnotation({ annotationType: type, annotationText: "x" });
    assert.equal(ann?.annotationType, type, `${type} must survive the pull`);
  }
  const bogus = await pullAnnotation({ annotationType: "strikeout", annotationText: "x" });
  assert.equal(bogus?.annotationType, undefined);
});

test("pullAll keeps nextPageRects for a highlight crossing a page break", async () => {
  // pageIndex is the FIRST page; nextPageRects live on pageIndex + 1. Dropping
  // them truncates the highlight at the break.
  const ann = await pullAnnotation({
    annotationText: "Spans a page boundary",
    annotationType: "highlight",
    annotationPosition: JSON.stringify({
      pageIndex: 7,
      rects: [[10, 20, 30, 40]],
      nextPageRects: [[50, 700, 300, 720]],
    }),
  });
  assert.deepEqual(ann?.annotationPosition, {
    pageIndex: 7,
    rects: [[10, 20, 30, 40]],
    nextPageRects: [[50, 700, 300, 720]],
  });
});

test("pullAll keeps ink paths, which are not rects", async () => {
  // Ink geometry is flat [x1,y1,x2,y2,…] runs of arbitrary length, so the
  // 4-number rect rule must not be applied to it.
  const ann = await pullAnnotation({
    annotationType: "ink",
    annotationPosition: JSON.stringify({
      pageIndex: 2,
      paths: [[1, 2, 3, 4, 5, 6], [9, 10]],
    }),
  });
  // Assert the absence first: assert.deepEqual is a TS assertion signature and
  // narrows annotationPosition to the literal shape, after which `.rects` is
  // no longer a known property.
  assert.equal(ann?.annotationPosition?.rects, undefined);
  assert.deepEqual(ann?.annotationPosition, {
    pageIndex: 2,
    paths: [[1, 2, 3, 4, 5, 6], [9, 10]],
  });
});

test("pullAll drops malformed coordinate rows but keeps the page index", async () => {
  const ann = await pullAnnotation({
    annotationType: "highlight",
    annotationPosition: JSON.stringify({
      pageIndex: 3,
      rects: [[1, 2, 3], ["a", "b", "c", "d"], null],
      nextPageRects: "not-an-array",
    }),
  });
  assert.deepEqual(ann?.annotationPosition, { pageIndex: 3 });
});

test("pullAll omits annotationPosition when absent", async () => {
  const ann = await pullAnnotation({
    annotationText: "Quote",
    annotationType: "underline",
    annotationSortIndex: "00001|000001|00001",
  });
  assert.equal(ann?.annotationType, "underline");
  assert.equal(ann?.annotationSortIndex, "00001|000001|00001");
  assert.equal(ann?.annotationPosition, undefined);
  assert.ok(!("annotationPosition" in (ann ?? {})));
});

test("pullAll degrades malformed annotationPosition JSON to undefined", async () => {
  const ann = await pullAnnotation({
    annotationText: "Quote",
    annotationPosition: "{not-json",
    annotationType: "note",
  });
  assert.equal(ann?.annotationPosition, undefined);
  assert.equal(ann?.annotationType, "note");
});

test("pullAll keeps pageIndex when rects are missing", async () => {
  const ann = await pullAnnotation({
    annotationText: "Quote",
    annotationPosition: JSON.stringify({ pageIndex: 0 }),
  });
  assert.deepEqual(ann?.annotationPosition, { pageIndex: 0 });
});

test("annotation without new fields maps exactly as before", async () => {
  const ann = await pullAnnotation({
    annotationText: "Highlighted",
    tags: [{ tag: "method" }],
  });
  assert.deepEqual(ann, {
    key: "A1",
    kind: "annotation",
    text: "Highlighted",
    comment: undefined,
    color: undefined,
    page: undefined,
    tags: ["method"],
  });
});
