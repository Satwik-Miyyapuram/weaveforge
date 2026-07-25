import { test } from "node:test";
import assert from "node:assert/strict";
import { bearerToken, requireSdkUser, requireMcpRelayUser } from "../_shared";

test("bearerToken: extracts the token, case-insensitive prefix", () => {
  assert.equal(bearerToken(new Request("http://x", { headers: { authorization: "Bearer tt_abc" } })), "tt_abc");
  assert.equal(bearerToken(new Request("http://x", { headers: { authorization: "BEARER tt_abc" } })), "tt_abc");
  assert.equal(bearerToken(new Request("http://x")), null);
});

test("requireSdkUser: 401 with no Authorization header (no Supabase touched)", async () => {
  const auth = await requireSdkUser(new Request("http://localhost/api/sdk/whoami"));
  assert.equal(auth.ok, false);
  if (!auth.ok) {
    assert.equal(auth.response.status, 401);
    assert.match((await auth.response.json()).error, /Not authenticated/);
  }
});

test("requireMcpRelayUser: 401 with no Authorization header", async () => {
  const auth = await requireMcpRelayUser(new Request("http://localhost/api/mcp/relay"));
  assert.equal(auth.ok, false);
  if (!auth.ok) assert.equal(auth.response.status, 401);
});
