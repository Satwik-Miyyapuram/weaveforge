import { test } from "node:test";
import assert from "node:assert/strict";
import { formatError, readJsonBody } from "../format-error";

test("formatError: null/undefined -> generic message", () => {
  assert.equal(formatError(null), "Something went wrong.");
  assert.equal(formatError(undefined), "Something went wrong.");
});

test("formatError: strings pass through, junk is replaced", () => {
  assert.equal(formatError("  boom  "), "boom");
  assert.equal(formatError("[object Object]"), "Something went wrong.");
  assert.equal(formatError("   "), "Something went wrong.");
});

test("formatError: Error uses its message", () => {
  assert.equal(formatError(new Error("kaboom")), "kaboom");
});

test("formatError: plain object with message", () => {
  assert.equal(formatError({ message: "nope" }), "nope");
});

test("formatError: unwraps a nested error field", () => {
  assert.equal(formatError({ error: { message: "inner failure" } }), "inner failure");
});

test("formatError: joins PostgREST details/hint/code when there is no message", () => {
  // A string `message` short-circuits; the join path is for message-less rows.
  const text = formatError({ details: "row 3", hint: "check it", code: "P0001" });
  assert.equal(text, "row 3 — check it — (P0001)");
});

test("formatError: appends the api_tokens migration hint", () => {
  const byText = formatError({ details: "relation api_tokens does not exist", code: "42P01" });
  assert.match(byText, /Run supabase db push \(migration 0061\)/);
  const byCode = formatError({ details: "schema cache miss", code: "PGRST205" });
  assert.match(byCode, /migration 0061/);
});

test("formatError: falls back to JSON for opaque objects", () => {
  assert.equal(formatError({ weird: 1 }), JSON.stringify({ weird: 1 }));
});

test("readJsonBody: empty body -> {}", async () => {
  assert.deepEqual(await readJsonBody(new Response("")), {});
});

test("readJsonBody: object body parsed as-is", async () => {
  assert.deepEqual(await readJsonBody(new Response(JSON.stringify({ a: 1 }))), { a: 1 });
});

test("readJsonBody: array body wrapped under data", async () => {
  assert.deepEqual(await readJsonBody(new Response(JSON.stringify([1, 2]))), { data: [1, 2] });
});

test("readJsonBody: invalid JSON -> error field", async () => {
  const out = await readJsonBody(new Response("not json", { status: 500 }));
  assert.match(String(out.error), /not json/);
});

test("a network failure is explained instead of shown as \"Failed to fetch\"", () => {
  // Every browser words it differently and none of them words it usefully.
  for (const raw of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
    const message = formatError(new TypeError(raw));
    assert.match(message, /Could not reach the server/);
    assert.doesNotMatch(message, /Failed to fetch|NetworkError|Load failed/);
  }
});

test("a chunk that went missing under a running tab says to reload", () => {
  const message = formatError(
    new TypeError("Failed to fetch dynamically imported module: https://example.test/_next/static/chunks/x.js"),
  );
  assert.match(message, /reload the page/);
});

test("a server error keeps its own words", () => {
  assert.equal(formatError(new Error("permission denied for table user_settings")), "permission denied for table user_settings");
});
