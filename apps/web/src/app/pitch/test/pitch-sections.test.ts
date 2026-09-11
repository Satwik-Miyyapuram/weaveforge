import { test } from "node:test";
import assert from "node:assert/strict";

import { SECTIONS } from "../sections";

/**
 * The nine section ids the page's scrollspy observes.
 *
 * Pinned here as a literal on purpose: these are the ids that exist in the
 * page's markup, and the point of the test is to fail when the navigation list
 * and the document drift apart — reading the list from the navigation would
 * make the assertion vacuous.
 */
const SPY_IDS = [
  "overview",
  "why",
  "chain",
  "reading",
  "experiments",
  "writing",
  "labs",
  "selfhost",
  "compare",
];

test("the section list is exactly the ids the page observes", () => {
  assert.deepEqual(
    SECTIONS.map((section) => section.id),
    SPY_IDS,
  );
});

test("both navs render one list, so they cannot disagree about the order", () => {
  // The desktop bar and the small-screen sheet map over the same array. This
  // asserts there is one list at all — a second hand-written set of links is
  // what the small-screen control was added to avoid.
  assert.equal(new Set(SECTIONS.map((section) => section.id)).size, SECTIONS.length);
});

test("every section carries a label, because both navs print it", () => {
  for (const section of SECTIONS) {
    assert.ok(section.label.trim(), `${section.id} has no label`);
  }
});

test("the bar only sheds entries that stay reachable elsewhere", () => {
  // `low` hides a link below the header's measure. The rule the page's own
  // comment states is that a shed entry is still reachable from the prose — so
  // the set is deliberately small, and this pins how small.
  const shed = SECTIONS.filter((section) => section.low).map((section) => section.id);
  assert.deepEqual(shed, ["why", "writing", "labs"]);
});

test("dividers only appear where the bar means them to", () => {
  const withSep = SECTIONS.filter((section) => section.sep);
  assert.deepEqual(
    withSep.map((section) => [section.id, section.sep]),
    [
      ["why", "low"],
      ["writing", "low"],
      ["labs", "plain"],
    ],
  );
  // A divider after the last entry would draw a rule against the actions.
  assert.equal(SECTIONS[SECTIONS.length - 1]!.sep, undefined);
});
