import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendActivityLog,
  collectAnnotationImageRegions,
  planSourceNoteBatch,
} from "../application/batch-annotation-ops.js";
import type { ReaderAnnotation } from "@weaveforge/core";

function ann(partial: Partial<ReaderAnnotation> & Pick<ReaderAnnotation, "id" | "type">): ReaderAnnotation {
  return {
    origin: "local",
    zoteroKey: null,
    color: "#aaaaaa",
    text: "",
    comment: "",
    tags: [],
    anchor: {},
    sortIndex: "00000|000000|00000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("collectAnnotationImageRegions extracts rects only from image anns", () => {
  const regions = collectAnnotationImageRegions([
    ann({
      id: "i1",
      type: "image",
      anchor: { zoteroPosition: { pageIndex: 2, rects: [[1, 2, 3, 4], [5, 6, 7, 8]] } },
    }),
    ann({ id: "h1", type: "highlight", anchor: { zoteroPosition: { pageIndex: 0, rects: [[0, 0, 1, 1]] } } }),
  ]);
  assert.equal(regions.length, 2);
  assert.equal(regions[0]!.pageIndex, 2);
  assert.deepEqual(regions[1]!.rect, [5, 6, 7, 8]);
});

test("planSourceNoteBatch missing vs all", () => {
  const papers = [
    { id: "1", title: "A", hasSourceNote: false },
    { id: "2", title: "B", hasSourceNote: true },
  ];
  assert.deepEqual(planSourceNoteBatch(papers, "missing"), [
    { paperId: "1", title: "A", action: "create" },
  ]);
  assert.equal(planSourceNoteBatch(papers, "all").length, 2);
  assert.equal(planSourceNoteBatch(papers, "all")[1]!.action, "rerender");
});

test("appendActivityLog prepends and caps", () => {
  let log = appendActivityLog([], { kind: "sync", message: "one" });
  log = appendActivityLog(log, { kind: "batch", message: "two" }, 2);
  log = appendActivityLog(log, { kind: "batch", message: "three" }, 2);
  assert.equal(log.length, 2);
  assert.equal(log[0]!.message, "three");
  assert.equal(log[1]!.message, "two");
});
