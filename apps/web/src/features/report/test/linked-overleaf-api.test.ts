/**
 * Non-ok responses from the Overleaf relay carry the status and body (#698).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { overleafRequestError } from "../ui/linked-overleaf-api";

test("a 502 error names the status and the response body", () => {
  const err = overleafRequestError(502, undefined, "upstream down");
  assert.equal(err.message, "Overleaf request failed (HTTP 502): upstream down");
});

test("the relay's own error wins over the raw body", () => {
  const err = overleafRequestError(400, "Overleaf token expired", '{"error":"Overleaf token expired"}');
  assert.equal(err.message, "Overleaf request failed (HTTP 400): Overleaf token expired");
});

test("an empty body still names the status, and a long one is cut to 300 characters", () => {
  assert.equal(overleafRequestError(504, undefined, "").message, "Overleaf request failed (HTTP 504).");
  const long = overleafRequestError(500, undefined, "x".repeat(1000)).message;
  assert.equal(long, `Overleaf request failed (HTTP 500): ${"x".repeat(300)}`);
});
