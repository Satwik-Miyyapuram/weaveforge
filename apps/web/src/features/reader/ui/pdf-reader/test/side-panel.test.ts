/**
 * The side column takes width from the page, so it must not appear after the
 * first paint: the fit-width zoom would change and the page would jump. The
 * outline and the reference list arrive after the document, so they do not
 * decide it; every tab has its own empty state.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { hasSidePanel } from "../side-panel";

test("no side column before the document loads", () => {
  assert.equal(hasSidePanel({ numPages: 0, annotations: 0, canCreate: false }), false);
});

test("a loaded document has the side column before its outline or references arrive", () => {
  assert.equal(hasSidePanel({ numPages: 15, annotations: 0, canCreate: false }), true);
});

test("a paper that takes annotations has the side column from the start", () => {
  assert.equal(hasSidePanel({ numPages: 0, annotations: 0, canCreate: true }), true);
});

test("saved annotations keep the side column", () => {
  assert.equal(hasSidePanel({ numPages: 0, annotations: 2, canCreate: false }), true);
});
