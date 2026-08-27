/**
 * Screening, agreement and the PRISMA counts.
 *
 * The counts are the thing worth testing hardest: they are what a methods
 * section reports, and a count that is wrong is wrong in a way a reader cannot
 * see. Every case below is one a real screen produces -- a lone reviewer, two
 * who disagree, an abstract nobody has looked at yet.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ScreeningError,
  agreementBetween,
  checkDecision,
  exclusionReasons,
  prismaCounts,
  verdictFor,
  type ScreeningDecision,
  type ScreeningStage,
  type ScreeningState,
} from "../../../src/features/reading-lists/domain/screening.js";

let serial = 0;

function decide(
  itemId: string,
  reviewerId: string,
  stage: ScreeningStage,
  state: ScreeningState,
  reason?: string,
): ScreeningDecision {
  serial += 1;
  return {
    id: `d${serial}`,
    itemId,
    reviewerId,
    stage,
    state,
    reason,
    // Ordered by construction, so "the latest one" is the last one written.
    decidedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, serial)).toISOString(),
  };
}

const items = (...ids: string[]) => ids.map((id) => ({ id }));

test("one reviewer's answer is the verdict, because most reviews are one person", () => {
  const verdict = verdictFor([decide("a", "ana", "title_abstract", "included")], "a", "title_abstract");
  assert.equal(verdict.state, "included");
  assert.equal(verdict.conflict, false);
  assert.equal(verdict.answered, 1);
});

test("two who disagree have no verdict at all, rather than the first one's", () => {
  const verdict = verdictFor(
    [decide("a", "ana", "title_abstract", "included"), decide("a", "bo", "title_abstract", "excluded")],
    "a",
    "title_abstract",
  );
  assert.equal(verdict.state, null);
  assert.equal(verdict.conflict, true);
});

test("a reviewer who changes their mind is counted once, at the newer answer", () => {
  const verdict = verdictFor(
    [decide("a", "ana", "title_abstract", "excluded"), decide("a", "ana", "title_abstract", "included")],
    "a",
    "title_abstract",
  );
  assert.equal(verdict.state, "included");
  assert.equal(verdict.answered, 1);
});

test("the full text is not screened before the abstract", () => {
  assert.throws(
    () => checkDecision({ itemId: "a", reviewerId: "ana", stage: "full_text", state: "included" }, []),
    ScreeningError,
  );
});

test("a reviewer cannot full-text screen what they already excluded", () => {
  assert.throws(
    () =>
      checkDecision({ itemId: "a", reviewerId: "ana", stage: "full_text", state: "included" }, [
        decide("a", "ana", "title_abstract", "excluded"),
      ]),
    /Revise that decision/,
  );
});

test("someone else's exclusion does not block your full-text screen", () => {
  assert.doesNotThrow(() =>
    checkDecision({ itemId: "a", reviewerId: "ana", stage: "full_text", state: "included" }, [
      decide("a", "ana", "title_abstract", "included"),
      decide("a", "bo", "title_abstract", "excluded"),
    ]),
  );
});

test("agreement past chance is what a methods section reports", () => {
  // Two reviewers, four papers, agreeing on three. Percent agreement flatters
  // this; kappa does not, which is the whole reason for computing it.
  const decisions = [
    decide("a", "ana", "title_abstract", "included"),
    decide("a", "bo", "title_abstract", "included"),
    decide("b", "ana", "title_abstract", "excluded"),
    decide("b", "bo", "title_abstract", "excluded"),
    decide("c", "ana", "title_abstract", "excluded"),
    decide("c", "bo", "title_abstract", "excluded"),
    decide("d", "ana", "title_abstract", "included"),
    decide("d", "bo", "title_abstract", "excluded"),
  ];
  const agreement = agreementBetween(decisions, ["ana", "bo"], "title_abstract");
  assert.equal(agreement.compared, 4);
  assert.equal(agreement.agreed, 3);
  assert.equal(agreement.proportion, 0.75);
  // observed 0.75, expected (2/4 * 1/4) + (2/4 * 3/4) = 0.5 -> kappa 0.5
  assert.equal(agreement.kappa, 0.5);
});

test("total agreement on one answer reports no kappa rather than zero", () => {
  const agreement = agreementBetween(
    [
      decide("a", "ana", "title_abstract", "included"),
      decide("a", "bo", "title_abstract", "included"),
    ],
    ["ana", "bo"],
    "title_abstract",
  );
  assert.equal(agreement.proportion, 1);
  assert.equal(agreement.kappa, null);
});

test("reviewers who screened nothing in common are compared on nothing", () => {
  const agreement = agreementBetween(
    [decide("a", "ana", "title_abstract", "included"), decide("b", "bo", "title_abstract", "included")],
    ["ana", "bo"],
    "title_abstract",
  );
  assert.deepEqual([agreement.compared, agreement.proportion, agreement.kappa], [0, null, null]);
});

test("the PRISMA counts add up, from identified down to included", () => {
  const decisions = [
    // a: excluded on the abstract.
    decide("a", "ana", "title_abstract", "excluded", "Wrong population"),
    // b: through to the full text, and included.
    decide("b", "ana", "title_abstract", "included"),
    decide("b", "ana", "full_text", "included"),
    // c: through to the full text, and excluded with a reason.
    decide("c", "ana", "title_abstract", "included"),
    decide("c", "ana", "full_text", "excluded", "No control arm"),
    // d: unsure on the abstract, so it is assessed and still waiting.
    decide("d", "ana", "title_abstract", "unsure"),
    // e: nobody has looked at it.
  ];
  const counts = prismaCounts(
    [...items("a", "b", "c", "d", "e"), { id: "f", duplicateOfItemId: "b" }],
    decisions,
  );

  assert.equal(counts.identified, 6);
  assert.equal(counts.duplicates, 1);
  assert.equal(counts.screened, 5);
  assert.equal(counts.excludedAtScreening, 1);
  assert.equal(counts.eligible, 3);
  assert.equal(counts.excludedAtFullText, 1);
  assert.equal(counts.included, 1);
  // `d` awaits a full text and `e` awaits an abstract.
  assert.equal(counts.undecided, 2);
  assert.equal(counts.screened, counts.excludedAtScreening + counts.eligible + 1);
});

test("a disagreement is counted and carried on to the full text, not dropped", () => {
  const counts = prismaCounts(items("a"), [
    decide("a", "ana", "title_abstract", "included"),
    decide("a", "bo", "title_abstract", "excluded"),
  ]);
  assert.equal(counts.conflicts, 1);
  assert.equal(counts.eligible, 1);
  assert.equal(counts.excludedAtScreening, 0);
});

test("exclusion reasons count papers, not reviewers", () => {
  const reasons = exclusionReasons([
    decide("a", "ana", "full_text", "excluded", "No control arm"),
    decide("a", "bo", "full_text", "excluded", "No control arm"),
    decide("b", "ana", "full_text", "excluded", "Not English"),
    decide("c", "ana", "full_text", "included"),
  ]);
  assert.deepEqual(reasons, [
    { reason: "No control arm", count: 1 },
    { reason: "Not English", count: 1 },
  ]);
});
