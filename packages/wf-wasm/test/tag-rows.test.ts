import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initSync } from "../src/index.js";
import { paperTagFromRow, tagFromRow } from "../src/tag-rows.js";
import type { PaperTagRowInput, TagRowInput } from "../src/tag-rows.js";

const pkgDir = new URL("../pkg/", import.meta.url);
initSync({ module: readFileSync(new URL("wf_wasm_bg.wasm", pkgDir)) });

test("a tag row keeps its colour when set", () => {
  const row: TagRowInput = { id: "t1", name: "method", color: "#00ff00" };
  assert.deepEqual(tagFromRow(row), { id: "t1", name: "method", color: "#00ff00" });
});

test("a null tag colour is left out, so the tag has no colour key", () => {
  const tag = tagFromRow({ id: "t1", name: "method", color: null });
  assert.equal("color" in tag, false);
  assert.equal(tag.name, "method");
});

test("a paper-tag row maps to camelCase with its source", () => {
  const row: PaperTagRowInput = {
    paper_id: "p1",
    tag_id: "t1",
    source: "manual",
    annotation_ref: null,
  };
  assert.deepEqual(paperTagFromRow(row), {
    paperId: "p1",
    tagId: "t1",
    source: "manual",
  });
});

test("a paper-tag annotation ref is kept when set", () => {
  const link = paperTagFromRow({
    paper_id: "p1",
    tag_id: "t1",
    source: "zotero_annotation",
    annotation_ref: "ann-9",
  });
  assert.equal(link.annotationRef, "ann-9");
});
