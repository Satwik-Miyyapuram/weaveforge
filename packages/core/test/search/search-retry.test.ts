import { test } from "node:test";
import assert from "node:assert/strict";
import { planFuzzyRetry } from "../../src/search/search-retry.js";
import { fuzzinessForTerm } from "../../src/search/search-tuning.js";

test("retry: a query with results is never retried", () => {
  // The whole design rests on this: fuzziness is only loosened for queries
  // that already found nothing, so a working query cannot be made worse.
  assert.equal(planFuzzyRetry({ resultCount: 1, termCount: 1 }).retry, false);
  assert.equal(planFuzzyRetry({ resultCount: 50, termCount: 3 }).retry, false);
});

test("retry: an empty result on a short query is retried", () => {
  assert.equal(planFuzzyRetry({ resultCount: 0, termCount: 1 }).retry, true);
  assert.equal(planFuzzyRetry({ resultCount: 0, termCount: 4 }).retry, true);
});

test("retry: a long query that found nothing is left alone", () => {
  // Loosening every term of a five-word query returns a pile of weakly
  // related documents rather than the one thing that was meant.
  assert.equal(planFuzzyRetry({ resultCount: 0, termCount: 5 }).retry, false);
});

test("retry: an empty query is not retried", () => {
  assert.equal(planFuzzyRetry({ resultCount: 0, termCount: 0 }).retry, false);
});

test("retry: the escalation is exactly one more edit", () => {
  // One edit is what a transposition costs beyond what Levenshtein allows —
  // "nerual" is two edits from "neural", and a six-letter term is allowed one.
  const plan = planFuzzyRetry({ resultCount: 0, termCount: 1 });
  for (const term of ["neural", "attention", "diffusion", "variational"]) {
    const firstPass = Math.round(fuzzinessForTerm(term) * term.length);
    assert.equal(
      plan.fuzzinessFor(term),
      firstPass + 1,
      `${term}: expected one edit beyond the first pass`,
    );
  }
});

test("retry: a six-letter term can reach its own transposition", () => {
  // The specific failure: "nerual" for "neural".
  const plan = planFuzzyRetry({ resultCount: 0, termCount: 1 });
  assert.ok(
    plan.fuzzinessFor("nerual") >= 2,
    "a swap is two Levenshtein edits, so the retry must allow at least two",
  );
});

test("retry: very short terms stay exact even on a retry", () => {
  // At three characters an extra edit matches much of the dictionary.
  const plan = planFuzzyRetry({ resultCount: 0, termCount: 1 });
  assert.equal(plan.fuzzinessFor("gan"), 0);
  assert.equal(plan.fuzzinessFor("vae"), 0);
});

test("retry: a plan that is not retrying loosens nothing", () => {
  const plan = planFuzzyRetry({ resultCount: 3, termCount: 1 });
  assert.equal(plan.fuzzinessFor("neural"), 0);
});
