import { test } from "node:test";
import assert from "node:assert/strict";

import { exportBaseName } from "../ui/export-name";

const ID = "3f2a9c1e-7b4d-4e2a-9f10-5c6d7e8f9a0b";

test("an export is named by the note's title", () => {
  assert.equal(exportBaseName("Lecture 3 notes", ID), "Lecture 3 notes");
});

test("characters no file system allows become dashes", () => {
  assert.equal(exportBaseName('a/b\\c:d*e?f"g<h>i|j', ID), "a-b-c-d-e-f-g-h-i-j");
  assert.equal(exportBaseName("tab\there\u0000x", ID), "tab-here-x");
});

test("Windows-unsafe ends are trimmed and long titles are cut", () => {
  assert.equal(exportBaseName("  draft. . ", ID), "draft");
  assert.equal(exportBaseName("x".repeat(300), ID).length, 120);
});

test("a title is kept in any script", () => {
  assert.equal(exportBaseName("Été — 数学", ID), "Été — 数学");
});

test("no usable title falls back to the note's id", () => {
  assert.equal(exportBaseName(undefined, ID), ID);
  assert.equal(exportBaseName("", ID), ID);
  assert.equal(exportBaseName("  ", ID), ID);
  assert.equal(exportBaseName("...", ID), ID);
  assert.equal(exportBaseName("///", ID), ID);
});
