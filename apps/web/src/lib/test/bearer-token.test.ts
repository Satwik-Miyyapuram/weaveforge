import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerToken } from "@/lib/bearer-token";

test("bearerToken: strips the prefix whatever its case", () => {
  assert.equal(bearerToken(new Request("http://x", { headers: { authorization: "Bearer abc123" } })), "abc123");
  assert.equal(bearerToken(new Request("http://x", { headers: { authorization: "bearer tt_abc" } })), "tt_abc");
  assert.equal(bearerToken(new Request("http://x", { headers: { authorization: "BEARER tt_abc" } })), "tt_abc");
});

test("bearerToken: null when no Authorization header", () => {
  assert.equal(bearerToken(new Request("http://x")), null);
});
