import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

// Literal cases for the Rust reader functions whose TS-vs-Rust parity tests were removed with the
// TS originals. Every input and expected value is copied from the Rust #[test]s in
// crates/wf-core/src/reader/zotero_sync.rs and crates/wf-core/src/reader_analysis/document_analysis.rs.

before(async () => {
  await loadTestCore();
});

const ANCHOR = { zoteroPosition: { pageIndex: 0, rects: [[1, 2, 3, 4]] } };

// base_local() in zotero_sync.rs
const BASE_LOCAL = {
  id: "local-1",
  origin: "local",
  zoteroKey: null,
  type: "highlight",
  color: "#ffd400",
  text: "hello",
  comment: "",
  tags: [],
  anchor: ANCHOR,
  sortIndex: "00000|000000|00000",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// remote_of(&base_local()) in zotero_sync.rs
const REMOTE_OF_BASE = {
  key: "K",
  version: 2,
  type: "highlight",
  color: "#ffd400",
  text: "hello",
  comment: "",
  tags: [],
  anchor: ANCHOR,
  sortIndex: "00000|000000|00000",
  updatedAt: "2026-01-04T00:00:00.000Z",
};

test("isZoteroLibrarySyncMode: library_sync_mode_guard", () => {
  const rs = readyCore();
  assert.equal(rs.isZoteroLibrarySyncMode("bidirectional"), true);
  assert.equal(rs.isZoteroLibrarySyncMode("write"), false);
});

test("decideAnnotationSync: decide_pushes_local_only_in_bidirectional", () => {
  const rs = readyCore();
  const row = { local: { ...BASE_LOCAL, syncState: "local" }, remote: null };
  assert.equal(rs.decideAnnotationSync(row, "bidirectional").kind, "push");
});

test("decideAnnotationSync: decide_skips_push_in_read_only_and_ignored", () => {
  const rs = readyCore();
  const row = { local: { ...BASE_LOCAL, syncState: "local" }, remote: null };
  assert.equal(rs.decideAnnotationSync(row, "read_only").kind, "skip");
  assert.equal(rs.decideAnnotationSync(row, "ignored").kind, "skip");
});

test("decideAnnotationSync: decide_conflicts_when_same_version_diverges", () => {
  const rs = readyCore();
  const row = {
    local: {
      ...BASE_LOCAL,
      color: "#ff6666",
      zoteroKey: "ABCD",
      syncState: "pending",
      zoteroVersion: 3,
    },
    remote: { ...REMOTE_OF_BASE, version: 3, color: "#ffd400" },
  };
  const decision = rs.decideAnnotationSync(row, "bidirectional");
  assert.equal(decision.kind, "conflict");
  assert.ok(decision.fields.some((f: { field: string }) => f.field === "color"));
});

test("diffAnnotationFields: key_order_alone_is_not_a_conflict (identical rows)", () => {
  const rs = readyCore();
  const row = { local: { ...BASE_LOCAL, zoteroKey: "K" }, remote: { ...REMOTE_OF_BASE } };
  assert.equal(rs.diffAnnotationFields(row).length, 0);
});

test("diffAnnotationFields: key_order_alone_is_not_a_conflict (flipped anchor)", () => {
  const rs = readyCore();
  const row = {
    local: { ...BASE_LOCAL, zoteroKey: "K" },
    remote: {
      ...REMOTE_OF_BASE,
      anchor: { zoteroPosition: { pageIndex: 0, rects: [[4, 3, 2, 1]] } },
    },
  };
  const fields = rs.diffAnnotationFields(row).map((f: { field: string }) => f.field);
  assert.deepEqual(fields, ["anchor"]);
});

test("diffAnnotationFields: diff_and_resolve_conflict (colour, comment and tags differ)", () => {
  const rs = readyCore();
  const row = {
    local: { ...BASE_LOCAL, comment: "mine", zoteroKey: "K", syncState: "conflict", zoteroVersion: 1 },
    remote: {
      ...REMOTE_OF_BASE,
      version: 2,
      color: "#ff6666",
      comment: "theirs",
      tags: ["a"],
    },
  };
  assert.ok(rs.diffAnnotationFields(row).length >= 2);
});

const CONFLICT_ROW = {
  local: { ...BASE_LOCAL, comment: "mine", zoteroKey: "K", syncState: "conflict", zoteroVersion: 1 },
  remote: {
    ...REMOTE_OF_BASE,
    version: 2,
    color: "#ff6666",
    comment: "theirs",
    tags: ["a"],
  },
};

test("resolveAnnotationConflict: keep_local keeps the local comment", () => {
  const rs = readyCore();
  assert.equal(rs.resolveAnnotationConflict(CONFLICT_ROW, "keep_local").comment, "mine");
});

test("resolveAnnotationConflict: accept_remote takes the remote colour and comment", () => {
  const rs = readyCore();
  const accepted = rs.resolveAnnotationConflict(CONFLICT_ROW, "accept_remote");
  assert.equal(accepted.color, "#ff6666");
  assert.equal(accepted.comment, "theirs");
});

test("resolveAnnotationConflict: merge takes the remote colour and keeps the local comment", () => {
  const rs = readyCore();
  const merged = rs.resolveAnnotationConflict(CONFLICT_ROW, "merge");
  assert.equal(merged.color, "#ff6666");
  assert.equal(merged.comment, "mine");
});

test("toZoteroWritePayload: payload_has_parent_and_empty_tags", () => {
  const rs = readyCore();
  const payload = rs.toZoteroWritePayload(BASE_LOCAL, "PARENT");
  assert.equal(payload.parentItem, "PARENT");
  assert.equal(payload.tags.length, 0);
  assert.equal(payload.annotationPosition, '{"pageIndex":0,"rects":[[1,2,3,4]]}');
});

test("toZoteroWritePayload: write_back_sends_marks_and_never_strokes (underline)", () => {
  const rs = readyCore();
  const payload = rs.toZoteroWritePayload({ ...BASE_LOCAL, id: "ul", type: "underline" }, "PARENT");
  assert.equal(payload.annotationType, "underline");
});

test("zoteroWriteBackAnnotations: write_back_sends_marks_and_never_strokes", () => {
  const rs = readyCore();
  const hl = { ...BASE_LOCAL, id: "hl" };
  const ul = { ...BASE_LOCAL, id: "ul", type: "underline" };
  const note = { ...BASE_LOCAL, id: "note", type: "note" };
  const stroke = {
    ...BASE_LOCAL,
    id: "stroke",
    type: "ink",
    anchor: { zoteroPosition: { pageIndex: 0, paths: [[1, 2, 3, 4]], width: 2 } },
  };
  assert.deepEqual(rs.zoteroWriteBackAnnotations([hl, ul, note, stroke]), [0, 1, 2]);
});

test("analyzePdfDocument: no_pages_gives_the_empty_analysis", () => {
  const rs = readyCore();
  assert.equal(rs.analyzePdfDocument([], []).pages.length, 0);
});

test("analyzePdfDocument: single_page_reports_text_and_one_column", () => {
  const rs = readyCore();
  const pages = [
    {
      pageNumber: 1,
      items: [
        { str: "Hello world", transform: [10, 0, 0, 10, 72, 700], width: 50, height: 10, hasEOL: true },
        { str: "Second line", transform: [10, 0, 0, 10, 72, 686], width: 50, height: 10, hasEOL: false },
      ],
    },
  ];
  const result = rs.analyzePdfDocument(pages, []);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].text, "Hello world\nSecond line");
  assert.equal(result.pages[0].columns, 1);
});

test("analyzePdfDocument: given_outline_wins_over_headings", () => {
  const rs = readyCore();
  const pages = [
    {
      pageNumber: 1,
      items: [{ str: "Body", transform: [10, 0, 0, 10, 72, 700], width: 50, height: 10, hasEOL: false }],
    },
  ];
  const outline = [{ title: "Intro", pageNumber: 1 }];
  const result = rs.analyzePdfDocument(pages, outline);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].title, "Intro");
});
