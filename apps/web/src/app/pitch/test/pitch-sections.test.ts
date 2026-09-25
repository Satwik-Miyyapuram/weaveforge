import { test } from "node:test";
import assert from "node:assert/strict";

import { SECTIONS } from "../sections";

/**
 * The six section ids the page's scrollspy observes.
 *
 * Pinned here as a literal on purpose: these are the ids that exist in the
 * page's markup, and the point of the test is to fail when the navigation list
 * and the document drift apart — reading the list from the navigation would
 * make the assertion vacuous.
 */
const SPY_IDS = ["overview", "chain", "experiments", "labs", "selfhost", "compare"];

test("the section list is exactly the ids the page observes", () => {
  assert.deepEqual(
    SECTIONS.map((section) => section.id),
    SPY_IDS,
  );
});

test("no section is listed twice", () => {
  assert.equal(new Set(SECTIONS.map((section) => section.id)).size, SECTIONS.length);
});

test("every section carries a label, because the nav prints it", () => {
  for (const section of SECTIONS) {
    assert.ok(section.label.trim(), `${section.id} has no label`);
  }
});
