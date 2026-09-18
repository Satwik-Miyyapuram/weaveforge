import test from "node:test";
import assert from "node:assert/strict";
import { fetchSemanticScholar, semanticScholarUrl } from "../semantic-scholar-fetch";

/**
 * The shared Semantic Scholar policy: a 429 is retried, a CORS-masked 429
 * (a thrown TypeError in a page) is retried the same way, and when it never
 * clears the caller sees the original error rather than a made-up status.
 * With no desktop bridge on the window, addresses go to the API directly.
 */

const API = "https://api.semanticscholar.org/graph/v1/paper/x";
const noWait = () => Promise.resolve();

function answering(outcomes: (number | "throw")[]) {
  let calls = 0;
  const fetchFn = (() => {
    const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
    calls += 1;
    if (outcome === "throw") return Promise.reject(new TypeError("Failed to fetch"));
    return Promise.resolve(new Response("{}", { status: outcome }));
  }) as unknown as typeof fetch;
  return { fetchFn, count: () => calls };
}

test("outside the desktop the address is the API itself", () => {
  assert.equal(semanticScholarUrl("graph/v1/paper/x"), API);
  assert.equal(semanticScholarUrl("/graph/v1"), "https://api.semanticscholar.org/graph/v1");
});

test("a 429 is retried until it clears", async () => {
  const { fetchFn, count } = answering([429, 200]);
  const res = await fetchSemanticScholar(fetchFn, API, undefined, noWait);
  assert.equal(res.status, 200);
  assert.equal(count(), 2);
});

test("a thrown TypeError on the API host is retried like a 429", async () => {
  const { fetchFn, count } = answering(["throw", "throw", 200]);
  const res = await fetchSemanticScholar(fetchFn, API, undefined, noWait);
  assert.equal(res.status, 200);
  assert.equal(count(), 3);
});

test("a TypeError that never clears is rethrown as itself", async () => {
  const { fetchFn, count } = answering(["throw"]);
  await assert.rejects(
    () => fetchSemanticScholar(fetchFn, API, undefined, noWait),
    (error: unknown) => error instanceof TypeError && error.message === "Failed to fetch",
  );
  assert.equal(count(), 4);
});

test("a TypeError off the API host is not retried", async () => {
  const { fetchFn, count } = answering(["throw"]);
  await assert.rejects(() => fetchSemanticScholar(fetchFn, "/api/semantic-scholar/graph/v1/paper/x", undefined, noWait));
  assert.equal(count(), 1);
});
