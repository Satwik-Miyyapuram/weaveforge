import { before, test } from "node:test";
import assert from "node:assert/strict";
import { typedCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

const items = [
  { str: "top line", transform: [10, 0, 0, 10, 50, 700], width: 40, height: 10, hasEOL: true },
  { str: "bottom line", transform: [10, 0, 0, 10, 50, 100], width: 55, height: 10 },
];

test("a match on the second of four pages lands in the second quarter", () => {
  const marks = typedCore().findMarks(
    [{ pageIndex: 1, start: 9, end: 15 }],
    4,
    [{ pageIndex: 1, items, height: 800 }],
  );
  assert.equal(marks.length, 1);
  const f = marks[0]!.fraction;
  assert.ok(f > 0.25 && f < 0.5, `fraction ${f}`);
  // "bottom line" sits at y=100 of 800 — near the foot of the page.
  assert.ok(f > 0.25 + 0.8 / 4, `fraction ${f}`);
});

test("without page text the mark sits at the top of its page", () => {
  const marks = typedCore().findMarks([{ pageIndex: 2, start: 0, end: 3 }], 4, [{ pageIndex: 2, height: 800 }]);
  assert.equal(marks[0]!.fraction, 0.5);
});

test("no pages gives no marks", () => {
  assert.deepEqual(typedCore().findMarks([{ pageIndex: 0, start: 0, end: 1 }], 0, [{ pageIndex: 0, items, height: 800 }]), []);
});
