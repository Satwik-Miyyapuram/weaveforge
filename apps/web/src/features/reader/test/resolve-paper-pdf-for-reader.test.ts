import { test } from "node:test";
import assert from "node:assert/strict";
import { isCachePdfUrl } from "../application/resolve-paper-pdf-for-reader.js";

test("isCachePdfUrl recognises the ladder cache scheme", () => {
  assert.equal(isCachePdfUrl("cache://paper-1"), true);
  assert.equal(isCachePdfUrl("https://example.com/a.pdf"), false);
  assert.equal(isCachePdfUrl("/api/pdf-proxy?u=x"), false);
});
