import test from "node:test";
import assert from "node:assert/strict";
import { fetchSemanticScholar, semanticScholarUrl } from "../semantic-scholar-fetch";

/**
 * The shared Semantic Scholar policy: a 429 is retried, a thrown TypeError on
 * the relay path is retried the same way outside the desktop, and when it never
 * clears the caller sees the original error rather than a made-up status.
 *
 * Every call goes through the relay on both hosts now — the page used to call
 * the API directly, where a 429 carries no CORS header and arrived as a bare
 * TypeError with no status to read.
 */

const RELAY = "/api/semantic-scholar/graph/v1/paper/x";
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

test("every host addresses the relay, so a 429 arrives as a status", () => {
  assert.equal(semanticScholarUrl("graph/v1/paper/x"), RELAY);
  assert.equal(semanticScholarUrl("/graph/v1"), "/api/semantic-scholar/graph/v1");
  assert.doesNotMatch(semanticScholarUrl("graph/v1/paper/x"), /^https?:\/\//);
});

test("a 429 is retried until it clears", async () => {
  const { fetchFn, count } = answering([429, 200]);
  const res = await fetchSemanticScholar(fetchFn, RELAY, undefined, noWait);
  assert.equal(res.status, 200);
  assert.equal(count(), 2);
});

test("a thrown TypeError on the relay path is retried like a 429", async () => {
  const { fetchFn, count } = answering(["throw", "throw", 200]);
  const res = await fetchSemanticScholar(fetchFn, RELAY, undefined, noWait);
  assert.equal(res.status, 200);
  assert.equal(count(), 3);
});

test("a TypeError that never clears is rethrown as itself", async () => {
  const { fetchFn, count } = answering(["throw"]);
  await assert.rejects(
    () => fetchSemanticScholar(fetchFn, RELAY, undefined, noWait),
    (error: unknown) => error instanceof TypeError && error.message === "Failed to fetch",
  );
  assert.equal(count(), 4);
});

test("a TypeError off the relay path is not retried", async () => {
  const { fetchFn, count } = answering(["throw"]);
  await assert.rejects(() => fetchSemanticScholar(fetchFn, "/api/pdf-proxy?url=x", undefined, noWait));
  assert.equal(count(), 1);
});
