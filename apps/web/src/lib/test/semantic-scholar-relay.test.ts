import test from "node:test";
import assert from "node:assert/strict";
import { forwardedHeaders, semanticScholarTarget } from "../semantic-scholar-relay";

/**
 * The relay policy both hosts share: the web route and the desktop shell map
 * a path onto the API host and nowhere else, and forward two headers only.
 */

test("a path and its query map onto the API host", () => {
  assert.equal(
    semanticScholarTarget("/api/semantic-scholar/graph/v1/paper/x", "?fields=title"),
    "https://api.semanticscholar.org/graph/v1/paper/x?fields=title",
  );
});

test("an empty, traversing or smuggled path has no target", () => {
  for (const path of [
    "/api/semantic-scholar/",
    "/api/semantic-scholar/../etc",
    "/api/semantic-scholar/graph/..",
    "/api/semantic-scholar//evil.example/x",
    "/api/semantic-scholar/https://evil.example/x",
    "/api/semantic-scholar/HTTP://evil.example/x",
    "/api/other/graph/v1/paper/x",
  ]) {
    assert.equal(semanticScholarTarget(path, ""), null, path);
  }
});

test("only the key and the content type are forwarded", () => {
  const headers = new Headers({
    "x-api-key": "k",
    "content-type": "application/json",
    cookie: "session=1",
    authorization: "Bearer t",
    referer: "https://app/",
  });
  assert.deepEqual(forwardedHeaders(headers), {
    accept: "application/json",
    "x-api-key": "k",
    "content-type": "application/json",
  });
  assert.deepEqual(forwardedHeaders(new Headers()), { accept: "application/json" });
});
