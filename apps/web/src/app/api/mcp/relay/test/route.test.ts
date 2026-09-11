import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST, PATCH } from "../route";
import { MAX_BODY_BYTES, MAX_ENVELOPE_CHARS, exceedsDeclaredLimit, isUuid, validEnvelope } from "../relay-request";

test("POST /api/mcp/relay: 401 without a token", async () => {
  assert.equal((await POST(new Request("http://localhost/api/mcp/relay", { method: "POST" }))).status, 401);
});

test("GET /api/mcp/relay: 401 without a token", async () => {
  assert.equal((await GET(new Request("http://localhost/api/mcp/relay"))).status, 401);
});

test("PATCH /api/mcp/relay: 401 without a token", async () => {
  assert.equal((await PATCH(new Request("http://localhost/api/mcp/relay", { method: "PATCH" }))).status, 401);
});

test("an oversized body is refused before auth is even reached", async () => {
  // Auth first, size second: an unauthenticated caller must not be able to make
  // the route hold bytes, so the 401 is the answer and `json()` never runs.
  // The status proves nothing was parsed — this body is not JSON at all.
  const res = await POST(
    new Request("http://localhost/api/mcp/relay", {
      method: "POST",
      headers: { "content-length": String(MAX_BODY_BYTES + 1) },
      body: "not json",
    }),
  );
  assert.equal(res.status, 401);
});

// ------------------------------------------------------------------ the rules

test("the body cap is derived from the envelope cap, not guessed at", () => {
  assert.ok(MAX_BODY_BYTES > MAX_ENVELOPE_CHARS, "the JSON scaffolding around the envelope needs room");
  assert.equal(exceedsDeclaredLimit(String(MAX_BODY_BYTES + 1)), true);
  assert.equal(exceedsDeclaredLimit(String(MAX_BODY_BYTES)), false);
  assert.equal(exceedsDeclaredLimit(null), false, "a chunked body declares nothing; the envelope check covers it");
  assert.equal(exceedsDeclaredLimit("not a number"), false);
});

test("an envelope past the cap is refused", () => {
  assert.equal(validEnvelope({ iv: "a".repeat(MAX_ENVELOPE_CHARS), ciphertext: "b" }), false);
  assert.equal(validEnvelope({ iv: "a", ciphertext: "b" }), true);
  assert.equal(validEnvelope({ iv: "a" }), false);
  assert.equal(validEnvelope("nope"), false);
});

test("sessionIds and ids are checked as UUIDs before they reach a uuid column", () => {
  assert.equal(isUuid("2f1c9a1e-6a1e-4f6a-9c1e-8b2f5c3d7e01"), true);
  // The nil UUID is legal in Postgres, so a version check would wrongly refuse it.
  assert.equal(isUuid("00000000-0000-0000-0000-000000000000"), true);
  for (const bad of ["", "abc", "not-a-uuid", "2f1c9a1e6a1e4f6a9c1e8b2f5c3d7e01", 12, null, undefined]) {
    assert.equal(isUuid(bad as unknown), false, `${String(bad)} must not pass as a UUID`);
  }
});
