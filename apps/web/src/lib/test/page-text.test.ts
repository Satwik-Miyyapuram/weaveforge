/**
 * `isHydratedPage` has to tell a `listSummaries` row from a `getById` page.
 * The rows come with `body: ""` beside their preview, so the test cannot be
 * "has a body" — that is the bug that left every workspace tab on its
 * 320-character preview.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isHydratedPage, noteBodyText } from "../page-text";

const base = { id: "p1", title: "t", sortOrder: 0, createdAt: "", updatedAt: "" };

test("a summary row with an empty body and a preview is not hydrated", () => {
  const summary = { ...base, body: "", bodyPreview: "the head of the note" };
  assert.equal(isHydratedPage(summary), false);
  assert.equal(noteBodyText(summary), "the head of the note");
});

test("a full page is hydrated, even when its body is empty", () => {
  assert.equal(isHydratedPage({ ...base, body: "full text" }), true);
  assert.equal(isHydratedPage({ ...base, body: "" }), true);
  assert.equal(isHydratedPage({ ...base, body: "full", bodyPreview: "" }), true);
});

test("a bare summary without a body field is not hydrated", () => {
  assert.equal(isHydratedPage({ ...base, bodyPreview: "x" }), false);
  assert.equal(isHydratedPage({ ...base }), false);
});
