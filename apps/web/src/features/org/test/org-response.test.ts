/**
 * An org route's answer is checked before its body is trusted (B65, 32-18).
 *
 * A proxy's HTML 502 or an empty 500 used to surface as the JSON parser's
 * "Unexpected token" instead of what the call was for.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { orgResponse } from "../infrastructure/org-api";

test("a non-JSON 500 gives the mapped error, not a parse error", async () => {
  const res = new Response("<html>Bad gateway</html>", { status: 500 });
  await assert.rejects(orgResponse(res, "Failed to create lab."), (err: Error) => {
    assert.doesNotMatch(err.message, /Unexpected token|JSON\.parse/);
    assert.match(err.message, /Bad gateway/);
    assert.match(err.message, /500/);
    return true;
  });
});

test("an empty error body falls back to what the call was for", async () => {
  const res = new Response("", { status: 503 });
  await assert.rejects(orgResponse(res, "Failed to load labs."), /Failed to load labs\./);
});

test("the server's own error message is kept", async () => {
  const res = new Response(JSON.stringify({ error: "Code expired." }), { status: 400 });
  await assert.rejects(orgResponse(res, "Invalid code."), /Code expired\./);
});

test("a missing service role becomes the deployment hint", async () => {
  const res = new Response(JSON.stringify({ error: "Missing Supabase service role key" }), { status: 500 });
  await assert.rejects(orgResponse(res, "x"), /not available on this deployment/);
});

test("a good answer returns its body", async () => {
  const res = new Response(JSON.stringify({ organizations: [{ id: "o1" }] }), { status: 200 });
  assert.deepEqual(await orgResponse(res, "x"), { organizations: [{ id: "o1" }] });
});
